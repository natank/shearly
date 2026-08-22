import pg from 'pg';
import Stripe from 'stripe';
import { PaymentError } from '@shearly/shared-errors';

export type OperationKind = 'authorize' | 'setup' | 'cancel' | 'capture' | 'refund';
export type OperationState = 'pending' | 'succeeded' | 'failed';

export type AuthorizeInput = {
  bookingId: string;
  bookingAttemptId: string;
  amountMinor: number;
  currency: string;
  slotStart: Date;
  now?: Date;
};

export type AuthorizeResult =
  | { status: 'AUTHORIZED'; stripePaymentIntentId: string }
  | { status: 'SETUP_ONLY'; stripeSetupIntentId: string; authorizeAfter: Date };

/**
 * Wraps Stripe's PaymentIntent/SetupIntent APIs behind the design §8.1/§8.2
 * idempotency scheme. Every mutating call is keyed deterministically and
 * recorded in `payments.operations` before Stripe is called — a retry with
 * the same key short-circuits to the stored result rather than calling
 * Stripe twice.
 */
export class AuthorizationService {
  private readonly stripe: Stripe | null;

  constructor(
    private readonly pool: pg.Pool,
    stripeSecretKeyOrClient: string | Stripe,
    private readonly authHorizonDays = 6,
  ) {
    if (typeof stripeSecretKeyOrClient === 'string') {
      this.stripe = stripeSecretKeyOrClient ? new Stripe(stripeSecretKeyOrClient) : null;
    } else {
      this.stripe = stripeSecretKeyOrClient;
    }
  }

  /**
   * No `STRIPE_SECRET_KEY` configured: local dev, demo, and E2E still need a
   * working booking loop (design §9.1's "no paid dependency" applies to
   * Stripe the same way it does to the geocoder). Mirrors ConnectService's
   * established stub pattern (M2) rather than failing the whole loop.
   */
  isStubbed(): boolean {
    return this.stripe === null;
  }

  private async beginOperation(
    key: string,
    kind: OperationKind,
    bookingId: string,
  ): Promise<{ isNew: boolean; existing?: { state: OperationState; result: unknown } }> {
    const existing = await this.pool.query<{ state: OperationState; result: unknown }>(
      'SELECT state, result FROM payments.operations WHERE key = $1',
      [key],
    );
    if (existing.rows.length > 0) {
      return { isNew: false, existing: existing.rows[0] };
    }
    await this.pool.query(
      `INSERT INTO payments.operations (key, kind, booking_id, state)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (key) DO NOTHING`,
      [key, kind, bookingId],
    );
    return { isNew: true };
  }

  private async completeOperation(key: string, state: OperationState, result: unknown) {
    await this.pool.query(
      `UPDATE payments.operations SET state = $2, result = $3, updated_at = now() WHERE key = $1`,
      [key, state, JSON.stringify(result)],
    );
  }

  /**
   * design §8.1: inside auth_horizon, create+confirm a manual-capture
   * PaymentIntent. Beyond it, confirm a SetupIntent and defer the real
   * authorization to the §6.6 poller (off-session confirm, wired in a later
   * PR). Failure of either leaves no booking row — the caller must not
   * insert the booking unless this resolves to AUTHORIZED or SETUP_ONLY.
   */
  async authorizeOrSetup(input: AuthorizeInput, paymentMethodId: string): Promise<AuthorizeResult> {
    const now = input.now ?? new Date();
    const horizonMs = this.authHorizonDays * 24 * 60 * 60 * 1000;
    const withinHorizon = input.slotStart.getTime() - now.getTime() <= horizonMs;

    if (withinHorizon) {
      return this.authorize(input, paymentMethodId);
    }
    return this.setup(input, paymentMethodId);
  }

  private async authorize(
    input: AuthorizeInput,
    paymentMethodId: string,
  ): Promise<AuthorizeResult> {
    const key = `authorize:${input.bookingAttemptId}`;
    const op = await this.beginOperation(key, 'authorize', input.bookingId);
    if (!op.isNew && op.existing?.state === 'succeeded') {
      return op.existing.result as AuthorizeResult;
    }
    if (!op.isNew && op.existing?.state === 'failed') {
      throw new PaymentError('errors.payments.authorizationFailed');
    }

    try {
      const intentId = this.stripe
        ? (
            await this.stripe.paymentIntents.create(
              {
                amount: input.amountMinor,
                currency: input.currency.toLowerCase(),
                payment_method: paymentMethodId,
                confirm: true,
                capture_method: 'manual',
                automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
              },
              { idempotencyKey: key },
            )
          ).id
        : `pi_stub_${key}`;
      const result: AuthorizeResult = { status: 'AUTHORIZED', stripePaymentIntentId: intentId };
      await this.completeOperation(key, 'succeeded', result);
      await this.pool.query(
        `INSERT INTO payments.authorizations (booking_id, status, stripe_payment_intent_id)
         VALUES ($1, 'AUTHORIZED', $2)
         ON CONFLICT (booking_id) DO UPDATE SET status = 'AUTHORIZED', stripe_payment_intent_id = $2, updated_at = now()`,
        [input.bookingId, intentId],
      );
      return result;
    } catch (error) {
      await this.completeOperation(key, 'failed', { message: (error as Error).message });
      throw new PaymentError('errors.payments.authorizationFailed');
    }
  }

