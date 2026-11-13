// Upload and decision rules (no database, no API)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Flag } from "./checks";
import { decisionError, detectType, MAX_BYTES, uploadError } from "./rules";

const high: Flag = { check: "iban_changed", severity: "high", message: "" };
const medium: Flag = { check: "lines_vs_net", severity: "medium", message: "" };

describe("detectType", () => {
  it("reads the type from the content", () => {
    expect(detectType(readFileSync("invoices/data/inv-01.pdf"))).toBe("application/pdf");
    expect(detectType(readFileSync("invoices/data/inv-05.png"))).toBe("image/png");
    expect(detectType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });

  it("ignores the name: HTML called invoice.pdf is rejected", () => {
    expect(detectType(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
  });
});

describe("uploadError", () => {
  it("accepts a real invoice", () => {
    expect(uploadError(readFileSync("invoices/data/inv-01.pdf"))).toBeNull();
  });

  it("rejects empty, too large and unknown files", () => {
    expect(uploadError(Buffer.alloc(0))).toMatch(/Choose/);
    expect(uploadError(Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_BYTES)]))).toMatch(/larger/);
    expect(uploadError(Buffer.from("hello"))).toMatch(/Only PDF/);
  });
});

describe("decisionError", () => {
  it("needs a note to approve with a 🔴 flag, not with 🟠 only", () => {
    expect(decisionError([high], "approved", "")).toMatch(/🔴/);
    expect(decisionError([high], "approved", "called the supplier")).toBeNull();
    expect(decisionError([medium], "approved", "")).toBeNull();
  });

  it("always needs a note to reject", () => {
    expect(decisionError([], "rejected", "")).toMatch(/why/);
    expect(decisionError([], "rejected", "wrong supplier")).toBeNull();
  });

  it("limits the note length", () => {
    expect(decisionError([], "approved", "x".repeat(1001))).toMatch(/longer/);
  });
});
