-- Idempotency ledger (design §8.2). Every Stripe-mutating call inserts its
-- deterministic key here before calling Stripe; a retry with the same key
-- short-circuits to the stored result instead of calling Stripe again.
CREATE TABLE IF NOT EXISTS payments.operations (
  key text PRIMARY KEY,
  kind text NOT NULL CHECK (
    kind IN ('authorize', 'setup', 'cancel', 'capture', 'refund')
  ),
  booking_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'succeeded', 'failed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operations_booking_id ON payments.operations (booking_id);

-- Authorization state per booking (design §8.1's auth_horizon branch).
CREATE TABLE IF NOT EXISTS payments.authorizations (
  booking_id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('SETUP_ONLY', 'AUTHORIZED')),
  stripe_payment_intent_id text,
  stripe_setup_intent_id text,
  authorize_after timestamptz,
  reauthorize_by timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS authorizations_authorize_after ON payments.authorizations (authorize_after)
  WHERE status = 'SETUP_ONLY';

-- Append-only commission ledger (design §8.3). Balance is derived by
-- summation, never a mutable field — a replayed event cannot double-credit.
CREATE TABLE IF NOT EXISTS payments.ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('gross', 'commission', 'net')),
  amount_minor integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_booking_id ON payments.ledger (booking_id);

CREATE TABLE IF NOT EXISTS payments.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id uuid NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  triggered_by text NOT NULL CHECK (triggered_by IN ('admin', 'schedule')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payouts_provider_account_id ON payments.payouts (provider_account_id);

-- Webhooks are the source of truth for payment state (design §8.1). Recording
-- event.id with a unique constraint makes Stripe's at-least-once delivery
-- idempotent — a replayed event is a no-op, not a double-processed one.
CREATE TABLE IF NOT EXISTS payments.webhook_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
