# ai-outreach

**Live:** [ai-outreach-leads.vercel.app](https://ai-outreach-leads.vercel.app) (Google login, demo) · on Vercel + Supabase, scheduled by Supabase `pg_cron`, kept awake by GitHub Actions

Two modules in one app (a modular monolith):

- **Outreach:** upload a CSV of leads; Claude writes a personalized cold email for each one.
- **Invoices** (Proof 7, see `invoices/README.md`): upload an invoice; Claude reads it, code checks it (fraud, math, duplicates), a person approves or rejects it.

Every AI call is logged with its cost, the module and the row it was for.

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

`pg_cron` calls the route every 5 hours (`0 */5 * * *`, UTC), only when there are pending leads or pending/stuck invoices. 5 leads and 3 invoices per run; "Process now" is the fast lane. The job lives in Supabase, not in git: `supabase/cron.sql` records it, `cron.alter_job` changes it.

## Run

```
npm install
docker compose up -d     # Postgres 17; schema.sql runs on first start
docker exec -i outreach-db psql -U outreach < migrations/001_leads_queue.sql
docker exec -i outreach-db psql -U outreach < migrations/002_orgs_members.sql
docker exec -i outreach-db psql -U outreach < migrations/003_invoices.sql
docker exec -i outreach-db psql -U outreach < migrations/004_superseded.sql
```

`.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgres://outreach:outreach@localhost:5432/outreach
CRON_SECRET=<a long random string>
DASHBOARD_ENABLED=true   # local only: skip login, act as org 'acme'
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # server only (invoice files); never NEXT_PUBLIC_, never in git
```

Invoice files always go to the Supabase Storage bucket, also from local dev (local Postgres has no storage). Invoice ids are random UUIDs, so local uploads can't overwrite production files.

```
npm run dev                              # dashboard at http://localhost:3000
npx tsx upload-leads.ts data/leads.csv   # CSV → pending leads (org 'acme')
npx tsx process-batch.ts 5               # process up to 5 leads, all orgs
npm test                                 # unit tests; the invoice flow tests need the local Postgres running
```

On Supabase: run `schema.sql` and the migrations, then `supabase/auth.sql`, `supabase/storage.sql` and `supabase/cron.sql` in the SQL editor.

**Deploying v1b (invoices) to the live app, once:**
1. Supabase SQL editor: run `migrations/003_invoices.sql` and `migrations/004_superseded.sql`, then `supabase/storage.sql` (the private bucket).
2. Vercel → project settings → environment variables: add `SUPABASE_SERVICE_ROLE_KEY` (from Supabase → Project Settings → API keys). Not `NEXT_PUBLIC_`.
3. Update the cron condition so it also wakes for invoices: re-run the `cron.schedule` block in `supabase/cron.sql` (same job name replaces it), or `cron.alter_job` with the new command.
4. Check your account is in the demo org `acme` (the demo supplier list is only used there; set `DEMO_ORG` on Vercel for another org).
5. Push to GitHub; Vercel deploys.

## Next hardening

- **RLS** (row-level security) before the invoices module: today org isolation is enforced in the app's queries; RLS would make Postgres enforce it too, so one missed `WHERE org_id` can't leak data.

## Files

| File | What |
|---|---|
| `core/` | shared by every module: `.env`, Postgres pool, Claude client + prices + receipts, file storage, `Scope` |
| `pipeline.ts` | outreach: parsing, the Claude call, the batch logic |
| `invoices/` | invoices: extract, checks, upload + sweep + decision (`intake.ts`), page queries; spec and results in its README |
| `guard.ts` | the prompt-injection guard (tested in `guard.test.ts`) |
| `app/` | the dashboards (leads at `/`, invoices at `/invoices`), login, server actions and the `/api/process-leads` cron route |
| `proxy.ts`, `lib/supabase/` | session refresh and Supabase clients (server and browser) |
| `schema.sql`, `migrations/` | the baseline schema and later changes |
| `supabase/` | Supabase-only SQL: the new-user trigger, the invoices bucket and the cron job |
| `data/` | sample leads, a messy CSV and an attack CSV for testing |
