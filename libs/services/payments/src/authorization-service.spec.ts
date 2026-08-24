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

      // OPS-002: payments.operations is rekeyed too, not just
      // payments.authorizations — otherwise the original authorize
      // operation would never show up under the booking's own detail view.
      const rekeyedOps = await pool.query<{ kind: string }>(
        'SELECT kind FROM payments.operations WHERE booking_id = $1 ORDER BY kind',
        [realBookingId],
      );
      expect(rekeyedOps.rows.map((row) => row.kind)).toEqual(['authorize', 'capture']);
      const staleOps = await pool.query('SELECT 1 FROM payments.operations WHERE booking_id = $1', [
        bookingAttemptId,
      ]);
      expect(staleOps.rowCount).toBe(0);
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [
        realBookingId,
      ]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [realBookingId]);
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

  it('failedOperations (OPS-002) lists a failed capture with the amount/currency needed to retry it', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
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
      await expect(svc.capture(bookingId, 20000, 'ILS')).rejects.toMatchObject({
        code: 'PAYMENT',
      });

      const failed = await svc.failedOperations();
      const row = failed.find((op) => op.bookingId === bookingId);
      expect(row).toBeDefined();
      expect(row?.kind).toBe('capture');
      expect(row?.result.amountMinor).toBe(20000);
      expect(row?.result.currency).toBe('ILS');
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('retryFailedOperation (OPS-002) retries a failed capture and succeeds once Stripe recovers, without double-capturing on a second retry', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    let shouldFail = true;
    stripe.paymentIntents.capture = vi.fn(async () => {
      if (shouldFail) {
        throw new Error('capture_failed');
      }
      return { id: 'pi_captured' };
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
      await expect(svc.capture(bookingId, 20000, 'ILS')).rejects.toMatchObject({
        code: 'PAYMENT',
      });

      shouldFail = false;
      await svc.retryFailedOperation(`capture:${bookingId}`);
      expect(stripe.paymentIntents.capture).toHaveBeenCalledTimes(2);

      const auth = await pool.query<{ status: string }>(
        'SELECT status FROM payments.authorizations WHERE booking_id = $1',
        [bookingId],
      );
      expect(auth.rows[0].status).toBe('CAPTURED');

      // Idempotent: a second retry against the now-succeeded operation must
      // not call Stripe again — same guarantee class as M4's own
      // capture/refund idempotency tests, exercised through the admin path.
      await svc.retryFailedOperation(`capture:${bookingId}`);
      expect(stripe.paymentIntents.capture).toHaveBeenCalledTimes(2);
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('retryFailedOperation throws NotFoundError for an unknown key, is a no-op for an already-succeeded operation, and throws ConflictError for one still pending', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
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
      await expect(svc.retryFailedOperation('capture:unknown')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

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
      await svc.capture(bookingId, 20000, 'ILS');
      // Already succeeded: a double-click retry must not throw or re-call
      // Stripe, not surface a distinct failure mode.
      await expect(svc.retryFailedOperation(`capture:${bookingId}`)).resolves.toBeUndefined();
      expect(stripe.paymentIntents.capture).toHaveBeenCalledTimes(1);

      // Still pending: a genuine conflict, not a retryable state.
      await pool.query(
        `INSERT INTO payments.operations (key, kind, booking_id, state)
         VALUES ('capture:pending-example', 'capture', $1, 'pending')`,
        [bookingId],
      );
      await expect(svc.retryFailedOperation('capture:pending-example')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    } finally {
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.query(`DELETE FROM payments.operations WHERE key = 'capture:pending-example'`);
      await pool.end();
    }
  });

  it('manualRefund (OPS-003) rejects a missing reason, and with one refunds and records an audit row attributed to the acting admin', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const bookingId = crypto.randomUUID();
    const bookingAttemptId = crypto.randomUUID();
    const adminAccountId = crypto.randomUUID();
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
      await svc.capture(bookingId, 20000, 'ILS');

      await expect(
        svc.manualRefund(bookingId, 5000, 'ILS', '', adminAccountId),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(stripe.refunds.create).not.toHaveBeenCalled();

      await svc.manualRefund(bookingId, 5000, 'ILS', 'goodwill adjustment', adminAccountId);
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);

      const auth = await pool.query<{ status: string }>(
        'SELECT status FROM payments.authorizations WHERE booking_id = $1',
        [bookingId],
      );
      expect(auth.rows[0].status).toBe('REFUNDED');

      const action = await pool.query<{
        kind: string;
        amount_minor: number;
        reason: string;
        actor_account_id: string;
      }>(
        'SELECT kind, amount_minor, reason, actor_account_id FROM payments.manual_actions WHERE booking_id = $1',
        [bookingId],
      );
      expect(action.rows[0]).toMatchObject({
        kind: 'refund',
        amount_minor: 5000,
        reason: 'goodwill adjustment',
        actor_account_id: adminAccountId,
      });

      // Idempotent against retry: a second call with the same reason must
      // not call Stripe again.
      await svc.manualRefund(bookingId, 5000, 'ILS', 'goodwill adjustment', adminAccountId);
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    } finally {
      await pool.query('DELETE FROM payments.manual_actions WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('reverseNoShow (OPS-003) refunds a captured no-show outcome and rejects one that was never captured', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = fakeStripe();
    const svc = new AuthorizationService(pool, stripe, 6);
    const capturedBookingId = crypto.randomUUID();
    const setupOnlyBookingId = crypto.randomUUID();
    const adminAccountId = crypto.randomUUID();
    try {
      // NO_SHOW_CUSTOMER path: always captures 100% — reversible.
      await svc.authorizeOrSetup(
        {
          bookingId: capturedBookingId,
          bookingAttemptId: capturedBookingId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        'pm_test',
      );
      await svc.capture(capturedBookingId, 20000, 'ILS');

      await expect(svc.reverseNoShow(capturedBookingId, '', adminAccountId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });

      await svc.reverseNoShow(capturedBookingId, 'dispute upheld', adminAccountId);
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);

      const auth = await pool.query<{ status: string }>(
        'SELECT status FROM payments.authorizations WHERE booking_id = $1',
        [capturedBookingId],
      );
      expect(auth.rows[0].status).toBe('REFUNDED');

      const action = await pool.query<{ kind: string; amount_minor: number }>(
        'SELECT kind, amount_minor FROM payments.manual_actions WHERE booking_id = $1',
        [capturedBookingId],
      );
      expect(action.rows[0]).toMatchObject({ kind: 'no_show_reversal', amount_minor: 20000 });

      // A SETUP_ONLY authorization (never captured — no money moved, so
      // nothing to reverse) must be rejected, not silently no-op'd.
      await svc.authorizeOrSetup(
        {
          bookingId: setupOnlyBookingId,
          bookingAttemptId: setupOnlyBookingId,
          amountMinor: 20000,
          currency: 'ILS',
          slotStart: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // beyond horizon
        },
        'pm_test',
      );
      await expect(
        svc.reverseNoShow(setupOnlyBookingId, 'dispute upheld', adminAccountId),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      await pool.query('DELETE FROM payments.manual_actions WHERE booking_id = ANY($1)', [
        [capturedBookingId, setupOnlyBookingId],
      ]);
      await pool.query('DELETE FROM payments.authorizations WHERE booking_id = ANY($1)', [
        [capturedBookingId, setupOnlyBookingId],
      ]);
      await pool.query('DELETE FROM payments.operations WHERE booking_id = ANY($1)', [
        [capturedBookingId, setupOnlyBookingId],
      ]);
      await pool.end();
    }
  });
});
