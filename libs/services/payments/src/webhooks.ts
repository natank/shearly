import pg from 'pg';
import Stripe from 'stripe';
import { ValidationError } from '@shearly/shared-errors';

/**
 * Webhooks are the source of truth for payment state (design §8.1) — Shearly
 * never infers success from a client-side callback. Idempotent by
 * `event.id`: a table with a unique constraint on the event id makes replays
 * a no-op rather than a double-processed event.
 */
export async function handleStripeWebhook(
  pool: pg.Pool,
  stripe: Stripe,
  payload: string | Buffer,
  signature: string,
  webhookSecret: string,
): Promise<{ handled: boolean; type: string }> {
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch {
    throw new ValidationError('errors.payments.invalidWebhookSignature');
  }

  const inserted = await pool.query(
    `INSERT INTO payments.webhook_events (id, type) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [event.id, event.type],
  );
  if (inserted.rowCount === 0) {
    return { handled: false, type: event.type };
  }

  return { handled: true, type: event.type };
}
