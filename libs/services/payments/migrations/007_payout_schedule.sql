-- PAY-006: scheduled payout cadence on top of OPS-005's manual trigger.
-- next_payout_at is set once a provider's Connect onboarding completes
-- (the earliest point a payout is ever possible) and advanced by the
-- poller after each scheduled attempt, whether or not it found a
-- positive balance — a zero-balance week still resets the clock rather
-- than re-claiming the row on every subsequent poll tick.
ALTER TABLE payments.connect_accounts ADD COLUMN IF NOT EXISTS next_payout_at timestamptz;

CREATE INDEX IF NOT EXISTS connect_accounts_next_payout_at
  ON payments.connect_accounts (next_payout_at)
  WHERE status = 'complete';
