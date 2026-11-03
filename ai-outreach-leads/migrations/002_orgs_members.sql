-- Migration 002: organizations and their members (one org per user for now)

BEGIN;

CREATE TABLE orgs (
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- user_id is the Supabase Auth user id; no foreign key, so this also runs on plain Postgres
CREATE TABLE members (
  user_id     uuid        PRIMARY KEY,                -- one org per user
  org_id      text        NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  role        text        NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The existing data belongs to 'acme'
INSERT INTO orgs (id, name) VALUES ('acme', 'Acme (demo)') ON CONFLICT DO NOTHING;

-- Every row must belong to a real org
ALTER TABLE leads    ADD CONSTRAINT leads_org_fk    FOREIGN KEY (org_id) REFERENCES orgs (id);
ALTER TABLE emails   ADD CONSTRAINT emails_org_fk   FOREIGN KEY (org_id) REFERENCES orgs (id);
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_org_fk FOREIGN KEY (org_id) REFERENCES orgs (id);

COMMIT;
