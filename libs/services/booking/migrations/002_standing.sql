-- RecordStanding effect (design §7.4): response_miss, provider_cancel,
-- provider_no_show. OPS-004's dashboard is M5; this table is the write side
-- so the effect exists from the first transition that can trigger it.
CREATE TABLE IF NOT EXISTS booking.standing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES booking.bookings (id) ON DELETE CASCADE,
  provider_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('response_miss', 'provider_cancel', 'provider_no_show')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS standing_events_provider_id ON booking.standing_events (provider_id);
