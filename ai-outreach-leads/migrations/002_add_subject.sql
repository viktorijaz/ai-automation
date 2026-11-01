-- Migration 002: emails get a separate subject line (structured output { subject, body })
-- Run once against an existing database:
--   docker exec -i outreach-db psql -U outreach < migrations/002_add_subject.sql

ALTER TABLE emails ADD COLUMN subject text; -- which column?
