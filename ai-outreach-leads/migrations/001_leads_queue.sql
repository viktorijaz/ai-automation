-- Migration 001: the leads table is the queue (pending → processing → done / failed)

BEGIN;

CREATE TABLE leads (
  id          bigserial   PRIMARY KEY,
  org_id      text        NOT NULL,
  name        text        NOT NULL,
  company     text        NOT NULL,
  role        text        NOT NULL DEFAULT '',
  website     text        NOT NULL DEFAULT '',
  note        text        NOT NULL DEFAULT '',
  status      text        NOT NULL DEFAULT 'pending',
  attempts    integer     NOT NULL DEFAULT 0,
  claimed_at  timestamptz,                         -- when a run took it; old = that run crashed
  last_error  text,                                -- why the last attempt failed
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_status_check CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  CONSTRAINT leads_one_per_lead UNIQUE (org_id, name, company)
);

-- Only pending rows are indexed, so claiming stays fast however many leads are done
CREATE INDEX leads_pending_idx ON leads (id) WHERE status = 'pending';

COMMIT;
