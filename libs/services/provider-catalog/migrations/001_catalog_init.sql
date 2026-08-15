DO $catalog_schema$
BEGIN
  CREATE SCHEMA IF NOT EXISTS catalog;
EXCEPTION
  WHEN duplicate_schema THEN NULL;
END
$catalog_schema$;

CREATE TABLE IF NOT EXISTS catalog.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (
    status IN (
      'draft',
      'pending_review',
      'interview_scheduled',
      'approved',
      'rejected'
    )
  ),
  bio text,
  base_lat double precision,
  base_lng double precision,
  radius_km double precision,
  listed boolean NOT NULL DEFAULT false,
  decision_rationale text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES catalog.providers (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.vetting_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES catalog.providers (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('government_id', 'credential', 'portfolio')),
  original_name text NOT NULL,
  content_type text NOT NULL,
  checksum text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.document_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES catalog.vetting_documents (id) ON DELETE CASCADE,
  actor_account_id uuid NOT NULL,
  accessed_at timestamptz NOT NULL DEFAULT now()
);
