-- Migration 005: each lead gets at most one email per customer
-- Run once:
--   docker exec -i outreach-db psql -U outreach < migrations/005_one_email_per_lead.sql

BEGIN;

-- Delete older duplicates, keep the newest email per lead (receipts in ai_usage stay)
DELETE FROM emails older
USING emails newer
WHERE older.org_id = newer.org_id
  AND older.lead_name = newer.lead_name
  AND older.company = newer.company
  AND older.id < newer.id;

-- From now on the database refuses a second email for the same lead
ALTER TABLE emails ADD CONSTRAINT emails_one_per_lead UNIQUE (org_id, lead_name, company);

-- A paid call whose email lost a race with another run
ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_status_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_status_check
  CHECK (status IN ('pending', 'saved', 'parse_failed', 'check_failed', 'blocked', 'duplicate'));

COMMIT;
