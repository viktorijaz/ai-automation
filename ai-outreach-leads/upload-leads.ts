// CSV → leads table as 'pending'. Usage: npx tsx upload-leads.ts data/leads.csv
// Supabase: DATABASE_URL="$SUPA" npx tsx upload-leads.ts data/leads.csv
import { addLeads, db, readLeads } from "./pipeline";

const ORG_ID = "acme";
const file = process.argv[2] ?? "data/leads.csv";

const { leads, invalid } = readLeads(file);
for (const bad of invalid) console.warn(`  row ${bad.row}: ${bad.reason}`);

const added = await addLeads(leads, ORG_ID);
console.log(`${file}: ${added} new, ${leads.length - added} already known, ${invalid.length} invalid`);

await db.end();
