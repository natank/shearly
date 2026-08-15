CREATE TABLE IF NOT EXISTS identity.addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity.accounts (id) ON DELETE CASCADE,
  label text NOT NULL,
  line text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  access_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS addresses_account_id ON identity.addresses (account_id);
