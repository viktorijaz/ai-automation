// v2.0: put one job per valid lead into the queue, then exit. Usage: npx tsx enqueue.ts data/leads.csv
import { db, readLeads } from "./pipeline.js";
import { jobKey, QUEUE, startQueue, type EmailJob } from "./queue.js";

const ORG_ID = "acme";
const file = process.argv[2] ?? "data/leads.csv";

const { leads, invalid } = readLeads(file);
console.log(`${file}: ${leads.length} valid, ${invalid.length} invalid`);
for (const bad of invalid) console.warn(`  row ${bad.row}: ${bad.reason}`);

const boss = await startQueue();

for (const lead of leads) {
  const job: EmailJob = { orgId: ORG_ID, lead };
  const id = await boss.send(QUEUE, job, { singletonKey: jobKey(job) });
  // null = a job for this lead is already queued or running
  console.log(id ? `queued   ${lead.name}` : `skipped  ${lead.name} (already in the queue)`);
}

await boss.stop();
await db.end();
