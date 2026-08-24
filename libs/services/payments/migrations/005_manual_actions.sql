-- OPS-003: append-only audit trail for admin-triggered financial actions
-- (manual refunds, no-show outcome reversals) — same pattern as
-- payments.ledger (design §8.3): every row is a fact, never mutated.
CREATE TABLE IF NOT EXISTS payments.manual_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('refund', 'no_show_reversal')),
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  reason text NOT NULL,
  actor_account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manual_actions_booking_id ON payments.manual_actions (booking_id);
