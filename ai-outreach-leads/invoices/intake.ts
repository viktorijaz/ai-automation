// v1b: upload → store → extract → check; plus the cron sweep and the human decision. Server only.
import { createHash } from "node:crypto";
import { db } from "../core/db";
import { publicError } from "../core/errors";
import { getFile, putFile } from "../core/files";
import { DAILY_CALLS, overDailyCap, recordUsage, setUsageStatus, timeLeftFor } from "../core/llm";
import { orgFilter, type Scope } from "../core/scope";
import { checkInvoice, type Flag, type Vendors } from "./checks";
import { CALL_TIMEOUT_MS, extractBytes, MODEL, type FileType, type Invoice } from "./extract";
import { decisionError, detectType, EXTENSION, uploadError, type Decision } from "./rules";
import vendorsJson from "./data/vendors.json";

export const BUCKET = "invoices";
const DEMO_ORG = process.env.DEMO_ORG ?? "acme";

// The demo suppliers belong to the demo org only; other orgs have none until the vendors table
function vendorsFor(orgId: string): Vendors {
  return orgId === DEMO_ORG ? vendorsJson : {};
}
const MAX_ATTEMPTS = 3;
const STUCK_AFTER = "10 minutes"; // 'processing' longer than this = the run crashed

type InvoiceRow = { id: string; org_id: string; file_path: string; file_type: FileType; attempts: number };

// ---------- Upload ----------

export type UploadResult = { ok: true; id: string; needsExtraction: boolean } | { ok: false; error: string };

// Row first, then the file: a failed upload leaves a visible 'failed' row, never a file without a row
export async function createInvoice(orgId: string, fileName: string, bytes: Buffer): Promise<UploadResult> {
  const error = uploadError(bytes);
  if (error) return { ok: false, error };
  if (await overDailyCap(orgId)) return { ok: false, error: `Daily limit of ${DAILY_CALLS} AI calls reached; try again tomorrow.` };
  const type = detectType(bytes)!;
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const inserted = await db.query(
    `INSERT INTO invoices (org_id, file_name, file_type, file_sha256) VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgId, fileName.slice(0, 200), type, sha256],
  );
  const id: string = inserted.rows[0].id;
  const path = `${orgId}/${id}.${EXTENSION[type]}`;

  try {
    await putFile(BUCKET, path, bytes, type);
  } catch (e) {
    const reason = `upload failed: ${publicError(e, `invoice ${id} upload`)}; please upload it again`;
    await db.query(`UPDATE invoices SET status = 'failed', last_error = $1 WHERE id = $2`, [reason, id]);
    return { ok: true, id, needsExtraction: false };
  }
  await db.query(`UPDATE invoices SET file_path = $1 WHERE id = $2`, [path, id]);

  // The same bytes were read before: reuse that result, no AI call, flag the repeat
  const earlier = await db.query(
    `SELECT fields, created_at FROM invoices
     WHERE org_id = $1 AND file_sha256 = $2 AND status = 'done' AND id <> $3
     ORDER BY created_at LIMIT 1`,
    [orgId, sha256, id],
  );
  if (earlier.rowCount === 1) {
    const fields: Invoice = earlier.rows[0].fields;
    const flags: Flag[] = [
      { check: "duplicate", severity: "high", message: `The same file was uploaded on ${day(earlier.rows[0].created_at)}; check it isn't paid twice` },
      ...checkInvoice(fields, vendorsFor(orgId)),
    ];
    await db.query(`UPDATE invoices SET status = 'done', fields = $1, flags = $2 WHERE id = $3`, [
      JSON.stringify(fields),
      JSON.stringify(flags),
      id,
    ]);
    return { ok: true, id, needsExtraction: false };
  }
  return { ok: true, id, needsExtraction: true };
}

// ---------- Extract + check one invoice ----------

// Straight after an upload: claim this one invoice if it is still pending
export async function processInvoiceNow(orgId: string, id: string): Promise<void> {
  const claimed = await db.query(
    `UPDATE invoices SET status = 'processing', claimed_at = now(), attempts = attempts + 1
     WHERE id = $1 AND org_id = $2 AND status = 'pending' AND file_path IS NOT NULL
     RETURNING id, org_id, file_path, file_type, attempts`,
    [id, orgId],
  );
  if (claimed.rowCount === 1) await runInvoice(claimed.rows[0]);
}

type RunOutcome = "done" | "failed" | "retry" | "deferred" | "superseded";

// Only the run holding this claim may write: still 'processing', and no newer claim raised attempts
const OWNED = `id = $1 AND status = 'processing' AND attempts = $2`;

