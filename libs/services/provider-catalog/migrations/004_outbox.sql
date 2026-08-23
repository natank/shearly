CREATE TABLE IF NOT EXISTS catalog.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  attempts int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS outbox_undispatched_idx
  ON catalog.outbox (created_at)
  WHERE dispatched_at IS NULL;
