-- Runs once, on the first start with an empty database (see compose.yaml).

-- One row per generated email
CREATE TABLE emails (
  id          bigserial   PRIMARY KEY,           -- auto-incrementing 1, 2, 3...
  org_id      text        NOT NULL,              -- which customer this belongs to
  lead_name   text        NOT NULL,
  company     text        NOT NULL,
  email_text  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now() -- filled in automatically
);

-- One row per AI call: the receipt
CREATE TABLE ai_usage (
  id             bigserial     PRIMARY KEY,
  org_id         text          NOT NULL,
  model          text          NOT NULL,
  input_tokens   integer       NOT NULL,
  output_tokens  integer       NOT NULL,
  cost_usd       numeric(12,6) NOT NULL,         -- exact decimal, never float, for money
  created_at     timestamptz   NOT NULL DEFAULT now()
);

-- "What did org X spend?" filters by org_id, so index it
CREATE INDEX ai_usage_org_id_idx ON ai_usage (org_id);
