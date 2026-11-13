// The whole invoice flow against the local Postgres; storage and the AI call are stand-ins.
// Skipped when the local database isn't running (docker compose up -d) or migration 003 is missing.
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY ??= "test-key-never-used";
  process.env.DEMO_ORG = "test-invoices"; // the org that gets the demo supplier list
  return { files: new Map<string, Buffer>(), failUpload: false, reply: null as null | (() => unknown) };
});

vi.mock("../core/files", () => ({
  putFile: async (_bucket: string, path: string, bytes: Buffer) => {
    if (fake.failUpload) throw new Error("upload failed: storage down");
    if (fake.files.has(path)) throw new Error("upload failed: exists");
    fake.files.set(path, bytes);
  },
  getFile: async (_bucket: string, path: string) => fake.files.get(path)!,
  signedUrl: async () => "https://example.test/signed",
}));

const usage = { input_tokens: 3000, output_tokens: 200 };
const expected = (name: string) => JSON.parse(readFileSync(`invoices/data/${name}.expected.json`, "utf-8"));
const answers = new Map<string, unknown>(); // first bytes of the file → the "AI" answer

vi.mock("./extract", async (original) => ({
  ...(await original<typeof import("./extract")>()),
  extractBytes: async (bytes: Buffer) => {
    if (fake.reply) return fake.reply();
    return { invoice: answers.get(bytes.toString("base64")) ?? null, refused: false, usage };
  },
}));

const { db } = await import("../core/db");
const { createInvoice, decideInvoice, processInvoiceNow, sweepInvoices } = await import("./intake");
const { getInvoice } = await import("./queries");

const ORG = "test-invoices";
const OTHER = "test-other-org";
const ready = await db
  .query(`SELECT 1 FROM invoices LIMIT 1`)
  .then(() => true)
  .catch(() => false);

function file(name: string, extra = ""): Buffer {
  const bytes = Buffer.concat([readFileSync(`invoices/data/${name}.pdf`), Buffer.from(extra)]);
  answers.set(bytes.toString("base64"), expected(name));
  return bytes;
}

async function upload(bytes: Buffer, org = ORG) {
  const r = await createInvoice(org, "upload.pdf", bytes);
  if (!r.ok) throw new Error(r.error);
  if (r.needsExtraction) await processInvoiceNow(org, r.id);
  return (await getInvoice(org, r.id))!;
}

async function receipts(id: string) {
  return (await db.query(`SELECT status FROM ai_usage WHERE module = 'invoices' AND entity_id = $1`, [id])).rows.map((r) => r.status);
}

async function clean() {
  await db.query(`DELETE FROM invoices WHERE org_id IN ($1, $2)`, [ORG, OTHER]);
  await db.query(`DELETE FROM ai_usage WHERE org_id IN ($1, $2)`, [ORG, OTHER]); // test data only; real receipts are never deleted
}

