// The job queue: one job per lead, stored in Postgres by pg-boss
import { PgBoss } from "pg-boss";
import type { Lead } from "./pipeline.js";

export const QUEUE = "write-email";

export type EmailJob = { orgId: string; lead: Lead };

// Same lead, same key: the 'exclusive' policy allows only one queued-or-active job per key
export function jobKey(job: EmailJob): string {
  return `${job.orgId}:${job.lead.name}:${job.lead.company}`;
}

export async function startQueue(): Promise<PgBoss> {
  const boss = new PgBoss(process.env.DATABASE_URL!);
  boss.on("error", console.error);
  await boss.start();

  if (!(await boss.getQueue(QUEUE))) {
    await boss.createQueue(QUEUE, {
      policy: "exclusive", // one job per lead at a time
      retryLimit: 3, // failed jobs are tried 3 more times
      retryDelay: 30, // first retry after 30 s
      retryBackoff: true, // then 60 s, 120 s... with jitter
      expireInSeconds: 300, // a job active for 5 min is assumed crashed and retried
    });
  }
  return boss;
}
