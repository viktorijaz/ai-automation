// v0 step 4b: run extract() on every test invoice, compare with its answer key, report accuracy per field.
// Usage: npx tsx invoices/eval.ts            (all invoices in invoices/data/)
//        npx tsx invoices/eval.ts inv-01     (only names containing "inv-01")
//        npx tsx invoices/eval.ts --cached   (re-score the last run's answers, no API calls)
//        npx tsx invoices/eval.ts inv-03 --repeat 20   (same invoice 20 times: error rate + interval, random vs systematic)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extract, costUsd, tidy, MODEL, type Invoice } from "./extract";

const DATA = "invoices/data";
const RESULTS = "invoices/results";
const FILE = /\.(pdf|png|jpe?g)$/i;

// ---------- Compare one value ----------

// Dash variants (– — ‐ −) and runs of spaces can't be told apart on a scan; treat them as equal
function normalize(s: string): string {
  return s.replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim();
}

function same(expected: unknown, got: unknown): boolean {
  if (typeof expected === "number" && typeof got === "number") return Math.abs(expected - got) < 0.005; // cents
  if (typeof expected === "string" && typeof got === "string") return normalize(expected) === normalize(got);
  return expected === got; // null === null; anything else must match exactly
}

type Check = { field: string; expected: unknown; got: unknown; ok: boolean };

// Every top-level field, then every line field; a missing or extra line counts as wrong
function compare(expected: Invoice, got: Invoice | null): Check[] {
  const checks: Check[] = [];
  for (const field of Object.keys(expected) as (keyof Invoice)[]) {
    if (field === "lines") continue;
    checks.push({ field, expected: expected[field], got: got?.[field] ?? null, ok: same(expected[field], got?.[field] ?? null) });
  }
  const lines = Math.max(expected.lines.length, got?.lines.length ?? 0);
  for (let i = 0; i < lines; i++) {
    for (const key of ["description", "quantity", "unit_price", "amount"] as const) {
      const e = expected.lines[i]?.[key] ?? null;
      const g = got?.lines[i]?.[key] ?? null;
      checks.push({ field: `lines[].${key}`, expected: e, got: g, ok: same(e, g) });
    }
  }
  return checks;
}

// ---------- Run ----------

const args = process.argv.slice(2);
const cached = args.includes("--cached");
const repeatAt = args.indexOf("--repeat");
const repeat = repeatAt === -1 ? 1 : Number(args[repeatAt + 1]);
if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat needs a whole number, e.g. --repeat 20");
if (cached && repeat > 1) throw new Error("--cached and --repeat don't mix: a cached run has one answer per invoice");
const filter = args.find((a, i) => !a.startsWith("--") && i !== repeatAt + 1) ?? "";

// --cached: Claude's answers from the newest saved run (file names sort by time)
let saved: Record<string, Invoice | null> = {};
let model = MODEL; // a cached run reports the model that produced the answers
if (cached) {
  const runs = existsSync(RESULTS) ? readdirSync(RESULTS).filter((f) => f.endsWith(".json")).sort() : [];
  if (runs.length === 0) throw new Error(`--cached: no saved runs in ${RESULTS}`);
  const last = JSON.parse(readFileSync(join(RESULTS, runs[runs.length - 1]), "utf-8"));
  if (!last.outputs) throw new Error(`--cached: ${runs[runs.length - 1]} has no saved answers (older run); run once without --cached`);
  saved = last.outputs;
  model = last.model;
  console.log(`--cached: using ${runs[runs.length - 1]}\n`);
}
const files = readdirSync(DATA).filter((f) => FILE.test(f) && f.includes(filter)).sort();
if (files.length === 0) throw new Error(`no test invoices in ${DATA} matching "${filter}"`);

const perField = new Map<string, { ok: number; all: number }>();
const report: { file: string; correct: number; total: number; misses: Check[] }[] = [];
const outputs: Record<string, Invoice | null> = {};
let cost = 0;

