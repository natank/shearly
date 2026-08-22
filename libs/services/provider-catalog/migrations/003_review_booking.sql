-- RAT-001: reviews must be tied to a specific COMPLETED booking, one per
-- booking. M3 seeded/test reviews predate the booking system (M3-Q5) and
-- stay booking_id IS NULL — only the M4 write path sets it, going forward.
ALTER TABLE catalog.reviews
  ADD COLUMN IF NOT EXISTS booking_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS reviews_booking_id_unique
  ON catalog.reviews (booking_id)
  WHERE booking_id IS NOT NULL;
