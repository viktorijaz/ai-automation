// One Anthropic client and one price list for every module
import "./env";
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { db } from "./db";

// Quick retries for network blips; longer outages are retried by later runs
export const client = new Anthropic({ maxRetries: 1, timeout: 60_000 });

// $ per 1 MILLION tokens
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

// Call at startup: an unknown model fails here, before any call is paid for
export function assertPriced(model: string): void {
  if (!PRICES[model]) throw new Error(`no price for model ${model}`);
}

export function costUsd(model: string, usage: Anthropic.Usage): number {
  assertPriced(model);
  const price = PRICES[model];
  return (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000;
}

// Vercel kills a function at 60 s (maxDuration); a run must stop on its own before that
const RUN_LIMIT_MS = 55_000;

// Does a call this long (+5 s for files and the database) still fit in a run started at startedAt?
export function timeLeftFor(startedAt: number, callMs: number): boolean {
  return Date.now() - startedAt + callMs + 5_000 <= RUN_LIMIT_MS;
}

// Errors that might pass on their own: try again in a later run
export function isTemporary(e: unknown): boolean {
  return (
    e instanceof Anthropic.RateLimitError ||
    e instanceof Anthropic.InternalServerError ||
    e instanceof Anthropic.APIConnectionError
  );
}

// The reply checked against a schema; null instead of a throw, so the receipt is never skipped
export function readReply<T>(response: Anthropic.Message, schema: z.ZodType<T>): T | null {
  const block = response.content.find((b) => b.type === "text");
  if (!block) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(block.text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // not JSON at all, e.g. cut off at max_tokens
  }
}

// ---------- Receipts: one ai_usage row per call, written before anything else ----------

export type Module = "outreach" | "invoices";
export type UsageStatus = "saved" | "parse_failed" | "check_failed" | "blocked" | "duplicate" | "refused" | "superseded";

// Outside any transaction: spent money must survive a rollback
export async function recordUsage(
  call: { orgId: string; module: Module; entityId: string; model: string },
  usage: Anthropic.Usage,
): Promise<string> {
  const receipt = await db.query(
    `INSERT INTO ai_usage (org_id, module, entity_id, model, input_tokens, output_tokens, cost_usd, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING id`,
    [call.orgId, call.module, call.entityId, call.model, usage.input_tokens, usage.output_tokens, costUsd(call.model, usage)],
  );
  return receipt.rows[0].id;
}

// Set once, after the result is known; receipts are never deleted
export async function setUsageStatus(usageId: string, status: UsageStatus, conn: { query: typeof db.query } = db) {
  await conn.query(`UPDATE ai_usage SET status = $1 WHERE id = $2 AND status = 'pending'`, [status, usageId]);
}

// ---------- Daily cap: per org, counted from the receipts (a system-wide limit comes later) ----------

export const DAILY_CALLS = 50;

// Has this org used up its AI calls for the last 24 hours?
export async function overDailyCap(orgId: string): Promise<boolean> {
  const used = await db.query(`SELECT count(*)::int AS n FROM ai_usage WHERE org_id = $1 AND created_at > now() - interval '1 day'`, [orgId]);
  return used.rows[0].n >= DAILY_CALLS;
}
