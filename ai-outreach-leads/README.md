# ai-outreach

Upload a CSV of leads; Claude writes a personalized cold email for each one, and every AI call is logged with its cost.

```
CSV ──► leads (the queue) ──► processBatch() ──► Claude ──► emails
                                                    └────► ai_usage (cost per call)
```

**Built in:** structured output, cost receipts with statuses, transactions, retries, CSV validation, a prompt-injection guard with unit tests, and idempotency (no lead is ever emailed or paid for twice).

**Stack:** Next.js, TypeScript, Postgres (Supabase), Claude API.

## Run

```
npm install
docker compose up -d
docker exec -i outreach-db psql -U outreach < migrations/001_leads_queue.sql
```

`.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgres://outreach:outreach@localhost:5432/outreach
CRON_SECRET=<a long random string>
```

```
npm run dev                              # dashboard at http://localhost:3000
npx tsx upload-leads.ts data/leads.csv   # CSV → pending leads
npx tsx process-batch.ts 5               # process up to 5 leads
npm test                                 # unit tests
```

A scheduler processes batches through `POST /api/process-leads` (header `Authorization: Bearer $CRON_SECRET`).

> The dashboard has no login yet: local use only.

## Files

| File | What |
|---|---|
| `pipeline.ts` | parsing, the Claude call, receipts, the batch logic |
| `guard.ts` | the prompt-injection guard (tested in `guard.test.ts`) |
| `app/` | the dashboard and the `/api/process-leads` route |
| `schema.sql`, `migrations/` | the baseline schema and later changes |
| `data/` | sample leads, a messy CSV and an attack CSV for testing |
