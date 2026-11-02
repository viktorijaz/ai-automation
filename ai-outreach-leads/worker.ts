// v2.0: runs until stopped; takes one job at a time and processes its lead. Usage: npx tsx worker.ts
import { db, processLead } from "./pipeline.js";
import { QUEUE, startQueue, type EmailJob } from "./queue.js";

const boss = await startQueue();

await boss.work<EmailJob>(QUEUE, { pollingIntervalSeconds: 2 }, async ([job]) => {
  const { orgId, lead } = job.data;
  console.log(`working  ${lead.name} (job ${job.id}, try ${job.retryCount + 1})`);

  // A thrown error fails this attempt; pg-boss retries it later with backoff
  const outcome = await processLead(lead, orgId);
  console.log(`${outcome.padEnd(16)} ${lead.name}`);
});

console.log(`worker waiting for jobs in "${QUEUE}" (Ctrl+C to stop)`);

// Ctrl+C: let the current job finish, then close connections
process.on("SIGINT", async () => {
  console.log("stopping...");
  await boss.stop({ graceful: true });
  await db.end();
  process.exit(0);
});