describe.skipIf(!ready)("invoice intake (local Postgres)", () => {
  beforeEach(async () => {
    await db.query(`INSERT INTO orgs (id, name) VALUES ($1, 'test'), ($2, 'other') ON CONFLICT DO NOTHING`, [ORG, OTHER]);
    await clean();
    fake.files.clear();
    fake.failUpload = false;
    fake.reply = null;
  });

  afterAll(async () => {
    if (!ready) return;
    await clean();
    await db.query(`DELETE FROM orgs WHERE id IN ($1, $2)`, [ORG, OTHER]);
    await db.end();
  });

  it("clean invoice: done, no flags, one saved receipt, file stored under org/id", async () => {
    const inv = await upload(file("inv-01"));
    expect(inv.status).toBe("done");
    expect(inv.flags).toEqual([]);
    expect(inv.file_path).toBe(`${ORG}/${inv.id}.pdf`);
    expect(await receipts(inv.id)).toEqual(["saved"]);
    expect(inv.cost_usd).toBeGreaterThan(0);
  });

  it("done-when 1 and 2: inv-03 → 🔴 iban_changed, inv-02 → 🟠 lines_vs_net", async () => {
    expect((await upload(file("inv-03"))).flags!.map((f) => f.check)).toEqual(["iban_changed"]);
    expect((await upload(file("inv-02"))).flags!.map((f) => f.check)).toEqual(["lines_vs_net"]);
  });

  it("done-when 3: the same file again → duplicate, no second AI call", async () => {
    const first = await upload(file("inv-01"));
    const again = await upload(file("inv-01"));
    expect(again.id).not.toBe(first.id);
    expect(again.flags!.map((f) => f.check)).toEqual(["duplicate"]);
    expect(again.fields).toEqual(first.fields);
    expect(await receipts(again.id)).toEqual([]);
  });

  it("a different file with the same supplier + number → duplicate after extraction", async () => {
    await upload(file("inv-01"));
    const resent = await upload(file("inv-01", "\n% re-sent"));
    expect(resent.flags!.map((f) => f.check)).toEqual(["duplicate"]);
    expect(await receipts(resent.id)).toEqual(["saved"]);
  });

  it("failed upload: a visible failed row, no file, no AI call", async () => {
    fake.failUpload = true;
    const inv = await upload(file("inv-01"));
    expect(inv.status).toBe("failed");
    expect(inv.last_error).toMatch(/upload failed: something went wrong/);
    expect(inv.last_error).not.toMatch(/storage down/); // #5: the raw error stays in the log
    expect(inv.file_path).toBeNull();
    expect(await receipts(inv.id)).toEqual([]);
  });

  it("done-when 6: a reply that doesn't parse is paid for, recorded, and not retried", async () => {
    fake.reply = () => ({ invoice: null, refused: false, usage });
    const inv = await upload(file("inv-01"));
    expect(inv.status).toBe("failed");
    expect(await receipts(inv.id)).toEqual(["parse_failed"]);
  });

  it("a refusal is recorded as refused", async () => {
    fake.reply = () => ({ invoice: null, refused: true, usage });
    const inv = await upload(file("inv-01"));
    expect(inv.status).toBe("failed");
    expect(await receipts(inv.id)).toEqual(["refused"]);
  });

  it("an error leaves the invoice pending; the cron sweep finishes it", async () => {
    fake.reply = () => {
      throw new Error("overloaded");
    };
    const inv = await upload(file("inv-01"));
    expect(inv.status).toBe("pending");
    expect(inv.attempts).toBe(1);
    expect(inv.last_error).toBe("something went wrong on our side; will try again"); // not "overloaded"

    fake.reply = null;
    expect(await sweepInvoices(3, { orgId: ORG })).toMatchObject({ claimed: 1, done: 1 });
    expect((await getInvoice(ORG, inv.id))!.status).toBe("done");
  });

  it("#6: the sweep leaves an invoice for the next run when the 60 s limit is near", async () => {
    fake.reply = () => {
      throw new Error("overloaded");
    };
    await upload(file("inv-01", "first"));
    const second = await upload(file("inv-01", "second"));

    let now = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    fake.reply = () => {
      now += 30_000; // a slow call: no time for another 40 s one
      return { invoice: expected("inv-01"), refused: false, usage };
    };
    try {
      expect(await sweepInvoices(3, { orgId: ORG })).toMatchObject({ claimed: 2, done: 1, deferred: 1 });
    } finally {
      clock.mockRestore();
    }
    const left = (await getInvoice(ORG, second.id))!;
    expect(left.status).toBe("pending");
    expect(left.attempts).toBe(1); // the deferred run doesn't count as an attempt
  });

  it("#3: the IBAN flag shows only the last 4 digits; other orgs don't get the demo supplier list", async () => {
    const mine = await upload(file("inv-03"));
    const changed = mine.flags!.find((f) => f.check === "iban_changed")!;
    expect(changed.message).toMatch(/\(…\d{4}\)/);
    expect(changed.message).toContain("…8984");
    expect(changed.message).not.toContain("MK07250120000058984"); // the stored IBAN, from vendors.json

    const theirs = await upload(file("inv-03", "other org"), OTHER);
    expect(theirs.flags!.map((f) => f.check)).not.toContain("iban_changed");
    expect(JSON.stringify(theirs.flags)).not.toContain("Brightline");
  });

  it("#4: over the daily cap, an upload is refused and a queued invoice waits, without losing an attempt", async () => {
    fake.reply = () => {
      throw new Error("overloaded");
    };
    const queued = await upload(file("inv-01"));
    fake.reply = null;
    await db.query(
      `INSERT INTO ai_usage (org_id, module, model, input_tokens, output_tokens, cost_usd, status)
       SELECT $1, 'invoices', 'claude-haiku-5-5', 1, 1, 0, 'saved' FROM generate_series(1, 50)`,
      [ORG],
    );

    const refused = await createInvoice(ORG, "upload.pdf", file("inv-02"));
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/Daily limit/) });

    expect(await sweepInvoices(3, { orgId: ORG })).toMatchObject({ claimed: 1, deferred: 1, done: 0 });
    expect(await getInvoice(ORG, queued.id)).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("#7: a run that lost its claim doesn't overwrite the newer run's result", async () => {
    fake.reply = async () => {
      // While run A waits for the AI: the sweep releases it and run B claims it (attempts 1 → 2)
      await db.query(`UPDATE invoices SET attempts = attempts + 1 WHERE org_id = $1 AND status = 'processing'`, [ORG]);
      return { invoice: expected("inv-01"), refused: false, usage };
    };
    const inv = await upload(file("inv-01"));
    expect(inv).toMatchObject({ status: "processing", attempts: 2, fields: null }); // still B's, untouched by A
    expect(await receipts(inv.id)).toEqual(["superseded"]); // A's call was paid for: the receipt stays
  });

  it("#7: a failing old run doesn't reopen an invoice that's already done and approved", async () => {
    fake.reply = async () => {
      // While A waits: B claims, finishes, and the accountant approves
      await db.query(
        `UPDATE invoices SET attempts = attempts + 1, status = 'done', decision = 'approved', decided_by = 'ana@test', decided_at = now()
         WHERE org_id = $1 AND status = 'processing'`,
        [ORG],
      );
      throw new Error("overloaded");
    };
    const inv = await upload(file("inv-01"));
    expect(inv).toMatchObject({ status: "done", decision: "approved", last_error: null });
  });

  it("the sweep releases an invoice stuck in processing", async () => {
    const inv = await upload(file("inv-01"));
    await db.query(`UPDATE invoices SET status = 'processing', claimed_at = now() - interval '1 hour' WHERE id = $1`, [inv.id]);
    expect(await sweepInvoices(3, { orgId: ORG })).toMatchObject({ released: 1, claimed: 1, done: 1 });
  });

  it("done-when 7: 🔴 needs a note; the decision is recorded once, with who and when", async () => {
    const inv = await upload(file("inv-03"));
    expect(await decideInvoice(ORG, inv.id, "approved", "", "ana@test")).toMatch(/🔴/);
    expect(await decideInvoice(ORG, inv.id, "approved", "called the supplier", "ana@test")).toBeNull();
    expect(await decideInvoice(ORG, inv.id, "rejected", "changed my mind", "ana@test")).toMatch(/already/);

    const decided = (await getInvoice(ORG, inv.id))!;
    expect(decided).toMatchObject({ decision: "approved", decided_by: "ana@test", decision_note: "called the supplier" });
    expect(decided.decided_at).toBeInstanceOf(Date);
  });

  it("done-when 5: another org can't see, decide or sweep the invoice", async () => {
    const inv = await upload(file("inv-01"));
    expect(await getInvoice(OTHER, inv.id)).toBeNull();
    expect(await decideInvoice(OTHER, inv.id, "approved", "x", "eve@other")).toMatch(/isn't ready/);
    expect(await getInvoice(ORG, "not-a-uuid")).toBeNull();
  });
});
