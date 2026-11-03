// Read-only queries for the dashboard
import { db } from "../pipeline";

import { createClient } from "../lib/supabase/server";

export type CurrentOrg = { orgId: string; email: string };

// Who is logged in, and which org they belong to (null = not logged in, "no-org" = logged in without an org)
export async function getCurrentOrg(): Promise<CurrentOrg | null | "no-org"> {
  // Local development without login
  if (process.env.DASHBOARD_ENABLED === "true") return { orgId: "acme", email: "local dev" };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims(); // verified token, not just a cookie
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const member = await db.query(`SELECT org_id FROM members WHERE user_id = $1`, [claims.sub]);
  if (member.rowCount === 0) return "no-org";
  return { orgId: member.rows[0].org_id, email: String(claims.email ?? "") };
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
