import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

type Lead = {
  name: string;
  company: string;
  role: string;
  website: string;
  note: string;
};

// 2. Read the whole file as text
const text = readFileSync("leads.csv", "utf-8"); // which file?

// 3. Split into lines, drop the header
const lines = text.trim().split("\n"); // remove the empty last line, then split on newline
const rows = lines.slice(1); // skip line 0, the header

// 4. Turn each line into a Lead
const leads: Lead[] = rows.map((line) => {
  const [name, company, role, website, note] = line.split(",");
  return { name, company, role, website, note }; // shorthand: all five names
});

for (const lead of leads) {
  //console.log(lead);
}

// ---------- STEP 2: one Claude call for one lead ----------

process.loadEnvFile(); // reads .env into process.env
const client = new Anthropic(); // finds ANTHROPIC_API_KEY by itself

// ---------- STEP 3: all leads + cost log ----------

const MODEL = "claude-opus-5-5"; // your call: "claude-haiku-5-5" is ~40x cheaper
const ORG_ID = "acme"; // which customer is paying (in a real product: from the logged-in account)

// $ per 1 MILLION tokens
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

// One row per AI call
type UsageRow = {
  org_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
};
const usageLog: UsageRow[] = [];

// The ONE place every AI call goes through
async function callLLM(prompt: string, orgId: string): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000, // thinking counts too
    output_config: { effort: "low" }, // short email = little thinking needed
    messages: [{ role: "user", content: prompt }],
  });

  const { input_tokens, output_tokens } = response.usage;
  const price = PRICES[MODEL]; // which model's prices?
  const cost =
    (input_tokens * price.input + output_tokens * price.output) / 1000000; // prices are per million

  usageLog.push({
    org_id: orgId,
    model: MODEL,
    input_tokens,
    output_tokens,
    cost,
  }); // add one row

  // content is a list of blocks: thinking blocks first, then the text
  for (const block of response.content) {
    if (block.type === "text") {
      return block.text;
    }
  }
  return "";
}

// Who is writing (in a real product: from the customer's account settings)
const SENDER = {
  name: "Isidora Moon", // a made-up salesperson
  company: "ToTheMoon", // a made-up company
  offer: "Logistics from ToTheMoon", // one sentence: what you sell
};

// The prompt for ANY lead
function buildPrompt(lead: Lead): string {
  return `Write a 4-sentence cold email to ${lead.name}, ${lead.role} at ${lead.company}.
Mention that they are ${lead.note}. No hype, no buzzwords.
The email is from ${SENDER.name} at ${SENDER.company}, who offers ${SENDER.offer}.
Sign it with the sender's name. Never use placeholders or square brackets.`;
}

// Every lead, one email each
for (const lead of leads) {
  const email = await callLLM(buildPrompt(lead), ORG_ID);
  console.log(`\n===== ${lead.name} =====\n${email}`);
}

// The receipt
console.table(usageLog);
const total = usageLog.reduce((sum, row) => sum + row.cost, 0); // add up which field?
console.log(`Total: $${total.toFixed(4)} for ${usageLog.length} emails`);
