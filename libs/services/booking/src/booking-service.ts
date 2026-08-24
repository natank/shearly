import pg from 'pg';
import { ConflictError, NotFoundError } from '@shearly/shared-errors';
import type { BookingState } from '@shearly/domain-booking-state-machine';
import { insertOutboxEvent } from '@shearly/shared-events';

export type BookingRow = {
  id: string;
  customer_id: string;
  provider_id: string;
  service_id: string;
  state: BookingState;
  price_minor: number;
  currency: string;
  slot_start: Date;
  slot_end: Date;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  address_line: string;
  access_notes: string;
  response_deadline: Date | null;
  auto_complete_at: Date | null;
  decline_reason: string | null;
  created_at: Date;
};

const BOOKING_COLS = `id, customer_id, provider_id, service_id, state, price_minor, currency,
  slot_start, slot_end, buffer_before_minutes, buffer_after_minutes,
  address_line, access_notes, response_deadline, auto_complete_at, decline_reason, created_at`;

export type CreateBookingInput = {
  customerId: string;
  providerId: string;
  serviceId: string;
  priceMinor: number;
  currency: string;
  slotStart: Date;
  slotEnd: Date;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  addressLine: string;
  accessNotes: string;
  responseDeadline: Date;
};

export class BookingService {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Inserts the booking row and its occupancy range in one statement. The
   * GiST exclusion constraint (design §7.3, M4-P1) is what actually enforces
   * BOK-002 — this method surfaces that violation as ConflictError rather
   * than a raw Postgres error code.
   */
  async create(input: CreateBookingInput): Promise<BookingRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<BookingRow>(
        `INSERT INTO booking.bookings
           (customer_id, provider_id, service_id, state, price_minor, currency,
            slot_start, slot_end, buffer_before_minutes, buffer_after_minutes,
            occupancy, address_line, access_notes, response_deadline)
         VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8::integer, $9::integer,
           tstzrange($6::timestamptz - make_interval(mins => $8::integer),
                     $7::timestamptz + make_interval(mins => $9::integer), '[)'),
           $10, $11, $12)
         RETURNING ${BOOKING_COLS}`,
        [
          input.customerId,
          input.providerId,
          input.serviceId,
          input.priceMinor,
          input.currency,
          input.slotStart,
          input.slotEnd,
          input.bufferBeforeMinutes,
          input.bufferAfterMinutes,
          input.addressLine,
          input.accessNotes,
          input.responseDeadline,
        ],
      );
      const booking = result.rows[0];
      await insertOutboxEvent(client, 'booking', 'BookingStateChanged', {
        bookingId: booking.id,
        fromState: booking.state,
        toState: booking.state,
        event: 'created',
        actor: 'customer',
      });
      await client.query('COMMIT');
      return booking;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isExclusionViolation(error)) {
        throw new ConflictError('booking.slotTaken');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(bookingId: string): Promise<BookingRow | null> {
    const result = await this.pool.query<BookingRow>(
      `SELECT ${BOOKING_COLS} FROM booking.bookings WHERE id = $1`,
      [bookingId],
    );
    return result.rows[0] ?? null;
  }

  async requireById(bookingId: string): Promise<BookingRow> {
    const booking = await this.getById(bookingId);
    if (!booking) {
      throw new NotFoundError('booking.notFound');
    }
    return booking;
  }

  /**
   * Applies a state-machine transition result: new state + audit row, in
   * one transaction. `autoCompleteAt`/`remindAt` are only ever passed on
   * the `ProviderAccepts` transition into `CONFIRMED` (design §6.6's
   * due-work poller needs `autoCompleteAt` to claim auto-complete-eligible
   * bookings; NOT-002 needs `remindAt` to schedule the reminder) — every
   * other caller omits them and `auto_complete_at` is left as
   * COALESCE(existing). `remindAt` is undefined rather than omitted when
   * the booking was confirmed too close to its own slot for a reminder to
   * make sense ("where scheduling permits", NOT-002) — no reminder row is
   * inserted in that case.
   *
   * Leaving `CONFIRMED` for any other state (cancel, no-show, complete)
   * invalidates any pending reminder row outright — NOT-002's own
   * acceptance criterion is that a cancelled-before-window booking sends
   * nothing, not that it's merely skipped by timing luck.
   */
  async applyTransition(
    bookingId: string,
    nextState: BookingState,
    event: string,
    actor: 'customer' | 'provider' | 'system' | 'admin',
    reason?: string,
    autoCompleteAt?: Date,
    remindAt?: Date,
  ): Promise<BookingRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<BookingRow>(
        `SELECT ${BOOKING_COLS} FROM booking.bookings WHERE id = $1 FOR UPDATE`,
        [bookingId],
      );
      const booking = current.rows[0];
      if (!booking) {
        throw new NotFoundError('booking.notFound');
      }
      const updated = await client.query<BookingRow>(
        `UPDATE booking.bookings SET state = $2, decline_reason = COALESCE($3, decline_reason),
           auto_complete_at = COALESCE($4, auto_complete_at), updated_at = now()
         WHERE id = $1 RETURNING ${BOOKING_COLS}`,
        [bookingId, nextState, reason ?? null, autoCompleteAt ?? null],
      );
      await client.query(
        `INSERT INTO booking.state_transitions (booking_id, from_state, to_state, event, actor, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bookingId, booking.state, nextState, event, actor, reason ?? null],
      );
      if (nextState === 'CONFIRMED' && remindAt) {
        await client.query(
          `INSERT INTO booking.reminders (booking_id, remind_at) VALUES ($1, $2)`,
          [bookingId, remindAt],
        );
      } else if (booking.state === 'CONFIRMED' && nextState !== 'CONFIRMED') {
        await client.query(
          `DELETE FROM booking.reminders WHERE booking_id = $1 AND sent_at IS NULL`,
          [bookingId],
        );
      }
      await insertOutboxEvent(client, 'booking', 'BookingStateChanged', {
        bookingId,
        fromState: booking.state,
        toState: nextState,
        event,
        actor,
      });
      if (nextState === 'COMPLETED') {
        await insertOutboxEvent(client, 'booking', 'BookingCompleted', {
          bookingId,
          providerId: booking.provider_id,
          customerId: booking.customer_id,
          grossMinor: booking.price_minor,
          currency: booking.currency,
        });
      }
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listUpcomingAndPast(
    customerId: string,
    now: Date = new Date(),
  ): Promise<{ upcoming: BookingRow[]; past: BookingRow[] }> {
    const result = await this.pool.query<BookingRow>(
      `SELECT ${BOOKING_COLS} FROM booking.bookings WHERE customer_id = $1 ORDER BY slot_start ASC`,
      [customerId],
    );
    const upcoming = result.rows.filter((row) => row.slot_start.getTime() >= now.getTime());
    const past = result.rows
      .filter((row) => row.slot_start.getTime() < now.getTime())
      .sort((a, b) => b.slot_start.getTime() - a.slot_start.getTime());
    return { upcoming, past };
  }

  async listByProvider(providerId: string): Promise<BookingRow[]> {
    const result = await this.pool.query<BookingRow>(
      `SELECT ${BOOKING_COLS} FROM booking.bookings WHERE provider_id = $1 ORDER BY slot_start DESC`,
      [providerId],
    );
    return result.rows;
  }
}

function isExclusionViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23P01'
  );
}
