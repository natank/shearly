-- RAT-003: provider replies publicly to a review. Reviews stay
-- one-directional otherwise (RAT-002 unchanged) — this only adds a single
-- provider-authored reply per review, not a threaded conversation.
ALTER TABLE catalog.reviews ADD COLUMN IF NOT EXISTS reply text;
ALTER TABLE catalog.reviews ADD COLUMN IF NOT EXISTS reply_created_at timestamptz;
