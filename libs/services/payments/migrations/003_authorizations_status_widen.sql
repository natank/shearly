-- QCF-011: payments.authorizations.status was only ever set at
-- authorize/setup time and never updated by cancelAuthorization/capture/
-- refund, leaving a stale AUTHORIZED status forever after the first
-- operation. Widen the allowed values so those methods can record the
-- real outcome. The Stripe-side operation itself was always correct
-- (verified directly against the Stripe API) — this only fixes the local
-- read model.
ALTER TABLE payments.authorizations DROP CONSTRAINT authorizations_status_check;
ALTER TABLE payments.authorizations ADD CONSTRAINT authorizations_status_check
  CHECK (status IN ('SETUP_ONLY', 'AUTHORIZED', 'CANCELLED', 'CAPTURED', 'REFUNDED'));
