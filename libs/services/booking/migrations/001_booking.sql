CREATE EXTENSION IF NOT EXISTS postgis;
-- btree_gist supplies the uuid equality operator class the exclusion
-- constraint below needs for `provider_id WITH =` inside a GiST index.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $booking_schema$
BEGIN
  CREATE SCHEMA IF NOT EXISTS booking;
EXCEPTION
  WHEN duplicate_schema THEN NULL;
END
$booking_schema$;

CREATE TABLE IF NOT EXISTS booking.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  service_id uuid NOT NULL,
  state text NOT NULL CHECK (
    state IN (
      'PENDING',
      'CONFIRMED',
      'DECLINED',
      'EXPIRED',
      'COMPLETED',
      'CANCELLED_BY_CUSTOMER',
      'CANCELLED_BY_PROVIDER',
      'NO_SHOW_CUSTOMER',
      'NO_SHOW_PROVIDER'
    )
  ),
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  currency text NOT NULL DEFAULT 'ILS',
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL CHECK (slot_end > slot_start),
  buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  occupancy tstzrange NOT NULL,
  address_line text NOT NULL,
  access_notes text NOT NULL DEFAULT '',
  address_point geography(Point, 4326),
  response_deadline timestamptz,
  auto_complete_at timestamptz,
  decline_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bookings_customer_id ON booking.bookings (customer_id);
CREATE INDEX IF NOT EXISTS bookings_provider_id ON booking.bookings (provider_id);
CREATE INDEX IF NOT EXISTS bookings_state ON booking.bookings (state);
CREATE INDEX IF NOT EXISTS bookings_response_deadline ON booking.bookings (response_deadline)
  WHERE state = 'PENDING';
CREATE INDEX IF NOT EXISTS bookings_auto_complete_at ON booking.bookings (auto_complete_at)
  WHERE state = 'CONFIRMED';

-- BOK-002: occupancy uniqueness enforced by the database, not application logic.
-- A unique index on (provider_id, slot_start) is not sufficient — services have
-- variable duration and travel buffer applies before *and* after (design §7.3).
ALTER TABLE booking.bookings
  DROP CONSTRAINT IF EXISTS bookings_provider_occupancy_excl;

ALTER TABLE booking.bookings
  ADD CONSTRAINT bookings_provider_occupancy_excl
  EXCLUDE USING gist (
    provider_id WITH =,
    occupancy WITH &&
  ) WHERE (state IN ('PENDING', 'CONFIRMED'));

CREATE TABLE IF NOT EXISTS booking.state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES booking.bookings (id) ON DELETE CASCADE,
  from_state text NOT NULL,
  to_state text NOT NULL,
  event text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('customer', 'provider', 'system', 'admin')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS state_transitions_booking_id ON booking.state_transitions (booking_id);

CREATE TABLE IF NOT EXISTS booking.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES booking.bookings (id) ON DELETE CASCADE,
  remind_at timestamptz NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reminders_due ON booking.reminders (remind_at)
  WHERE sent_at IS NULL;