async function runInvoice(row: InvoiceRow): Promise<RunOutcome> {
  if (await overDailyCap(row.org_id)) {
    // Over the cap: back to the queue for tomorrow, without using up an attempt
    await db.query(`UPDATE invoices SET status = 'pending', attempts = attempts - 1 WHERE ${OWNED}`, [row.id, row.attempts]);
    return "deferred";
  }
  try {
    const bytes = await getFile(BUCKET, row.file_path);
    const result = await extractBytes(bytes, row.file_type);
    const usageId = await recordUsage({ orgId: row.org_id, module: "invoices", entityId: row.id, model: MODEL }, result.usage);

    // Content problems: retrying would just pay again
    if (result.refused || result.invoice === null) {
      await setUsageStatus(usageId, result.refused ? "refused" : "parse_failed");
      const owned = await finish(row, "failed", result.refused ? "the model declined to read this document" : "the reply didn't match the invoice fields");
      return owned ? "failed" : "superseded";
    }

    const invoice = result.invoice;
    const flags = [...(await duplicateFlags(row.org_id, row.id, invoice)), ...checkInvoice(invoice, vendorsFor(row.org_id))];
    const conn = await db.connect();
    try {
      await conn.query("BEGIN");
      const saved = await conn.query(`UPDATE invoices SET status = 'done', fields = $3, flags = $4, last_error = NULL WHERE ${OWNED}`, [
        row.id,
        row.attempts,
        JSON.stringify(invoice),
        JSON.stringify(flags),
      ]);
      await setUsageStatus(usageId, saved.rowCount === 1 ? "saved" : "superseded", conn);
      await conn.query("COMMIT");
      if (saved.rowCount !== 1) {
        console.error(`invoice ${row.id} attempt ${row.attempts}: result dropped, a newer run owns it`);
        return "superseded";
      }
    } catch (e) {
      await conn.query("ROLLBACK");
      throw e;
    } finally {
      conn.release();
    }
    return "done";
  } catch (e) {
    // Network, API, storage or database trouble: try again in a later run, up to MAX_ATTEMPTS
    const giveUp = row.attempts >= MAX_ATTEMPTS;
    const reason = publicError(e, `invoice ${row.id} attempt ${row.attempts}`);
    const owned = await finish(row, giveUp ? "failed" : "pending", giveUp ? `${reason}; gave up after ${MAX_ATTEMPTS} tries` : `${reason}; will try again`);
    if (!owned) return "superseded";
    return giveUp ? "failed" : "retry";
  }
}

// Same org + supplier VAT ID + invoice number as an earlier invoice (exact match, by decision)
async function duplicateFlags(orgId: string, id: string, inv: Invoice): Promise<Flag[]> {
  if (!inv.supplier_vat_id || !inv.invoice_number) return [];
  const earlier = await db.query(
    `SELECT created_at FROM invoices
     WHERE org_id = $1 AND id <> $2 AND status = 'done'
       AND fields->>'supplier_vat_id' = $3 AND fields->>'invoice_number' = $4
     ORDER BY created_at LIMIT 1`,
    [orgId, id, inv.supplier_vat_id, inv.invoice_number],
  );
  if (earlier.rowCount === 0) return [];
  return [
    {
      check: "duplicate",
      severity: "high",
      message: `Invoice ${inv.invoice_number} from this supplier was already uploaded on ${day(earlier.rows[0].created_at)}; check it isn't paid twice`,
    },
  ];
}

// False if a newer run owns the invoice now: nothing is written
async function finish(row: InvoiceRow, status: "failed" | "pending", error: string | null): Promise<boolean> {
  const r = await db.query(`UPDATE invoices SET status = $3, last_error = $4 WHERE ${OWNED}`, [row.id, row.attempts, status, error]);
  return r.rowCount === 1;
}

// ---------- The cron sweep: stuck and retryable invoices ----------

export type SweepResult = { released: number; claimed: number } & Record<RunOutcome, number>;

export async function sweepInvoices(size: number, scope: Scope): Promise<SweepResult> {
  const startedAt = Date.now();
  const released = await db.query(
    `UPDATE invoices
     SET status = CASE WHEN attempts >= $1 THEN 'failed' ELSE 'pending' END,
         last_error = 'run stopped while processing'
     WHERE status = 'processing' AND claimed_at < now() - $2::interval
       AND ($3::text IS NULL OR org_id = $3)`,
    [MAX_ATTEMPTS, STUCK_AFTER, orgFilter(scope)],
  );
  const claimed = await db.query(
    `UPDATE invoices
     SET status = 'processing', claimed_at = now(), attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM invoices
       WHERE status = 'pending' AND file_path IS NOT NULL
         AND ($2::text IS NULL OR org_id = $2)
       ORDER BY created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, org_id, file_path, file_type, attempts`,
    [size, orgFilter(scope)],
  );
  const result: SweepResult = { released: released.rowCount ?? 0, claimed: claimed.rowCount ?? 0, done: 0, failed: 0, retry: 0, deferred: 0, superseded: 0 };
  const rows = claimed.rows as InvoiceRow[];
  for (const [i, row] of rows.entries()) {
    if (!timeLeftFor(startedAt, CALL_TIMEOUT_MS)) {
      const untouched = rows.slice(i).map((r) => r.id);
      await db.query(`UPDATE invoices SET status = 'pending', attempts = attempts - 1 WHERE id = ANY($1)`, [untouched]); // next run
      result.deferred += untouched.length;
      break;
    }
    result[await runInvoice(row)]++;
  }
  return result;
}

// ---------- The human decision: approve or reject, final in v1b ----------

export async function decideInvoice(
  orgId: string,
  id: string,
  decision: Decision,
  note: string,
  by: string,
): Promise<string | null> {
  const found = await db.query(`SELECT flags FROM invoices WHERE id = $1 AND org_id = $2 AND status = 'done'`, [id, orgId]);
  if (found.rowCount === 0) return "This invoice isn't ready for a decision.";
  const error = decisionError(found.rows[0].flags ?? [], decision, note);
  if (error) return error;

  const updated = await db.query(
    `UPDATE invoices SET decision = $1, decision_note = $2, decided_by = $3, decided_at = now()
     WHERE id = $4 AND org_id = $5 AND status = 'done' AND decision IS NULL`,
    [decision, note || null, by, id, orgId],
  );
  return updated.rowCount === 1 ? null : "A decision was already recorded.";
}

// ---------- Helpers ----------

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}
