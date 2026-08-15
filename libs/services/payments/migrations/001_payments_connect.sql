DO $payments_schema$
BEGIN
  CREATE SCHEMA IF NOT EXISTS payments;
EXCEPTION
  WHEN duplicate_schema THEN NULL;
END
$payments_schema$;

CREATE TABLE IF NOT EXISTS payments.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments.connect_accounts (
  account_id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('not_started', 'pending', 'complete')),
  stripe_account_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
