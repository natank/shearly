import { describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { migrateCatalog } from '@shearly/services-provider-catalog/migrate';
import { migrateBooking } from '@shearly/services-booking/migrate';
import { migratePayments } from '@shearly/services-payments/migrate';
import {
  NotificationService,
  type NotificationChannel,
  type EmailMessage,
} from '@shearly/services-notifications';
import type { BookingStateChangedPayload } from '@shearly/shared-events';

const url = process.env.DATABASE_URL;

function fakeChannel(): { channel: NotificationChannel; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    channel: { send: vi.fn(async (message: EmailMessage) => void sent.push(message)) },
    sent,
  };
}

async function seedBookingFixture(pool: pg.Pool) {
  const customer = await pool.query<{ id: string }>(
    `INSERT INTO identity.accounts (email, password_hash, role, locale)
     VALUES ($1, 'x', 'customer', 'he') RETURNING id`,
    [`cust-${crypto.randomUUID()}@example.com`],
  );
  const providerAccount = await pool.query<{ id: string }>(
    `INSERT INTO identity.accounts (email, password_hash, role, locale, provider_vetting_status)
     VALUES ($1, 'x', 'provider', 'en', 'approved') RETURNING id`,
    [`prov-${crypto.randomUUID()}@example.com`],
  );
  const provider = await pool.query<{ id: string }>(
    `INSERT INTO catalog.providers (account_id, status, listed) VALUES ($1, 'approved', true) RETURNING id`,
    [providerAccount.rows[0].id],
  );
  const service = await pool.query<{ id: string }>(
    `INSERT INTO catalog.services (provider_id, name, duration_minutes, price_minor)
     VALUES ($1, 'Cut', 60, 20000) RETURNING id`,
    [provider.rows[0].id],
  );
  const slotStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
  const booking = await pool.query<{ id: string }>(
    `INSERT INTO booking.bookings
       (customer_id, provider_id, service_id, state, price_minor, currency,
        slot_start, slot_end, occupancy, address_line, response_deadline)
     VALUES ($1, $2, $3, 'CONFIRMED', 20000, 'ILS', $4, $5,
       tstzrange($4::timestamptz, $5::timestamptz, '[)'), 'test street', $4)
     RETURNING id`,
    [customer.rows[0].id, provider.rows[0].id, service.rows[0].id, slotStart, slotEnd],
  );
  const customerEmail = (
    await pool.query<{ email: string }>('SELECT email FROM identity.accounts WHERE id = $1', [
      customer.rows[0].id,
    ])
  ).rows[0].email;
  const providerEmail = (
    await pool.query<{ email: string }>('SELECT email FROM identity.accounts WHERE id = $1', [
      providerAccount.rows[0].id,
    ])
  ).rows[0].email;
  return { bookingId: booking.rows[0].id, customerEmail, providerEmail };
}

describe('NotificationService (M5-P3)', () => {
  it('channel abstraction: swapping the transport requires no caller-side change (NOT-003)', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const pool = new pg.Pool({ connectionString: url });
    try {
      await migrateIdentity(url);
      await migrateCatalog(url);
      await migrateBooking(url);
      await migratePayments(url);
      const fixture = await seedBookingFixture(pool);

      const { channel, sent } = fakeChannel();
      const service = new NotificationService(pool, channel);
      const event: BookingStateChangedPayload = {
        bookingId: fixture.bookingId,
        fromState: 'PENDING',
        toState: 'CONFIRMED',
        event: 'ProviderAccepts',
        actor: 'provider',
      };
      await service.handleBookingStateChanged(event);

      expect(sent).toHaveLength(2);
      expect(sent.map((m) => m.to).sort()).toEqual(
        [fixture.customerEmail, fixture.providerEmail].sort(),
      );
    } finally {
      await pool.end();
    }
  });

  it('a registered handler for BookingStateChanged sends the correct template for the correct locale', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const pool = new pg.Pool({ connectionString: url });
    try {
      await migrateIdentity(url);
      await migrateCatalog(url);
      await migrateBooking(url);
      await migratePayments(url);
      const fixture = await seedBookingFixture(pool);

      const { channel, sent } = fakeChannel();
      const service = new NotificationService(pool, channel);
      await service.handleBookingStateChanged({
        bookingId: fixture.bookingId,
        fromState: 'PENDING',
        toState: 'CONFIRMED',
        event: 'ProviderAccepts',
        actor: 'provider',
      });

      const toCustomer = sent.find((m) => m.to === fixture.customerEmail);
      const toProvider = sent.find((m) => m.to === fixture.providerEmail);
      // Customer account was seeded with locale 'he', provider with 'en' —
      // the handler must resolve the template for each recipient's own
      // locale, not a shared default.
      expect(toCustomer?.subject).toBe('ההזמנה שלך אושרה');
      expect(toProvider?.subject).toBe('Booking confirmed');
      expect(toCustomer?.html).toMatch(/dir="rtl"/);
      expect(toProvider?.html).toMatch(/dir="ltr"/);
    } finally {
      await pool.end();
    }
  });

  it('an unknown booking id is a no-op, not a throw', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const pool = new pg.Pool({ connectionString: url });
    try {
      const { channel, sent } = fakeChannel();
      const service = new NotificationService(pool, channel);
      await service.handleBookingStateChanged({
        bookingId: crypto.randomUUID(),
        fromState: 'PENDING',
        toState: 'CONFIRMED',
        event: 'ProviderAccepts',
        actor: 'provider',
      });
      expect(sent).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });
});
