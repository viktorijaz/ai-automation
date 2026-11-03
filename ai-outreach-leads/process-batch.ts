// v3.0: run ONE batch from the command line. Supabase: DATABASE_URL="$SUPA" npx tsx process-batch.ts
import { db, processBatch } from "./pipeline.js";

const size = Number(process.argv[2] ?? 5);
console.log(await processBatch(size));
await db.end();
