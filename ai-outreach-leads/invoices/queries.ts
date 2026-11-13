// Read-only queries for the invoice pages; every query is scoped by org
import { db } from "../core/db";
import { signedUrl } from "../core/files";
import type { Flag } from "./checks";
import type { Invoice } from "./extract";
import { BUCKET } from "./intake";

export type InvoiceListRow = {
  id: string;
  file_name: string;
  status: "pending" | "processing" | "done" | "failed";
  fields: Invoice | null;
  flags: Flag[] | null;
  decision: "approved" | "rejected" | null;
  last_error: string | null;
  cost_usd: number; // all receipts for this invoice, failed calls included
  created_at: Date;
};

export type InvoiceDetail = InvoiceListRow & {
  file_type: string;
  file_path: string | null;
  attempts: number;
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
};

const SELECT = `
  SELECT i.*, COALESCE(SUM(u.cost_usd), 0)::float AS cost_usd
  FROM invoices i
  LEFT JOIN ai_usage u ON u.module = 'invoices' AND u.entity_id = i.id::text`;

export async function listInvoices(orgId: string): Promise<InvoiceListRow[]> {
  const result = await db.query(`${SELECT} WHERE i.org_id = $1 GROUP BY i.id ORDER BY i.created_at DESC LIMIT 100`, [orgId]);
  return result.rows;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// null = not found in this org (or not a valid id): the page shows "not found" either way
export async function getInvoice(orgId: string, id: string): Promise<InvoiceDetail | null> {
  if (!UUID.test(id)) return null;
  const result = await db.query(`${SELECT} WHERE i.org_id = $1 AND i.id = $2 GROUP BY i.id`, [orgId, id]);
  return result.rows[0] ?? null;
}

// Only call after getInvoice() found the invoice in the user's org; null = no file to show
export async function fileUrl(invoice: InvoiceDetail): Promise<string | null> {
  if (!invoice.file_path) return null;
  try {
    return await signedUrl(BUCKET, invoice.file_path, 5 * 60);
  } catch (e) {
    console.error(`invoice ${invoice.id}: ${e instanceof Error ? e.message : e}`); // the fields still show
    return null;
  }
}
