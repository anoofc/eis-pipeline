CREATE TABLE IF NOT EXISTS quotation_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document jsonb NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  image_key text UNIQUE,
  image_type text,
  image_name text,
  updated_by uuid NOT NULL REFERENCES staff,
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quotation_cost_plans (
  revision_id uuid NOT NULL REFERENCES quote_revisions,
  group_id uuid NOT NULL,
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  updated_by uuid NOT NULL REFERENCES staff,
  updated_at timestamptz NOT NULL DEFAULT now(),
  lock_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (revision_id, group_id)
);
