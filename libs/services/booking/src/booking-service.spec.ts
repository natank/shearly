import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { BookingService } from './booking-service.js';
import { migrateBooking } from './migrate.js';

const url = process.env.DATABASE_URL;

function baseInput(overrides: Partial<Parameters<BookingService['create']>[0]> = {}) {
  return {
    customerId: crypto.randomUUID(),
    providerId: crypto.randomUUID(),
    serviceId: crypto.randomUUID(),
    priceMinor: 20000,
    currency: 'ILS',
    slotStart: new Date('2026-10-01T09:00:00Z'),
    slotEnd: new Date('2026-10-01T10:00:00Z'),
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    addressLine: 'qc-m4 street',
    accessNotes: 'gate 2',
    responseDeadline: new Date('2026-09-29T09:00:00Z'),
    ...overrides,
  };
}

describe('BookingService', () => {
  it('creates a PENDING booking with the snapshotted price', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P3)');
      }
      return;
    }
    await migrateBooking(url);
    const pool = new pg.Pool({ connectionString: url });
    const svc = new BookingService(pool);
    const providerId = crypto.randomUUID();
    try {
      const booking = await svc.create(baseInput({ providerId }));
      expect(booking.state).toBe('PENDING');
      expect(booking.price_minor).toBe(20000);
      expect(booking.access_notes).toBe('gate 2');
    } finally {
      await pool.query('DELETE FROM booking.bookings WHERE provider_id = $1', [providerId]);
      await pool.end();
    }
  });

  it('rejects an overlapping booking on the same provider with ConflictError', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P3)');
      }
      return;
    }
    await migrateBooking(url);
    const pool = new pg.Pool({ connectionString: url });
    const svc = new BookingService(pool);
    const providerId = crypto.randomUUID();
    try {
      await svc.create(baseInput({ providerId }));
      await expect(
        svc.create(
          baseInput({
            providerId,
            slotStart: new Date('2026-10-01T09:30:00Z'),
            slotEnd: new Date('2026-10-01T10:30:00Z'),
          }),
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      await pool.query('DELETE FROM booking.bookings WHERE provider_id = $1', [providerId]);
      await pool.end();
    }
  });

  it('requireById throws NotFoundError for an unknown booking', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P3)');
      }
      return;
    }
    await migrateBooking(url);
    const pool = new pg.Pool({ connectionString: url });
    const svc = new BookingService(pool);
    try {
      await expect(svc.requireById(crypto.randomUUID())).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    } finally {
      await pool.end();
    }
  });

  it('applyTransition records the state change and an audit row', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P3)');
      }
      return;
    }
    await migrateBooking(url);
    const pool = new pg.Pool({ connectionString: url });
    const svc = new BookingService(pool);
    const providerId = crypto.randomUUID();
    try {
      const booking = await svc.create(baseInput({ providerId }));
      const updated = await svc.applyTransition(
        booking.id,
        'CONFIRMED',
        'ProviderAccepts',
        'provider',
      );
      expect(updated.state).toBe('CONFIRMED');

      const transitions = await pool.query(
        'SELECT from_state, to_state, event, actor FROM booking.state_transitions WHERE booking_id = $1',
        [booking.id],
      );
      expect(transitions.rows).toEqual([
        {
          from_state: 'PENDING',
          to_state: 'CONFIRMED',
          event: 'ProviderAccepts',
          actor: 'provider',
        },
      ]);
    } finally {
      await pool.query('DELETE FROM booking.bookings WHERE provider_id = $1', [providerId]);
      await pool.end();
    }
  });

  it('applyTransition on an unknown booking throws NotFoundError and rolls back', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P3)');
      }
      return;
    }
    await migrateBooking(url);
    const pool = new pg.Pool({ connectionString: url });
    const svc = new BookingService(pool);
    try {
      await expect(
        svc.applyTransition(crypto.randomUUID(), 'CONFIRMED', 'ProviderAccepts', 'provider'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await pool.end();
    }
  });

  it('splits bookings into upcoming (soonest-first) and past (most-recent-first)', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P3)');
      }
      return;
    }
    await migrateBooking(url);
    const pool = new pg.Pool({ connectionString: url });
    const svc = new BookingService(pool);
    const customerId = crypto.randomUUID();
    const now = new Date('2026-10-05T00:00:00Z');
    try {
      const past1 = await svc.create(
        baseInput({
          customerId,
          providerId: crypto.randomUUID(),
          slotStart: new Date('2026-10-01T09:00:00Z'),
          slotEnd: new Date('2026-10-01T10:00:00Z'),
        }),
      );
      const past2 = await svc.create(
        baseInput({
          customerId,
          providerId: crypto.randomUUID(),
          slotStart: new Date('2026-10-02T09:00:00Z'),
          slotEnd: new Date('2026-10-02T10:00:00Z'),
        }),
      );
      const future1 = await svc.create(
        baseInput({
          customerId,
          providerId: crypto.randomUUID(),
          slotStart: new Date('2026-10-10T09:00:00Z'),
          slotEnd: new Date('2026-10-10T10:00:00Z'),
        }),
      );
      const future2 = await svc.create(
        baseInput({
          customerId,
          providerId: crypto.randomUUID(),
          slotStart: new Date('2026-10-08T09:00:00Z'),
          slotEnd: new Date('2026-10-08T10:00:00Z'),
        }),
      );

      const { upcoming, past } = await svc.listUpcomingAndPast(customerId, now);
      expect(upcoming.map((b) => b.id)).toEqual([future2.id, future1.id]);
      expect(past.map((b) => b.id)).toEqual([past2.id, past1.id]);
    } finally {
      await pool.query('DELETE FROM booking.bookings WHERE customer_id = $1', [customerId]);
      await pool.end();
    }
  });

  it('search filters by provider, state, and date range — customerEmail is exercised at the apps/api layer, where identity.accounts is reachable without crossing the service/service module boundary', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P3)');
      }
      return;
    }
    await migrateBooking(url);
    const pool = new pg.Pool({ connectionString: url });
    const svc = new BookingService(pool);
    const providerId = crypto.randomUUID();
    const otherProviderId = crypto.randomUUID();
    try {
      const inRange = await svc.create(
        baseInput({
          providerId,
          slotStart: new Date('2026-10-05T09:00:00Z'),
          slotEnd: new Date('2026-10-05T10:00:00Z'),
        }),
      );
      const outOfRange = await svc.create(
        baseInput({
          providerId,
          slotStart: new Date('2026-11-05T09:00:00Z'),
          slotEnd: new Date('2026-11-05T10:00:00Z'),
        }),
      );
      const otherProvider = await svc.create(
        baseInput({
          providerId: otherProviderId,
          slotStart: new Date('2026-10-06T09:00:00Z'),
          slotEnd: new Date('2026-10-06T10:00:00Z'),
        }),
      );
      await svc.applyTransition(inRange.id, 'CONFIRMED', 'ProviderAccepts', 'provider');

      const byProviderAndRange = await svc.search({
        providerId,
        from: new Date('2026-10-01T00:00:00Z'),
        to: new Date('2026-10-31T23:59:59Z'),
      });
      expect(byProviderAndRange.map((b) => b.id)).toEqual([inRange.id]);

      const byState = await svc.search({ state: 'CONFIRMED' });
      expect(byState.map((b) => b.id)).toContain(inRange.id);
      expect(byState.map((b) => b.id)).not.toContain(outOfRange.id);
      expect(byState.map((b) => b.id)).not.toContain(otherProvider.id);
    } finally {
      await pool.query('DELETE FROM booking.bookings WHERE provider_id = ANY($1)', [
        [providerId, otherProviderId],
      ]);
      await pool.end();
    }
  });
});
