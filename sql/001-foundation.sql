
CREATE TABLE IF NOT EXISTS staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid UNIQUE,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','bd','sales','engineering')),
  active boolean NOT NULL DEFAULT true,
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES staff,
  client text NOT NULL,
  title text NOT NULL,
  contact text NOT NULL DEFAULT '',
  venue text NOT NULL DEFAULT '',
  event_start date,
  event_end date,
  value numeric(20,4) NOT NULL DEFAULT 0 CHECK (value >= 0),
  stage text NOT NULL DEFAULT 'Enquiry',
  next_action text NOT NULL DEFAULT '',
  follow_up date,
  project_status text,
  project_note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES staff
);

CREATE TABLE IF NOT EXISTS opportunity_access (
  opportunity_id uuid REFERENCES opportunities ON DELETE CASCADE,
  staff_id uuid REFERENCES staff,
  PRIMARY KEY (opportunity_id, staff_id)
);

CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY,
  opportunity_id uuid NOT NULL REFERENCES opportunities,
  object_key text NOT NULL UNIQUE,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('project','commercial','purchasing')),
  uploaded_by uuid NOT NULL REFERENCES staff,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_sequences (
  series text NOT NULL,
  day date NOT NULL,
  last_number integer NOT NULL CHECK (last_number > 0),
  PRIMARY KEY (series, day)
);

CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities,
  base_reference text UNIQUE,
  created_by uuid NOT NULL REFERENCES staff,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quote_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('draft','issued','superseded','withdrawn','deleted')),
  reference text UNIQUE,
  document jsonb NOT NULL,
  pdf_id uuid REFERENCES files,
  issued_at timestamptz,
  issue_date date,
  updated_by uuid NOT NULL REFERENCES staff,
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 0,
  UNIQUE (quotation_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_draft ON quote_revisions (quotation_id) WHERE state = 'draft';

CREATE TABLE IF NOT EXISTS awards (
  opportunity_id uuid PRIMARY KEY REFERENCES opportunities,
  revision_id uuid NOT NULL REFERENCES quote_revisions,
  option_id text NOT NULL,
  addon_ids text[] NOT NULL DEFAULT '{}',
  net_amount numeric NOT NULL,
  tax_amount numeric NOT NULL,
  accepted_on date NOT NULL,
  evidence text NOT NULL,
  evidence_file_id uuid REFERENCES files,
  recorded_by uuid NOT NULL REFERENCES staff,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities,
  award_revision_id uuid NOT NULL REFERENCES quote_revisions,
  reference text UNIQUE,
  state text NOT NULL CHECK (state IN ('draft','pending','issued','partially_delivered','delivered','closed','cancelled')),
  document jsonb NOT NULL,
  pdf_id uuid REFERENCES files,
  issued_at timestamptz,
  updated_by uuid NOT NULL REFERENCES staff,
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES staff,
  actor_name text NOT NULL,
  opportunity_id uuid REFERENCES opportunities,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('project','commercial','purchasing','admin')),
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_opportunity ON quotations (opportunity_id);
CREATE INDEX IF NOT EXISTS order_opportunity ON supplier_orders (opportunity_id);
CREATE INDEX IF NOT EXISTS file_opportunity ON files (opportunity_id);
CREATE INDEX IF NOT EXISTS audit_opportunity ON audit_log (opportunity_id, id DESC);

CREATE OR REPLACE FUNCTION prevent_audit_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit entries are append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_is_append_only ON audit_log;
CREATE TRIGGER audit_is_append_only BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_edit();

ALTER TABLE awards ADD COLUMN IF NOT EXISTS client_po_reference text NOT NULL DEFAULT '';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS technical_scope text NOT NULL DEFAULT '';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS installation_date date;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS next_milestone text NOT NULL DEFAULT '';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS milestone_date date;
