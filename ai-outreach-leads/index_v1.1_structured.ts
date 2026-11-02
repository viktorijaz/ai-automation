// v1.1: structured output. Claude returns { subject, body }, checked before saving
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
const client = new Anthropic();
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
  subject: z.string(), // field 1
  body: z.string(), // field 2
});
type Email = z.infer<typeof EmailSchema>; // TypeScript type made from the schema

// The schema guarantees the SHAPE, not the CONTENT: check for markdown ourselves
function isPlainText(s: string): boolean {
  return !/[*#`]/.test(s); // true when none of * # ` appear
}

// ---------- The ONE place every AI call goes through ----------

async function callLLM(prompt: string, orgId: string): Promise<Email | null> {
  const response = await client.messages.parse({
    // which method validates against a schema?
    model: MODEL,
    max_tokens: 2000,
    output_config: {
      effort: "low",
      format: zodOutputFormat(EmailSchema), // which schema?
    },
    messages: [{ role: "user", content: prompt }],
  });

  // 1. Log the cost FIRST: the call is paid for, whether parsing worked or not
  const { input_tokens, output_tokens } = response.usage;
  const price = PRICES[MODEL];
  const cost =
    (input_tokens * price.input + output_tokens * price.output) / 1_000_000;
  await db.query(
    `INSERT INTO ai_usage (org_id, model, input_tokens, output_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, $5)`,
    [orgId, MODEL, input_tokens, output_tokens, cost],
  );

  // 2. Then check what came back
  const email = response.parsed_output; // where does the parsed object live? (null if parsing failed)
  if (email === null) {
    console.warn(`parse failed, stop_reason: ${response.stop_reason}`);
    return null;
  }
  if (!isPlainText(email.subject)) {
    // which field must never contain markdown?
    console.warn(`markdown in subject: ${email.subject}`);
    return null;
  }
  return email;
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
Plain text only: no markdown, no asterisks, no # headings, no backticks.`; // what must the email never contain?
}

// ---------- Every lead, one email each ----------

const skipped: string[] = [];

for (const lead of leads) {
  const email = await callLLM(buildPrompt(lead), ORG_ID);

  if (email === null) {
    skipped.push(lead.name); // remember who failed
    continue;
  }

  await db.query(
    `INSERT INTO emails (org_id, lead_name, company, subject, email_text)
     VALUES ($1, $2, $3, $4, $5)`,
    [ORG_ID, lead.name, lead.company, email.subject, email.body], // subject, then body
  );

  console.log(
    `\n===== ${lead.name} =====\nSubject: ${email.subject}\n\n${email.body}`,
  );
}

// ---------- The receipt ----------

const result = await db.query(
  `SELECT org_id, COUNT(*) AS calls, SUM(cost_usd) AS total_usd
   FROM ai_usage
   GROUP BY org_id`,
);
console.table(result.rows);
console.log(`Skipped: ${skipped.length ? skipped.join(", ") : "none"}`);

await db.end();
