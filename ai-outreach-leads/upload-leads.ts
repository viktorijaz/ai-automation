// v3.0: CSV → leads table as 'pending'. Usage: npx tsx upload-leads.ts data/leads.csv
// Supabase: DATABASE_URL="$SUPA" npx tsx upload-leads.ts data/leads.csv
import { db, readLeads } from "./pipeline.js";

const ORG_ID = "acme";
const file = process.argv[2] ?? "data/leads.csv";

const { leads, invalid } = readLeads(file);
for (const bad of invalid) console.warn(`  row ${bad.row}: ${bad.reason}`);

let added = 0;
for (const lead of leads) {
  // Already known lead (same org, name, company) → nothing inserted
  const result = await db.query(
    `INSERT INTO leads (org_id, name, company, role, website, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (org_id, name, company) DO NOTHING`,
    [ORG_ID, lead.name, lead.company, lead.role, lead.website, lead.note],
  );
  added += result.rowCount ?? 0;
}

console.log(
  `${file}: ${added} new, ${leads.length - added} already known, ${invalid.length} invalid`,
);

await db.end();
