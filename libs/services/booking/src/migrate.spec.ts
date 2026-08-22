import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { BOOKING_SERVICE_NAME } from './index.js';
import { migrateBooking } from './migrate.js';

const url = process.env.DATABASE_URL;

describe('booking migrate', () => {
  it('exports the service name', () => {
    expect(BOOKING_SERVICE_NAME).toBe('booking');
  });

  it('is idempotent', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P1)');
      }
      return;
    }
    await migrateBooking(url);
    expect(await migrateBooking(url)).toEqual([]);
  });

  it('enforces occupancy exclusion per provider (BOK-002)', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P1)');
      }
      return;
    }
    await migrateBooking(url);
    const pool = new pg.Pool({ connectionString: url });
    const providerId = crypto.randomUUID();
    const customerId = crypto.randomUUID();
    const serviceId = crypto.randomUUID();
    try {
      await pool.query('DELETE FROM booking.bookings WHERE provider_id = $1', [providerId]);

      const insert = (start: string, end: string) =>
        pool.query(
          `INSERT INTO booking.bookings
             (customer_id, provider_id, service_id, state, price_minor, slot_start, slot_end, occupancy, address_line)
           VALUES ($1, $2, $3, 'PENDING', 20000, $4, $5, tstzrange($4::timestamptz, $5::timestamptz, '[)'), 'qc-m4')`,
          [customerId, providerId, serviceId, start, end],
        );

      // First booking 09:00-10:00 succeeds.
      await insert('2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z');

      // Second booking with a *different* start (09:30) that overlaps the first
      // must be rejected by the exclusion constraint, not merely a unique-index miss.
      await expect(insert('2026-09-01T09:30:00Z', '2026-09-01T10:30:00Z')).rejects.toThrow(
        /exclusion/i,
      );

      // A booking that starts exactly when the first ends does not overlap ('[)' range) and succeeds.
      await insert('2026-09-01T10:00:00Z', '2026-09-01T11:00:00Z');
    } finally {
      await pool.query('DELETE FROM booking.bookings WHERE provider_id = $1', [providerId]);
      await pool.end();
    }
  });

  it('frees the occupancy interval immediately on terminal transition', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P1)');
      }
      return;
    }
    await migrateBooking(url);
    const pool = new pg.Pool({ connectionString: url });
    const providerId = crypto.randomUUID();
    const customerId = crypto.randomUUID();
    const serviceId = crypto.randomUUID();
    try {
      await pool.query('DELETE FROM booking.bookings WHERE provider_id = $1', [providerId]);

      const result = await pool.query<{ id: string }>(
        `INSERT INTO booking.bookings
           (customer_id, provider_id, service_id, state, price_minor, slot_start, slot_end, occupancy, address_line)
         VALUES ($1, $2, $3, 'PENDING', 20000, $4, $5, tstzrange($4::timestamptz, $5::timestamptz, '[)'), 'qc-m4')
         RETURNING id`,
        [customerId, providerId, serviceId, '2026-09-02T09:00:00Z', '2026-09-02T10:00:00Z'],
      );
      const bookingId = result.rows[0].id;

      // Cancel it (terminal state) — the exclusion constraint only applies to PENDING/CONFIRMED.
      await pool.query(`UPDATE booking.bookings SET state = 'CANCELLED_BY_CUSTOMER' WHERE id = $1`, [
        bookingId,
      ]);

      // The identical range is now bookable again.
      await pool.query(
        `INSERT INTO booking.bookings
           (customer_id, provider_id, service_id, state, price_minor, slot_start, slot_end, occupancy, address_line)
         VALUES ($1, $2, $3, 'PENDING', 20000, $4, $5, tstzrange($4::timestamptz, $5::timestamptz, '[)'), 'qc-m4')`,
        [customerId, providerId, serviceId, '2026-09-02T09:00:00Z', '2026-09-02T10:00:00Z'],
      );
    } finally {
      await pool.query('DELETE FROM booking.bookings WHERE provider_id = $1', [providerId]);
      await pool.end();
    }
  });
});
