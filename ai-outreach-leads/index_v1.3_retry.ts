// v1.3: API failures skip one lead (or stop the run), instead of crashing everything

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import pg from "pg";

type Lead = {
  name: string;
  company: string;
  role: string;
  website: string;
  note: string;
};

// ---------- Read the leads ----------

const text = readFileSync("data/leads.csv", "utf-8");
const rows = text.trim().split("\n").slice(1);
const leads: Lead[] = rows.map((line) => {
  const [name, company, role, website, note] = line.split(",");
  return { name, company, role, website, note };
});

// ---------- Connections ----------

process.loadEnvFile();
// The SDK already retries 429 / 5xx / network errors with growing pauses.
// We only tune it. Never add a second retry loop on top: retries multiply.
const client = new Anthropic({
  maxRetries: 3, // how many retries after the first attempt?
  timeout: 60_000, // 60 seconds, in MILLISECONDS
});
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ---------- Settings ----------

const MODEL = "claude-opus-5-5"; // "claude-haiku-5-5" is ~40x cheaper
const ORG_ID = "acme";

// $ per 1 MILLION tokens
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

// ---------- The shape we want back ----------

const EmailSchema = z.object({
  subject: z.string(),
  body: z.string(),
});
type Email = z.infer<typeof EmailSchema>;

function isPlainText(s: string): boolean {
  return !/[*#`]/.test(s);
}

// ---------- The ONE place every AI call goes through ----------

// Now returns TWO things: the email (or null) and the id of its receipt
type LLMResult = { email: Email | null; usageId: string }; // pg returns bigint ids as strings

async function callLLM(prompt: string, orgId: string): Promise<LLMResult> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    output_config: {
      effort: "low",
      format: zodOutputFormat(EmailSchema),
    },
    messages: [{ role: "user", content: prompt }],
  });

  // 1. The receipt, committed immediately as 'pending'. OUTSIDE any transaction:
  //    money already spent must survive a rollback.
  const { input_tokens, output_tokens } = response.usage;
  const price = PRICES[MODEL];
  const cost =
    (input_tokens * price.input + output_tokens * price.output) / 1_000_000;
  const receipt = await db.query(
    `INSERT INTO ai_usage (org_id, model, input_tokens, output_tokens, cost_usd, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING id`, // which column do we need back, to find this row again?
    [orgId, MODEL, input_tokens, output_tokens, cost],
  );
  const usageId: string = receipt.rows[0].id; // same column

  // 2. Check what came back; record WHY a paid call produced nothing
  const email = response.parsed_output;
  if (email === null) {
    await db.query(
      `UPDATE ai_usage SET status = 'parse_failed' WHERE id = $1`,
      [usageId],
    ); // which failure?
    console.warn(`parse failed, stop_reason: ${response.stop_reason}`);
    return { email: null, usageId };
  }
  if (!isPlainText(email.subject)) {
    await db.query(
      `UPDATE ai_usage SET status = 'check_failed' WHERE id = $1`,
      [usageId],
    ); // which failure?
    console.warn(`markdown in subject: ${email.subject}`);
    return { email: null, usageId };
  }
  return { email, usageId };
}

// ---------- Save email + mark receipt 'saved', all or nothing ----------

async function saveEmail(
  lead: Lead,
  email: Email,
  usageId: string,
): Promise<void> {
  const conn = await db.connect(); // borrow ONE connection: BEGIN/COMMIT must share it
  try {
    await conn.query("BEGIN"); // start the transaction

    await conn.query(
      `INSERT INTO emails (org_id, lead_name, company, subject, email_text, ai_usage_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ORG_ID, lead.name, lead.company, email.subject, email.body, usageId], // link to the receipt
    );
    await conn.query(`UPDATE ai_usage SET status = 'saved' WHERE id = $1`, [
      usageId,
    ]); // success!

    await conn.query("COMMIT"); // make both permanent
  } catch (e) {
    await conn.query("ROLLBACK"); // undo both
    throw e;
  } finally {
    conn.release(); // give the connection back to the pool, ALWAYS
  }
}

// ---------- The prompt ----------

const SENDER = {
  name: "Isidora Moon",
  company: "ToTheMoon",
  offer: "Logistics from ToTheMoon",
};

function buildPrompt(lead: Lead): string {
  return `Write a 4-sentence cold email to ${lead.name}, ${lead.role} at ${lead.company}.
Mention that they are ${lead.note}. No hype, no buzzwords.
The email is from ${SENDER.name} at ${SENDER.company}, who offers ${SENDER.offer}.
Sign it with the sender's name. Never use placeholders or square brackets.
Plain text only: no markdown, no asterisks, no # headings, no backticks.`;
}

// ---------- Which errors are temporary? ----------

// Temporary = might work for the next lead: skip this one, keep going.
// Everything else (bad key, wrong model, database down, unknown) = stop the run:
// it would fail the same way for every lead.
function isTemporary(e: unknown): boolean {
  return (
    e instanceof Anthropic.RateLimitError || // 429: too many requests
    e instanceof Anthropic.InternalServerError || // 5xx: Anthropic's side
    e instanceof Anthropic.APIConnectionError // network, timeouts
  );
}

// ---------- Every lead, one email each ----------

const skipped: { name: string; reason: string }[] = [];

for (const lead of leads) {
  try {
    const { email, usageId } = await callLLM(buildPrompt(lead), ORG_ID);

    if (email === null) {
      skipped.push({ name: lead.name, reason: "parse or check failed" });
      continue;
    }

    await saveEmail(lead, email, usageId);
    console.log(
      `\n===== ${lead.name} =====\nSubject: ${email.subject}\n\n${email.body}`,
    );
  } catch (e) {
    if (isTemporary(e)) {
      // is it worth trying the next lead?
      // no response came back, so no tokens and no receipt: just remember it
      skipped.push({
        name: lead.name,
        reason: e instanceof Error ? e.message : String(e),
      });
      console.warn(`skipped ${lead.name}: temporary API error`);
      continue; // move on to the next lead
    }
    console.error(`stopping the run at ${lead.name}`);
    throw e; // anything else: stop everything
  }
}

// ---------- The receipt, by status ----------

const result = await db.query(
  `SELECT status, COUNT(*) AS calls, SUM(cost_usd) AS total_usd
   FROM ai_usage
   GROUP BY status`, // one row per status
);
console.table(result.rows);
console.log(
  `Skipped: ${skipped.length ? skipped.map((s) => `${s.name} (${s.reason})`).join(", ") : "none"}`,
);

await db.end();
