CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE IF NOT EXISTS identity.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('customer', 'provider', 'admin')),
  locale text NOT NULL CHECK (locale IN ('en', 'he')),
  provider_vetting_status text CHECK (
    provider_vetting_status IS NULL
    OR provider_vetting_status IN (
      'draft',
      'pending_review',
      'interview_scheduled',
      'approved',
      'rejected'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_provider_status_role CHECK (
    (role = 'provider' AND provider_vetting_status IS NOT NULL)
    OR (role <> 'provider' AND provider_vetting_status IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_lower ON identity.accounts (lower(email));

CREATE TABLE IF NOT EXISTS identity.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_account_id ON identity.sessions (account_id);

CREATE TABLE IF NOT EXISTS identity.password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.auth_rate_limits (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  count integer NOT NULL CHECK (count >= 0)
);

CREATE TABLE IF NOT EXISTS identity.guest_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
