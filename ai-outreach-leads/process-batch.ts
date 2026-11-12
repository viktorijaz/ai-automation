// v3.0: run ONE batch from the command line. Supabase: DATABASE_URL="$SUPA" npx tsx process-batch.ts
import { db } from "./core/db";
import { processBatch } from "./pipeline";

const size = Number(process.argv[2] ?? 5);
console.log(await processBatch(size, "all-orgs"));
await db.end();
