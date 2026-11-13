-- Migration 003: invoices (Proof 7 v1b) and receipts that say what they were for

BEGIN;

-- One row per uploaded invoice; the table is also the queue (pending → processing → done / failed)
CREATE TABLE invoices (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(), -- random: unguessable in URLs, no clashes in storage
  org_id         text        NOT NULL REFERENCES orgs (id),
  file_name      text        NOT NULL,                  -- as uploaded; display only, never used in a path
  file_type      text        NOT NULL,                  -- detected from the content, not the name
  file_path      text,                                  -- storage path, set once the upload succeeded
  file_sha256    text        NOT NULL,
  status         text        NOT NULL DEFAULT 'pending',
  attempts       integer     NOT NULL DEFAULT 0,
  claimed_at     timestamptz,
  last_error     text,
  fields         jsonb,                                 -- what extract() returned
  flags          jsonb,                                 -- what the checks found
  decision       text,
  decided_by     text,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_status_check CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  CONSTRAINT invoices_decision_check CHECK (decision IN ('approved', 'rejected')),
  CONSTRAINT invoices_decided_together CHECK ((decision IS NULL) = (decided_at IS NULL))
);

CREATE INDEX invoices_org_created_idx ON invoices (org_id, created_at DESC);
CREATE INDEX invoices_org_sha_idx ON invoices (org_id, file_sha256);
CREATE INDEX invoices_pending_idx ON invoices (created_at) WHERE status = 'pending';

-- Receipts: which module made the call, and for which row (no foreign key: receipts outlive what they point at)
ALTER TABLE ai_usage ADD COLUMN module text NOT NULL DEFAULT 'outreach';
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_module_check CHECK (module IN ('outreach', 'invoices'));
ALTER TABLE ai_usage ADD COLUMN entity_id text;
CREATE INDEX ai_usage_entity_idx ON ai_usage (module, entity_id);

ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_status_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_status_check
  CHECK (status IN ('pending', 'saved', 'parse_failed', 'check_failed', 'blocked', 'duplicate', 'refused'));

COMMIT;