  private async setup(input: AuthorizeInput, paymentMethodId: string): Promise<AuthorizeResult> {
    const key = `setup:${input.bookingAttemptId}`;
    const op = await this.beginOperation(key, 'setup', input.bookingId);
    if (!op.isNew && op.existing?.state === 'succeeded') {
      return op.existing.result as AuthorizeResult;
    }
    if (!op.isNew && op.existing?.state === 'failed') {
      throw new PaymentError('errors.payments.authorizationFailed');
    }

    const authorizeAfter = new Date(
      input.slotStart.getTime() - this.authHorizonDays * 24 * 60 * 60 * 1000,
    );
    try {
      const setupIntentId = this.stripe
        ? (
            await this.stripe.setupIntents.create(
              { payment_method: paymentMethodId, confirm: true, usage: 'off_session' },
              { idempotencyKey: key },
            )
          ).id
        : `si_stub_${key}`;
      const result: AuthorizeResult = {
        status: 'SETUP_ONLY',
        stripeSetupIntentId: setupIntentId,
        authorizeAfter,
      };
      await this.completeOperation(key, 'succeeded', result);
      await this.pool.query(
        `INSERT INTO payments.authorizations (booking_id, status, stripe_setup_intent_id, authorize_after)
         VALUES ($1, 'SETUP_ONLY', $2, $3)
         ON CONFLICT (booking_id) DO UPDATE SET status = 'SETUP_ONLY', stripe_setup_intent_id = $2, authorize_after = $3, updated_at = now()`,
        [input.bookingId, setupIntentId, authorizeAfter],
      );
      return result;
    } catch (error) {
      await this.completeOperation(key, 'failed', { message: (error as Error).message });
      throw new PaymentError('errors.payments.authorizationFailed');
    }
  }

  /**
   * The saga (design §8.4) authorizes before the booking row exists, so
   * `payments.authorizations` is keyed by `bookingAttemptId` at authorize
   * time. Once the booking insert succeeds, re-key the row to the real
   * booking id so capture/refund/cancel — which all operate on the booking
   * id — can find it. A no-op if already re-keyed (idempotent against retry).
   */
  async rekeyToBooking(bookingAttemptId: string, bookingId: string): Promise<void> {
    await this.pool.query(
      `UPDATE payments.authorizations SET booking_id = $2, updated_at = now() WHERE booking_id = $1`,
      [bookingAttemptId, bookingId],
    );
  }

  /** Cancels an orphaned or declined authorization. Idempotent against retry. */
  async cancelAuthorization(bookingId: string, bookingAttemptId: string): Promise<void> {
    const key = `cancel:${bookingAttemptId}`;
    const op = await this.beginOperation(key, 'cancel', bookingId);
    if (!op.isNew && op.existing?.state === 'succeeded') {
      return;
    }

    const auth = await this.pool.query<{
      stripe_payment_intent_id: string | null;
      stripe_setup_intent_id: string | null;
    }>(
      'SELECT stripe_payment_intent_id, stripe_setup_intent_id FROM payments.authorizations WHERE booking_id = $1',
      [bookingId],
    );
    const row = auth.rows[0];
    try {
      if (this.stripe && row?.stripe_payment_intent_id) {
        await this.stripe.paymentIntents.cancel(row.stripe_payment_intent_id, undefined, {
          idempotencyKey: key,
        });
      }
      await this.completeOperation(key, 'succeeded', { cancelled: true });
    } catch (error) {
      await this.completeOperation(key, 'failed', { message: (error as Error).message });
      throw new PaymentError('errors.payments.cancelFailed');
    }
  }

  /** design §7.4 Capture effect. pct is 100 or 50 (late cancel). Idempotent against retry. */
  async capture(bookingId: string, amountMinor: number): Promise<void> {
    const key = `capture:${bookingId}`;
    const op = await this.beginOperation(key, 'capture', bookingId);
    if (!op.isNew && op.existing?.state === 'succeeded') {
      return;
    }

    const auth = await this.pool.query<{ stripe_payment_intent_id: string | null }>(
      'SELECT stripe_payment_intent_id FROM payments.authorizations WHERE booking_id = $1',
      [bookingId],
    );
    const paymentIntentId = auth.rows[0]?.stripe_payment_intent_id;
    if (!paymentIntentId) {
      await this.completeOperation(key, 'failed', { message: 'no authorization on file' });
      throw new PaymentError('errors.payments.noAuthorization');
    }

    try {
      if (this.stripe) {
        await this.stripe.paymentIntents.capture(
          paymentIntentId,
          { amount_to_capture: amountMinor },
          { idempotencyKey: key },
        );
      }
      await this.completeOperation(key, 'succeeded', { amountMinor });
    } catch (error) {
      await this.completeOperation(key, 'failed', { message: (error as Error).message });
      throw new PaymentError('errors.payments.captureFailed');
    }
  }

  /** design §7.4 Refund effect. Idempotent against retry by reason-scoped key. */
  async refund(bookingId: string, amountMinor: number, reason: string): Promise<void> {
    const key = `refund:${bookingId}:${reason}`;
    const op = await this.beginOperation(key, 'refund', bookingId);
    if (!op.isNew && op.existing?.state === 'succeeded') {
      return;
    }

    const auth = await this.pool.query<{ stripe_payment_intent_id: string | null }>(
      'SELECT stripe_payment_intent_id FROM payments.authorizations WHERE booking_id = $1',
      [bookingId],
    );
    const paymentIntentId = auth.rows[0]?.stripe_payment_intent_id;
    if (!paymentIntentId) {
      await this.completeOperation(key, 'failed', { message: 'no authorization on file' });
      throw new PaymentError('errors.payments.noAuthorization');
    }

    try {
      if (this.stripe) {
        await this.stripe.refunds.create(
          { payment_intent: paymentIntentId, amount: amountMinor },
          { idempotencyKey: key },
        );
      }
      await this.completeOperation(key, 'succeeded', { amountMinor, reason });
    } catch (error) {
      await this.completeOperation(key, 'failed', { message: (error as Error).message });
      throw new PaymentError('errors.payments.refundFailed');
    }
  }
}
