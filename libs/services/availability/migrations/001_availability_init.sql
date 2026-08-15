DO $availability_schema$
BEGIN
  CREATE SCHEMA IF NOT EXISTS availability;
EXCEPTION
  WHEN duplicate_schema THEN NULL;
END
$availability_schema$;

CREATE TABLE IF NOT EXISTS availability.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS availability.weekly_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute integer NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  CHECK (end_minute > start_minute)
);

CREATE INDEX IF NOT EXISTS weekly_rules_account ON availability.weekly_rules (account_id);

CREATE TABLE IF NOT EXISTS availability.exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  on_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('block', 'extra')),
  start_minute integer,
  end_minute integer,
  CHECK (
    (kind = 'block' AND start_minute IS NULL AND end_minute IS NULL)
    OR (
      kind = 'extra'
      AND start_minute IS NOT NULL
      AND end_minute IS NOT NULL
      AND end_minute > start_minute
    )
  )
);

CREATE INDEX IF NOT EXISTS exceptions_account_date ON availability.exceptions (account_id, on_date);
