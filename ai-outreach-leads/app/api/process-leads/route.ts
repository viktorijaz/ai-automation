// Called every 5 hours by Supabase pg_cron: process one batch of pending leads
import { timingSafeEqual } from "node:crypto";
import { processBatch } from "../../../pipeline";

export const runtime = "nodejs";
export const maxDuration = 60; // seconds; a batch of 5 leads takes ~25 s

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
  const result = await processBatch(5, "all-orgs"); // the shared worker serves every org
  return Response.json(result);
}
