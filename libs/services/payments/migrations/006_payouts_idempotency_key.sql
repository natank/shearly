-- OPS-005: payments.payouts gets its first writer this PR — a manual
-- payout trigger idempotent against a double-click via a client-supplied
-- key, same pattern as booking creation's Idempotency-Key header.
ALTER TABLE payments.payouts ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS payouts_idempotency_key
  ON payments.payouts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
