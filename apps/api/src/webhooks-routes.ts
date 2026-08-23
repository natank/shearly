import { Hono, type Context } from 'hono';
import type pg from 'pg';
import type { AppConfig } from '@shearly/shared-config';
import type { AuthorizationService } from '@shearly/services-payments';
import { handleStripeWebhook } from '@shearly/services-payments';
import { ValidationError } from '@shearly/shared-errors';

/**
 * design §8.1: webhooks are the only source of truth for payment state —
 * never a client callback. Signature verification needs the raw request
 * body exactly as Stripe sent it, so this reads `c.req.text()` rather than
 * a parsed JSON body (parsing and re-serializing would not byte-match what
 * Stripe signed).
 */
export function createWebhooksRoutes(input: {
  pool: pg.Pool;
  authorizations: AuthorizationService;
  config: AppConfig;
}) {
  const routes = new Hono();

  routes.post('/webhooks/stripe', async (c: Context) => {
    const stripe = input.authorizations.getClient();
    if (!stripe) {
      // Stub mode (no STRIPE_SECRET_KEY): there is no real Stripe account to
      // receive webhooks from, so there is nothing to verify or record.
      return c.json({ handled: false, type: 'stub' });
    }
    const signature = c.req.header('stripe-signature');
    if (!signature) {
      throw new ValidationError('errors.payments.invalidWebhookSignature');
    }
    const payload = await c.req.text();
    const result = await handleStripeWebhook(
      input.pool,
      stripe,
      payload,
      signature,
      input.config.stripeWebhookSecret,
    );
    return c.json(result);
  });

  return routes;
}
