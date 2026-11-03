// Read-only queries for the dashboard
import { db } from "../pipeline";

export const ORG_ID = "acme"; // until login exists, the UI shows one organization

// Temporary lock until Google login: on locally (DASHBOARD_ENABLED), or behind proxy.ts's password
export function dashboardEnabled(): boolean {
  return process.env.DASHBOARD_ENABLED === "true" || Boolean(process.env.DASHBOARD_PASSWORD);
}

export type Progress = {
  counts: Record<"pending" | "processing" | "done" | "failed", number>;
  costs: { status: string; calls: number; usd: number }[];
  totalUsd: number;
};

export async function getProgress(orgId: string): Promise<Progress> {
  const counts = { pending: 0, processing: 0, done: 0, failed: 0 };
  const leads = await db.query(
    `SELECT status, COUNT(*)::int AS n FROM leads WHERE org_id = $1 GROUP BY status`,
    [orgId],
  );
  for (const row of leads.rows) counts[row.status as keyof typeof counts] = row.n;

  const usage = await db.query(
    `SELECT status, COUNT(*)::int AS calls, SUM(cost_usd)::float AS usd
     FROM ai_usage WHERE org_id = $1 GROUP BY status ORDER BY usd DESC`,
    [orgId],
  );
  const costs = usage.rows as Progress["costs"];
  return { counts, costs, totalUsd: costs.reduce((sum, c) => sum + c.usd, 0) };
}

export type LeadView = {
  id: string;
  name: string;
  company: string;
  role: string;
  status: string;
  attempts: number;
  last_error: string | null;
  subject: string | null;
  body: string | null;
};

// Newest first, with the email if one exists
export async function getLeads(orgId: string): Promise<LeadView[]> {
  const result = await db.query(
    `SELECT l.id, l.name, l.company, l.role, l.status, l.attempts, l.last_error,
            e.subject, e.email_text AS body
     FROM leads l
     LEFT JOIN emails e
       ON e.org_id = l.org_id AND e.lead_name = l.name AND e.company = l.company
     WHERE l.org_id = $1
     ORDER BY l.id DESC
     LIMIT 200`,
    [orgId],
  );
  return result.rows;
}
