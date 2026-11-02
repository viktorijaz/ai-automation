// v1: same as index_v0.ts, but emails and costs are saved in Postgres
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
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

process.loadEnvFile(); // reads ANTHROPIC_API_KEY and DATABASE_URL from .env
const client = new Anthropic();

// A pool keeps a few open connections and lends them out
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ---------- Settings ----------

const MODEL = "claude-opus-5-5"; // "claude-haiku-5-5" is ~40x cheaper
const ORG_ID = "acme";

// $ per 1 MILLION tokens
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

// ---------- The ONE place every AI call goes through ----------

async function callLLM(prompt: string, orgId: string): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: prompt }],
  });

  const { input_tokens, output_tokens } = response.usage;
  const price = PRICES[MODEL];
  const cost =
    (input_tokens * price.input + output_tokens * price.output) / 1_000_000;

  // The receipt, now saved in the database instead of an array.
  // $1, $2... are placeholders: pg sends the values separately, so they can never break the SQL
  await db.query(
    `INSERT INTO ai_usage (org_id, model, input_tokens, output_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, $5)`, // how many columns, how many placeholders?
    [orgId, MODEL, input_tokens, output_tokens, cost], // the 5th value
  );

  for (const block of response.content) {
    if (block.type === "text") {
      return block.text;
    }
  }
  return "";
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
Sign it with the sender's name. Never use placeholders or square brackets.`;
}

// ---------- Every lead, one email each, saved ----------

for (const lead of leads) {
  const email = await callLLM(buildPrompt(lead), ORG_ID);

  await db.query(
    `INSERT INTO emails (org_id, lead_name, company, email_text)
     VALUES ($1, $2, $3, $4)`, // which table?
    [ORG_ID, lead.name, lead.company, email], // lead's name field, and the email itself
  );

  console.log(`\n===== ${lead.name} =====\n${email}`);
}

// ---------- The receipt, from the database ----------

const result = await db.query(
  `SELECT org_id, COUNT(*) AS calls, SUM(cost_usd) AS total_usd
   FROM ai_usage
   GROUP BY org_id`, // one row per customer
);
console.table(result.rows);

await db.end(); // close the pool, otherwise the program never exits
