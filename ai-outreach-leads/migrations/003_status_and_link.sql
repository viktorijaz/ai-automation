-- Migration 003: every receipt gets a status, every email points to its receipt
-- Run once:
--   docker exec -i outreach-db psql -U outreach < migrations/003_status_and_link.sql

-- What happened after we paid?
ALTER TABLE ai_usage
  ADD COLUMN status text NOT NULL DEFAULT 'pending' -- which status does every receipt start with?
  CHECK (status IN ('pending', 'saved', 'parse_failed', 'check_failed')); -- the two failure statuses

-- Which receipt paid for this email? (old emails have none, so it can be NULL)
ALTER TABLE emails
  ADD COLUMN ai_usage_id bigint REFERENCES ai_usage (id); -- which table does it point to?
