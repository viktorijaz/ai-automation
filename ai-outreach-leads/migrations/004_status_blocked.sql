-- Migration 004: a new status for emails stopped by the prompt-injection guard
-- Run once:
--   docker exec -i outreach-db psql -U outreach < migrations/004_status_blocked.sql

-- A CHECK constraint can't be edited, only replaced
ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_status_check;

ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_status_check
  CHECK (status IN ('pending', 'saved', 'parse_failed', 'check_failed', 'blocked'));
