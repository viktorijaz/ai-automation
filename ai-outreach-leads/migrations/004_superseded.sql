-- v1b fixes: a receipt for a call whose result was dropped, because a newer run owns the row
BEGIN;

ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_status_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_status_check
  CHECK (status IN ('pending', 'saved', 'parse_failed', 'check_failed', 'blocked', 'duplicate', 'refused', 'superseded'));

-- the daily cap counts an org's receipts of the last 24 hours
CREATE INDEX ai_usage_org_created_idx ON ai_usage (org_id, created_at);

COMMIT;
