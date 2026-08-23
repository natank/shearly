import { describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { AuthorizationService } from './authorization-service.js';
import { migratePayments } from './migrate.js';

const url = process.env.DATABASE_URL;

function fakeStripe() {
  let piCounter = 0;
  let siCounter = 0;
  return {
    paymentIntents: {
      create: vi.fn(async () => ({ id: `pi_${++piCounter}` })),
      capture: vi.fn(async () => ({ id: 'pi_captured' })),
      cancel: vi.fn(async () => ({ id: 'pi_cancelled' })),
    },
    setupIntents: {
      create: vi.fn(async () => ({ id: `si_${++siCounter}` })),
    },
    refunds: {
      create: vi.fn(async () => ({ id: 're_1' })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('AuthorizationService', () => {
  it('authorizes within the horizon with a manual-capture PaymentIntent', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      const result = await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day out, inside 6-day horizon
        },
        'pm_test',
      );
      expect(result.status).toBe('AUTHORIZED');
      expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);

      // Retry with the same bookingAttemptId must not call Stripe again.
      await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );
      expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('setup retry after success returns the stored result without calling Stripe again', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    const input = {
      bookingId,
      bookingAttemptId,
      amountMinor: 20000,
      currency: 'ILS',
      slotStart: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    };
    try {
      const first = await svc.authorizeOrSetup(input, 'pm_test');
      const second = await svc.authorizeOrSetup(input, 'pm_test');
      // The stored result round-trips through jsonb, so `authorizeAfter` comes
      // back as an ISO string on replay, not a Date — compare structurally.
      expect(second).toEqual({ ...first, authorizeAfter: expect.any(String) });
      expect(stripe.setupIntents.create).toHaveBeenCalledTimes(1);
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('setup retry after a prior failure rejects without calling Stripe again', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    stripe.setupIntents.create = vi.fn(async () => {
      throw new Error('setup_failed');
    });
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    const input = {
      bookingId,
      bookingAttemptId,
      amountMinor: 20000,
      currency: 'ILS',
      slotStart: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    };
    try {
      await expect(svc.authorizeOrSetup(input, 'pm_test')).rejects.toMatchObject({
        code: 'PAYMENT',
      });
      await expect(svc.authorizeOrSetup(input, 'pm_test')).rejects.toMatchObject({
        code: 'PAYMENT',
      });
      expect(stripe.setupIntents.create).toHaveBeenCalledTimes(1);
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('uses a SetupIntent beyond the auth_horizon', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      const result = await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000), // 20 days out
        },
        'pm_test',
      );
      expect(result.status).toBe('SETUP_ONLY');
      expect(stripe.setupIntents.create).toHaveBeenCalledTimes(1);
      expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('capture is idempotent against retry', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );

      await svc.capture(bookingId, 20000, 'USD');
      await svc.capture(bookingId, 20000, 'USD');
      expect(stripe.paymentIntents.capture).toHaveBeenCalledTimes(1);
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('refund is idempotent against retry, keyed by reason', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );
      await svc.capture(bookingId, 20000, 'USD');

      await svc.refund(bookingId, 10000, 'late_cancel', 'USD');
      await svc.refund(bookingId, 10000, 'late_cancel', 'USD');
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  // QCF-011: payments.authorizations.status was set once at authorize/setup
  // time and never updated by cancelAuthorization/capture/refund, leaving a
  // stale AUTHORIZED status forever after. These assert the real terminal
  // status lands in the table for each of the three effect methods.
  it('cancelAuthorization sets status to CANCELLED', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (QCF-011)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );

      await svc.cancelAuthorization(bookingId, bookingAttemptId);

      const row = await pool.query<{ status: string }>(
        'SELECT status FROM payments.authorizations WHERE booking_id = $1',
        [bookingId],
      );
      expect(row.rows[0]?.status).toBe('CANCELLED');
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('capture sets status to CAPTURED', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (QCF-011)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );

      await svc.capture(bookingId, 20000, 'USD');

      const row = await pool.query<{ status: string }>(
        'SELECT status FROM payments.authorizations WHERE booking_id = $1',
        [bookingId],
      );
      expect(row.rows[0]?.status).toBe('CAPTURED');
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('refund sets status to REFUNDED', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (QCF-011)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );
      await svc.capture(bookingId, 20000, 'USD');

      await svc.refund(bookingId, 10000, 'late_cancel', 'USD');

      const row = await pool.query<{ status: string }>(
        'SELECT status FROM payments.authorizations WHERE booking_id = $1',
        [bookingId],
      );
      expect(row.rows[0]?.status).toBe('REFUNDED');
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('authorize failure records a failed operation and throws PaymentError; retry short-circuits', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    stripe.paymentIntents.create = vi.fn(async () => {
      throw new Error('card_declined');
    });
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      await expect(
        svc.authorizeOrSetup(
          {
            bookingId,
            bookingAttemptId,
            amountMinor: 20000,
            currency: 'ILS',
            slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          'pm_test',
        ),
      ).rejects.toMatchObject({ code: 'PAYMENT' });

      // Retry with the same key sees the recorded failure and rejects without calling Stripe again.
      await expect(
        svc.authorizeOrSetup(
          {
            bookingId,
            bookingAttemptId,
            amountMinor: 20000,
            currency: 'ILS',
            slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          'pm_test',
        ),
      ).rejects.toMatchObject({ code: 'PAYMENT' });
      expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('setup failure records a failed operation and throws PaymentError', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    stripe.setupIntents.create = vi.fn(async () => {
      throw new Error('setup_failed');
    });
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      await expect(
        svc.authorizeOrSetup(
          {
            bookingId,
            bookingAttemptId,
            amountMinor: 20000,
            currency: 'ILS',
            slotStart: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
          },
          'pm_test',
        ),
      ).rejects.toMatchObject({ code: 'PAYMENT' });
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('capture without a prior authorization throws PaymentError', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    try {
      await expect(svc.capture(bookingId, 20000, 'USD')).rejects.toMatchObject({ code: 'PAYMENT' });
    } finally {
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('refund without a prior authorization throws PaymentError', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    try {
      await expect(svc.refund(bookingId, 10000, 'late_cancel', 'USD')).rejects.toMatchObject({
        code: 'PAYMENT',
      });
    } finally {
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('capture failure records a failed operation and throws PaymentError', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    stripe.paymentIntents.capture = vi.fn(async () => {
      throw new Error('capture_failed');
    });
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );
      await expect(svc.capture(bookingId, 20000, 'USD')).rejects.toMatchObject({ code: 'PAYMENT' });
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('refund failure records a failed operation and throws PaymentError', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    stripe.refunds.create = vi.fn(async () => {
      throw new Error('refund_failed');
    });
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );
      await svc.capture(bookingId, 20000, 'USD');
      await expect(svc.refund(bookingId, 10000, 'late_cancel', 'USD')).rejects.toMatchObject({
        code: 'PAYMENT',
      });
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('cancelAuthorization failure records a failed operation and throws PaymentError', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    stripe.paymentIntents.cancel = vi.fn(async () => {
      throw new Error('cancel_failed');
    });
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );
      await expect(svc.cancelAuthorization(bookingId, bookingAttemptId)).rejects.toMatchObject({
        code: 'PAYMENT',
      });
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('cancelAuthorization with no PaymentIntent on file (SETUP_ONLY) still succeeds and is a no-op toward Stripe', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000), // beyond horizon -> SETUP_ONLY
        },
        'pm_test',
      );
      await svc.cancelAuthorization(bookingId, bookingAttemptId);
      expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('stubs authorize/capture/refund/cancel when Stripe is not configured (local dev, demo, E2E)', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const svc = new AuthorizationService(pool, '', 6);
    expect(svc.isStubbed()).toBe(true);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      const result = await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );
      expect(result.status).toBe('AUTHORIZED');
      if (result.status === 'AUTHORIZED') {
        expect(result.stripePaymentIntentId).toMatch(/^pi_stub_/);
      }

      await svc.capture(bookingId, 20000, 'USD');
      await svc.refund(bookingId, 10000, 'late_cancel', 'USD');
      await svc.cancelAuthorization(bookingId, bookingAttemptId);
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('isStubbed is false when a Stripe client is provided', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    const pool = new pg.Pool({ connectionString: url });
    const svc = new AuthorizationService(pool, fakeStripe(), 6);
    try {
      expect(svc.isStubbed()).toBe(false);
    } finally {
      await pool.end();
    }
  });

  it('rekeyToBooking moves the authorization from the attempt id to the real booking id', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P3)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingAttemptId = crypto.randomUUID();
    const realBookingId = crypto.randomUUID();
    try {
      await svc.authorizeOrSetup(
        {
          bookingId: bookingAttemptId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );

      await svc.rekeyToBooking(bookingAttemptId, realBookingId);

      const beforeRow = await pool.query(
        'SELECT * FROM payments.authorizations WHERE booking_id = $1',
        [bookingAttemptId],
      );
      expect(beforeRow.rowCount).toBe(0);

      const afterRow = await pool.query(
        'SELECT status FROM payments.authorizations WHERE booking_id = $1',
        [realBookingId],
      );
      expect(afterRow.rows[0]?.status).toBe('AUTHORIZED');

      // capture now resolves against the real booking id.
      await svc.capture(realBookingId, 20000, 'USD');
      expect(stripe.paymentIntents.capture).toHaveBeenCalledTimes(1);
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [
        realBookingId,
      ]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingAttemptId]);
      await pool.end();
    }
  });

  it('cancelAuthorization is idempotent and cancels the PaymentIntent', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    try {
      await svc.authorizeOrSetup(
        {
          bookingId,
          bookingAttemptId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );

      await svc.cancelAuthorization(bookingId, bookingAttemptId);
      await svc.cancelAuthorization(bookingId, bookingAttemptId);
      expect(stripe.paymentIntents.cancel).toHaveBeenCalledTimes(1);
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });
});
