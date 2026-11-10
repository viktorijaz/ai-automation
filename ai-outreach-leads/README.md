# ai-outreach

**Live:** [ai-outreach-leads.vercel.app](https://ai-outreach-leads.vercel.app) (Google login, demo) · on Vercel + Supabase, scheduled by Supabase `pg_cron`, kept awake by GitHub Actions

Upload a CSV of leads; Claude writes a personalized cold email for each one, and every AI call is logged with its cost.

```
CSV ──► leads (the queue) ──► processBatch() ──► Claude ──► emails
                                                    └────► ai_usage (cost per call)
```

**Built in:** structured output, cost receipts with statuses, transactions, retries, CSV validation, a prompt-injection guard with unit tests, idempotency (no lead is ever emailed or paid for twice), Google login and one org per user.

**Stack:** Next.js, TypeScript, Postgres (Supabase), Claude API.

## Orgs and who processes what

Every lead, email and receipt has an `org_id`. A new user gets their own org on first login (trigger in `supabase/auth.sql`).

Two kinds of callers run batches, and each must say which leads it may touch (`Scope` in `pipeline.ts`, required, no default):

| Caller | Acts for | Scope |
|---|---|---|
| "Process now" button | one logged-in user | `{ orgId }`: only their org |
| `pg_cron` → `/api/process-leads` | the system (shared worker) | `"all-orgs"`, protected by `CRON_SECRET` |
| `process-batch.ts` (CLI) | the operator | `"all-orgs"` |

## Scheduling

`pg_cron` calls the route every 5 hours (`0 */5 * * *`, UTC), only when there are pending leads. 5 leads per run; "Process now" is the fast lane. The job lives in Supabase, not in git: `supabase/cron.sql` records it, `cron.alter_job` changes it.

## Run

```
npm install
docker compose up -d     # Postgres 17; schema.sql runs on first start
docker exec -i outreach-db psql -U outreach < migrations/001_leads_queue.sql
docker exec -i outreach-db psql -U outreach < migrations/002_orgs_members.sql
```

`.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgres://outreach:outreach@localhost:5432/outreach
CRON_SECRET=<a long random string>
DASHBOARD_ENABLED=true   # local only: skip login, act as org 'acme'
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

```
npm run dev                              # dashboard at http://localhost:3000
npx tsx upload-leads.ts data/leads.csv   # CSV → pending leads (org 'acme')
npx tsx process-batch.ts 5               # process up to 5 leads, all orgs
npm test                                 # unit tests
```

On Supabase: run `schema.sql` and the migrations, then `supabase/auth.sql` and `supabase/cron.sql` in the SQL editor.

## Next hardening

- **RLS** (row-level security) before the invoices module: today org isolation is enforced in the app's queries; RLS would make Postgres enforce it too, so one missed `WHERE org_id` can't leak data.
- **Price check at startup**: fail fast if `MODEL` has no entry in `PRICES`.

## Files

| File | What |
|---|---|
| `pipeline.ts` | parsing, the Claude call, receipts, the batch logic, `Scope` |
| `guard.ts` | the prompt-injection guard (tested in `guard.test.ts`) |
| `app/` | the dashboard, login, server actions and the `/api/process-leads` route |
| `proxy.ts`, `lib/supabase/` | session refresh and Supabase clients (server and browser) |
| `schema.sql`, `migrations/` | the baseline schema and later changes |
| `supabase/` | Supabase-only SQL: the new-user trigger and the cron job |
| `data/` | sample leads, a messy CSV and an attack CSV for testing |
