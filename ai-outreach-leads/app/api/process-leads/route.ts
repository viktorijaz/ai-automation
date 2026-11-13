// Called every 5 hours by Supabase pg_cron: one batch of pending leads, then stuck or retryable invoices
import { timingSafeEqual } from "node:crypto";
import { sweepInvoices } from "../../../invoices/intake";
import { processBatch } from "../../../pipeline";

export const runtime = "nodejs";
export const maxDuration = 60; // seconds; 5 leads take ~25 s, 3 invoices on Haiku ~15 s

// Compare in constant time, so response timing can't reveal the secret letter by letter
function isAuthorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // The shared worker serves every org; one module failing doesn't stop the other
  const [leads, invoices] = await Promise.allSettled([processBatch(5, "all-orgs"), sweepInvoices(3, "all-orgs")]);
  const report = (r: PromiseSettledResult<unknown>) => (r.status === "fulfilled" ? r.value : { error: String(r.reason) });
  return Response.json({ leads: report(leads), invoices: report(invoices) });
}