for (const file of files) {
  const keyPath = join(DATA, file.replace(FILE, ".expected.json"));
  if (!existsSync(keyPath)) {
    console.log(`${file}: skipped, no answer key`);
    continue;
  }
  const expected: Invoice = JSON.parse(readFileSync(keyPath, "utf-8"));
  if (cached && !(file in saved)) {
    console.log(`${file}: skipped, not in the cached run`);
    continue;
  }

  // field → wrong value → how many runs returned it (one value = systematic, many = random)
  const wrong = new Map<string, Map<string, number>>();
  let fileCorrect = 0;
  let fileTotal = 0;

  for (let run = 0; run < repeat; run++) {
    let invoice: Invoice | null;
    if (cached) invoice = saved[file] && tidy(saved[file]); // older runs were saved before tidy() existed
    else {
      const result = await extract(join(DATA, file));
      invoice = result.invoice;
      cost += costUsd(result.usage);
    }
    if (run === 0) outputs[file] = invoice;

    const checks = compare(expected, invoice);
    for (const c of checks) {
      const f = perField.get(c.field) ?? { ok: 0, all: 0 };
      f.all++;
      if (c.ok) f.ok++;
      perField.set(c.field, f);
    }
    const misses = checks.filter((c) => !c.ok);
    fileCorrect += checks.length - misses.length;
    fileTotal += checks.length;
    report.push({ file, correct: checks.length - misses.length, total: checks.length, misses });

    if (repeat === 1) {
      console.log(`${file}: ${checks.length - misses.length}/${checks.length}${invoice === null ? "  (no output)" : ""}`);
      for (const m of misses) console.log(`   ✗ ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}`);
    }
    for (const m of misses) {
      const values = wrong.get(m.field) ?? new Map<string, number>();
      const v = JSON.stringify(m.got);
      values.set(v, (values.get(v) ?? 0) + 1);
      wrong.set(m.field, values);
    }
  }

  if (repeat > 1) {
    console.log(`${file}: ${fileCorrect}/${fileTotal} over ${repeat} runs`);
    for (const [field, values] of wrong) {
      const misses = [...values.values()].reduce((a, b) => a + b, 0);
      const kind = values.size === 1 && misses > 1 ? "same value every time → systematic" : values.size > 1 ? "different values → random" : "once";
      console.log(`   ✗ ${field}: wrong in ${misses}/${repeat} runs (${kind})`);
      for (const [v, n] of values) console.log(`       ${v} ×${n}`);
    }
  }
}

// 95% Wilson interval for a proportion: honest even at 0/n or n/n, unlike ±1.96·√(p(1−p)/n)
function wilson(k: number, n: number): [number, number] {
  const z = 1.96;
  const p = k / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// ---------- Summary ----------

if (report.length === 0) throw new Error("nothing was scored");

console.log(`\nAccuracy per field (${model}${cached ? ", cached" : ""}):`);
for (const [field, { ok, all }] of [...perField].sort((a, b) => a[1].ok / a[1].all - b[1].ok / b[1].all)) {
  const [lo, hi] = wilson(ok, all);
  const ci = repeat > 1 ? `  95% CI ${Math.round(100 * lo)}–${Math.round(100 * hi)}%` : "";
  console.log(`  ${field.padEnd(22)} ${String(Math.round((100 * ok) / all)).padStart(3)}%  (${ok}/${all})${ci}`);
}
const correct = report.reduce((s, r) => s + r.correct, 0);
const total = report.reduce((s, r) => s + r.total, 0);
console.log(`\nOverall: ${correct}/${total} fields = ${((100 * correct) / total).toFixed(1)}%  ·  ${new Set(report.map((r) => r.file)).size} invoices${repeat > 1 ? ` × ${repeat} runs` : ""}  ·  $${cost.toFixed(3)}`);

// Saved per run, so a prompt or model change can be compared with the last result
mkdirSync(RESULTS, { recursive: true });
const out = join(RESULTS, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify({ model, cached, repeat, correct, total, cost, report, outputs }, null, 2));
console.log(`Saved: ${out}`);
