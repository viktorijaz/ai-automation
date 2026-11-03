-- Baseline schema (squashed from the v1.0–v1.6 migrations, which live on in git history). Never edit it.
-- Docker: runs automatically on the first start with an empty database (see compose.yaml).
-- Supabase or any fresh database: run once, then every file in migrations/ in order (001, 002, ...).

BEGIN;

-- One row per AI call: the receipt
CREATE TABLE ai_usage (
  id             bigserial     PRIMARY KEY,
  org_id         text          NOT NULL,
  model          text          NOT NULL,
  input_tokens   integer       NOT NULL,
  output_tokens  integer       NOT NULL,
  cost_usd       numeric(12,6) NOT NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  status         text          NOT NULL DEFAULT 'pending',
  CONSTRAINT ai_usage_status_check
    CHECK (status IN ('pending', 'saved', 'parse_failed', 'check_failed', 'blocked', 'duplicate'))
);

CREATE INDEX ai_usage_org_id_idx ON ai_usage (org_id);

-- One row per generated email, at most one per lead per customer
CREATE TABLE emails (
  id           bigserial   PRIMARY KEY,
  org_id       text        NOT NULL,
  lead_name    text        NOT NULL,
  company      text        NOT NULL,
  email_text   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  subject      text,
  ai_usage_id  bigint      REFERENCES ai_usage (id),
  CONSTRAINT emails_one_per_lead UNIQUE (org_id, lead_name, company)
);

COMMIT;
