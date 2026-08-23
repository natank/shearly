import { afterAll, describe, expect, it, vi } from 'vitest';
import { migratePayments } from '@shearly/services-payments/migrate';
import { createApp } from './app.js';
import { compose, type ComposeOverrides } from './compose.js';

type FakeStripe = NonNullable<ComposeOverrides['stripeClient']>;

const url = process.env.DATABASE_URL;

describe('POST /webhooks/stripe', () => {
  it('stub mode (no STRIPE_SECRET_KEY): handled false, no-op', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    // Force stub mode regardless of the ambient env's own STRIPE_SECRET_KEY
    // (e.g. a local .env configured with real test-mode keys for manual QC).
    const services = compose({ ...process.env, STRIPE_SECRET_KEY: '' }, async () => undefined, {});
    try {
      const res = await createApp(services).request('/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig' },
        body: 'payload',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ handled: false, type: 'stub' });
    } finally {
      await services.pool.end();
    }
  });

  it('rejects a request with no stripe-signature header', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const stripe = {
      webhooks: { constructEvent: vi.fn() },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as FakeStripe;
    const services = compose(undefined, async () => undefined, { stripeClient: stripe });
    try {
      const res = await createApp(services).request('/webhooks/stripe', {
        method: 'POST',
        body: 'payload',
      });
      expect(res.status).toBe(400);
    } finally {
      await services.pool.end();
    }
  });

  it('rejects a tampered payload (bad signature)', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const stripe = {
      webhooks: {
        constructEvent: vi.fn(() => {
          throw new Error('bad signature');
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as FakeStripe;
    const services = compose(undefined, async () => undefined, { stripeClient: stripe });
    try {
      const res = await createApp(services).request('/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'bad-sig' },
        body: 'payload',
      });
      expect(res.status).toBe(400);
    } finally {
      await services.pool.end();
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
    const eventId = `evt_${crypto.randomUUID()}`;
    const stripe = {
      webhooks: {
        constructEvent: vi.fn(() => ({ id: eventId, type: 'payment_intent.succeeded' })),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as FakeStripe;
    const services = compose(undefined, async () => undefined, { stripeClient: stripe });
    try {
      const app = createApp(services);
      const first = await app.request('/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig' },
        body: 'payload',
      });
      expect(await first.json()).toMatchObject({ handled: true });

      const second = await app.request('/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig' },
        body: 'payload',
      });
      expect(await second.json()).toMatchObject({ handled: false });
    } finally {
      await services.pool.query('DELETE FROM payments.webhook_events WHERE id = $1', [eventId]);
      await services.pool.end();
    }
  });
});
