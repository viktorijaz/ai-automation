// The checks on the answer keys (a perfect extraction), plus Claude's real misread IBAN from the first eval
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkInvoice, ibanChecksumOk, type Vendors } from "./checks";
import type { Invoice } from "./extract";

const vendors: Vendors = JSON.parse(readFileSync("invoices/data/vendors.json", "utf-8"));
const load = (name: string): Invoice => JSON.parse(readFileSync(`invoices/data/${name}.expected.json`, "utf-8"));
const checksFor = (inv: Invoice) => checkInvoice(inv, vendors).map((f) => f.check);

describe("checkInvoice", () => {
  it("inv-01 clean invoice: no flags", () => {
    expect(checksFor(load("inv-01"))).toEqual([]);
  });

  it("inv-02 bad totals: lines don't add up to net", () => {
    expect(checksFor(load("inv-02"))).toEqual(["lines_vs_net"]);
  });

  it("inv-03 fraud: IBAN differs from the supplier's known IBAN", () => {
    expect(checksFor(load("inv-03"))).toEqual(["iban_changed"]);
  });

  it("inv-04 Macedonian and inv-05 Serbian scan: no flags", () => {
    expect(checksFor(load("inv-04"))).toEqual([]);
    expect(checksFor(load("inv-05"))).toEqual([]);
  });

  it("Claude's misread IBAN (one extra digit) is caught without any answer key", () => {
    const misread = { ...load("inv-03"), iban: "MK532100000007136510" };
    expect(checksFor(misread)).toEqual(expect.arrayContaining(["iban_length", "iban_checksum"]));
  });

  it("a total that doesn't match net + VAT", () => {
    expect(checksFor({ ...load("inv-01"), total: 15000 })).toEqual(["net_plus_vat"]);
  });

  it("a VAT rate that doesn't exist in the country", () => {
    expect(checksFor({ ...load("inv-01"), vat: 2000, total: 15200 })).toEqual(["vat_rate"]);
  });

  it("missing IBAN", () => {
    expect(checksFor({ ...load("inv-01"), iban: null })).toEqual(["missing_field"]);
  });
});

describe("ibanChecksumOk", () => {
  it("accepts real-format IBANs and rejects a one-digit change", () => {
    expect(ibanChecksumOk("MK07250120000058984")).toBe(true);
    expect(ibanChecksumOk("RS35260005601001611379")).toBe(true);
    expect(ibanChecksumOk("MK07250120000058985")).toBe(false);
  });
});
