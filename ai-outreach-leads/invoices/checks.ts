// v0 step 6: verify an extracted invoice against business rules and known data. Code only, no AI.
// Usage: npx tsx invoices/checks.ts invoices/data/inv-03.expected.json   (a JSON invoice, no API call)
//        npx tsx invoices/checks.ts invoices/data/inv-03.pdf             (extract first, then check)
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Invoice } from "./extract";

export type Severity = "high" | "medium" | "low";
export type Flag = { check: string; severity: Severity; message: string };
export type Vendor = { name: string; iban: string };
export type Vendors = Record<string, Vendor>; // key = supplier VAT ID

// ---------- IBAN (ISO 13616): fixed length per country + mod-97 checksum ----------

const IBAN_LENGTH: Record<string, number> = {
  MK: 19, RS: 22, AL: 28, BA: 20, BG: 22, HR: 21, SI: 19, ME: 22, XK: 20, GR: 27, RO: 24, HU: 28,
  AT: 20, DE: 22, CH: 21, IT: 27, FR: 27, ES: 24, NL: 18, BE: 16, GB: 22, PL: 28, CZ: 24, SK: 24,
};

// Move the first 4 characters to the end, letters → numbers (A=10 … Z=35), remainder mod 97 must be 1
export function ibanChecksumOk(iban: string): boolean {
  const moved = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of moved) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97; // digit by digit: no huge numbers
  }
  return remainder === 1;
}

function checkIban(iban: string): Flag[] {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) {
    return [{ check: "iban_format", severity: "high", message: `IBAN "${iban}" is not in IBAN format` }];
  }
  const country = iban.slice(0, 2);
  const flags: Flag[] = [];
  const length = IBAN_LENGTH[country];
  if (length === undefined) {
    flags.push({ check: "iban_length", severity: "low", message: `no known IBAN length for ${country}; length not verified` });
  } else if (iban.length !== length) {
    flags.push({ check: "iban_length", severity: "high", message: `IBAN has ${iban.length} characters; ${country} IBANs have ${length}` });
  }
  if (!ibanChecksumOk(iban)) {
    flags.push({ check: "iban_checksum", severity: "high", message: `IBAN "${iban}" fails the mod-97 checksum (misread or mistyped)` });
  }
  return flags;
}

// ---------- VAT: standard rates per country (from the IBAN's country) ----------

const VAT_RATES: Record<string, number[]> = { MK: [18, 10, 5], RS: [20, 10] };

// ---------- All checks ----------

const CENT = 0.01;

export function checkInvoice(inv: Invoice, vendors: Vendors): Flag[] {
  const flags: Flag[] = [];

  // Fields a bill can't be created without
  for (const field of ["supplier_vat_id", "iban", "invoice_number", "total"] as const) {
    if (inv[field] === null) flags.push({ check: "missing_field", severity: "medium", message: `${field} is missing` });
  }

  // Arithmetic: each line, lines → net, net + vat → total
  inv.lines.forEach((line, i) => {
    if (Math.abs(line.quantity * line.unit_price - line.amount) > CENT) {
      flags.push({ check: "line_math", severity: "medium", message: `line ${i + 1}: ${line.quantity} × ${line.unit_price} ≠ ${line.amount}` });
    }
  });
  const linesSum = inv.lines.reduce((sum, l) => sum + l.amount, 0);
  if (inv.net !== null && Math.abs(linesSum - inv.net) > CENT) {
    flags.push({ check: "lines_vs_net", severity: "medium", message: `lines add up to ${linesSum}, but net is ${inv.net}` });
  }
  if (inv.net !== null && inv.vat !== null && inv.total !== null && Math.abs(inv.net + inv.vat - inv.total) > CENT) {
    flags.push({ check: "net_plus_vat", severity: "medium", message: `net ${inv.net} + VAT ${inv.vat} = ${inv.net + inv.vat}, but total is ${inv.total}` });
  }

  // VAT rate must be a real rate for the supplier's country
  const country = inv.iban?.slice(0, 2) ?? "";
  if (inv.net && inv.vat !== null && VAT_RATES[country]) {
    const rate = Math.round((10000 * inv.vat) / inv.net) / 100;
    if (!VAT_RATES[country].some((r) => Math.abs(r - rate) < 0.05)) {
      flags.push({ check: "vat_rate", severity: "medium", message: `VAT is ${rate}% of net; ${country} rates are ${VAT_RATES[country].join(", ")}%` });
    }
  }

  // Dates
  if (inv.invoice_date && inv.due_date && inv.due_date < inv.invoice_date) {
    flags.push({ check: "due_before_date", severity: "low", message: `due ${inv.due_date} is before the invoice date ${inv.invoice_date}` });
  }

  // IBAN: can it be real at all?
  if (inv.iban) flags.push(...checkIban(inv.iban));

  // Known data: is this a supplier we pay, and to the account we know?
  const vendor = inv.supplier_vat_id ? vendors[inv.supplier_vat_id] : undefined;
  if (inv.supplier_vat_id && !vendor) {
    flags.push({ check: "unknown_supplier", severity: "low", message: `supplier ${inv.supplier_vat_id} is not in the vendor list` });
  }
  if (vendor && inv.iban && inv.iban !== vendor.iban) {
    flags.push({
      check: "iban_changed",
      severity: "high",
      message: `IBAN differs from the one on file for ${vendor.name} (${vendor.iban}); confirm by phone before paying`,
    });
  }

  return flags;
}

// ---------- CLI ----------

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: npx tsx invoices/checks.ts <invoice.json | invoice.pdf>");
  const vendors: Vendors = JSON.parse(readFileSync("invoices/data/vendors.json", "utf-8"));

  let invoice: Invoice | null;
  if (path.endsWith(".json")) invoice = JSON.parse(readFileSync(path, "utf-8"));
  else invoice = (await (await import("./extract")).extract(path)).invoice; // loaded only here: JSON mode needs no API key

  if (invoice === null) throw new Error("extraction returned nothing");
  const flags = checkInvoice(invoice, vendors);
  if (flags.length === 0) console.log("✓ no flags");
  for (const f of flags) console.log(`${f.severity === "high" ? "🔴" : f.severity === "medium" ? "🟠" : "⚪"} ${f.check}: ${f.message}`);
}
