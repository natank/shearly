import { describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { handleStripeWebhook } from './webhooks.js';
import { migratePayments } from './migrate.js';

const url = process.env.DATABASE_URL;

function fakeStripe(event: { id: string; type: string }) {
  return {
    webhooks: {
      constructEvent: vi.fn(() => event),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('handleStripeWebhook', () => {
  it('rejects a payload with an invalid signature', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const stripe = {
      webhooks: {
        constructEvent: vi.fn(() => {
          throw new Error('bad signature');
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    try {
      const error = await handleStripeWebhook(
        pool,
        stripe,
        'payload',
        'bad-sig',
        'whsec_test',
      ).catch((err) => err);
      expect(error).toMatchObject({
        code: 'VALIDATION',
        translationKey: 'errors.payments.invalidWebhookSignature',
      });
    } finally {
      await pool.end();
    }
  });

  it('is idempotent by event.id — a replay is a no-op', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const eventId = `evt_${crypto.randomUUID()}`;
    const stripe = fakeStripe({ id: eventId, type: 'payment_intent.succeeded' });
    try {
      const first = await handleStripeWebhook(pool, stripe, 'payload', 'sig', 'whsec_test');
      expect(first.handled).toBe(true);

      const second = await handleStripeWebhook(pool, stripe, 'payload', 'sig', 'whsec_test');
      expect(second.handled).toBe(false);
    } finally {
      await pool.query('DELETE FROM payments.webhook_events WHERE id = $1', [eventId]);
      await pool.end();
    }
  });
});
