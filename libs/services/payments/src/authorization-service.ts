import pg from 'pg';
import Stripe from 'stripe';
import { ConflictError, NotFoundError, PaymentError } from '@shearly/shared-errors';
import { insertOutboxEvent } from '@shearly/shared-events';
import { fireAlarm } from '@shearly/shared-observability';

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

  /** The underlying Stripe client, or null in stub mode — for callers (the
   * webhook route) that need the same client this service authorizes with,
   * rather than constructing a second one from the same secret key. */
  getClient(): Stripe | null {
    return this.stripe;
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
    // OPS-002: payments.operations.booking_id is a denormalized reference
    // column (idempotency itself is keyed by `key`, not booking_id) used
    // for exactly this kind of "every operation for this booking" lookup —
    // without rekeying it too, the authorize/setup row stays permanently
    // attributed to the saga's own attempt id and never shows up in a
    // booking's own operations history.
    await this.pool.query(
      `UPDATE payments.operations SET booking_id = $2, updated_at = now() WHERE booking_id = $1`,
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
      await this.pool.query(
        `UPDATE payments.authorizations SET status = 'CANCELLED', updated_at = now() WHERE booking_id = $1`,
        [bookingId],
      );
    } catch (error) {
      await this.completeOperation(key, 'failed', { message: (error as Error).message });
      throw new PaymentError('errors.payments.cancelFailed');
    }
  }

  /** design §7.4 Capture effect. pct is 100 or 50 (late cancel). Idempotent against retry. */
  async capture(bookingId: string, amountMinor: number, currency: string): Promise<void> {
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
      await this.completeOperation(key, 'failed', {
        message: 'no authorization on file',
        amountMinor,
        currency,
      });
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
      await this.completeOperation(key, 'succeeded', { amountMinor, currency });
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE payments.authorizations SET status = 'CAPTURED', updated_at = now() WHERE booking_id = $1`,
          [bookingId],
        );
        await insertOutboxEvent(client, 'payments', 'PaymentCaptured', {
          bookingId,
          amountMinor,
          currency,
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      // OPS-002: the exceptions view and its retry endpoint need the
      // amount/currency that was actually attempted, not just the error —
      // this is the only place that context is recorded once capture()
      // itself has failed.
      await this.completeOperation(key, 'failed', {
        message: (error as Error).message,
        amountMinor,
        currency,
      });
      // OBS-004: named alarm — payment capture failure.
      fireAlarm('paymentCaptureFailure', {
        bookingId,
        amountMinor,
        currency,
        message: (error as Error).message,
      });
      throw new PaymentError('errors.payments.captureFailed');
    }
  }

  /** design §7.4 Refund effect. Idempotent against retry by reason-scoped key. */
  async refund(
    bookingId: string,
    amountMinor: number,
    reason: string,
    currency: string,
  ): Promise<void> {
    await this.refundWithKey(
      `refund:${bookingId}:${reason}`,
      bookingId,
      amountMinor,
      currency,
      reason,
    );
  }

  /** OPS-002: every operation recorded for one booking, oldest first — the booking detail view's payment-side data. */
  async operationsForBooking(bookingId: string): Promise<
    {
      key: string;
      kind: OperationKind;
      state: OperationState;
      result: unknown;
      createdAt: Date;
      updatedAt: Date;
    }[]
  > {
    const result = await this.pool.query<{
      key: string;
      kind: OperationKind;
      state: OperationState;
      result: unknown;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT key, kind, state, result, created_at, updated_at
       FROM payments.operations WHERE booking_id = $1 ORDER BY created_at`,
      [bookingId],
    );
    return result.rows.map((row) => ({
      key: row.key,
      kind: row.kind,
      state: row.state,
      result: row.result,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * OPS-002: every `failed` capture/refund operation, most recent first —
   * the exceptions view's data source. `result` carries the amount/
   * currency/reason recorded at failure time (see capture()/refund()'s own
   * failure branches), which the retry endpoint replays.
   */
  async failedOperations(): Promise<
    {
      key: string;
      kind: OperationKind;
      bookingId: string;
      result: { message?: string; amountMinor?: number; currency?: string; reason?: string };
      updatedAt: Date;
    }[]
  > {
    const result = await this.pool.query<{
      key: string;
      kind: OperationKind;
      booking_id: string;
      result: {
        message?: string;
        amountMinor?: number;
        currency?: string;
        reason?: string;
      } | null;
      updated_at: Date;
    }>(
      `SELECT key, kind, booking_id, result, updated_at
       FROM payments.operations
       WHERE state = 'failed' AND kind IN ('capture', 'refund')
       ORDER BY updated_at DESC
       LIMIT 100`,
    );
    return result.rows.map((row) => ({
      key: row.key,
      kind: row.kind,
      bookingId: row.booking_id,
      result: row.result ?? {},
      updatedAt: row.updated_at,
    }));
  }

  /** OPS-006 (M5-P8b): count of failed capture/refund operations within a window — the funnel view's "payment failures" stage. */
  async failedOperationCount(from: Date, to: Date): Promise<number> {
    const result = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n
       FROM payments.operations
       WHERE state = 'failed' AND kind IN ('capture', 'refund')
         AND updated_at >= $1 AND updated_at < $2`,
      [from, to],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  private async recordManualAction(
    bookingId: string,
    kind: 'refund' | 'no_show_reversal',
    amountMinor: number,
    currency: string,
    reason: string,
    actorAccountId: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO payments.manual_actions (booking_id, kind, amount_minor, currency, reason, actor_account_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [bookingId, kind, amountMinor, currency, reason, actorAccountId],
    );
  }

  /**
   * OPS-003: a full/partial refund outside the automatic cancel-window
   * rules, admin-triggered with a mandatory reason. Reuses refund()'s
   * Stripe call and idempotency machinery (design §8.2) under a distinctly
   * namespaced key (`manual-refund:` rather than `refund:`) so a manual
   * refund can never collide with — or be confused for — a state-machine-
   * driven one keyed on the same booking. Recorded to the append-only
   * `payments.manual_actions` audit trail once the refund itself succeeds.
   */
  async manualRefund(
    bookingId: string,
    amountMinor: number,
    currency: string,
    reason: string,
    actorAccountId: string,
  ): Promise<void> {
    if (!reason.trim()) {
      throw new ConflictError('errors.payments.reasonRequired');
    }
    await this.refundWithKey(
      `manual-refund:${bookingId}:${reason}`,
      bookingId,
      amountMinor,
      currency,
      reason,
    );
    await this.recordManualAction(
      bookingId,
      'refund',
      amountMinor,
      currency,
      reason,
      actorAccountId,
    );
  }

  /**
   * OPS-003: reverses a disputed no-show outcome. Only NO_SHOW_CUSTOMER is
   * reversible — that path always captures 100% from the customer (see the
   * state machine's ProviderReportsCustomerNoShow transition), so "the
   * opposite direction" is a well-defined Stripe refund. NO_SHOW_PROVIDER
   * only moves money when the booking had already been captured before the
   * no-show was reported (the alreadyCaptured branch), and even then
   * reversing it would mean re-capturing funds already returned to the
   * customer's card — not a real Stripe primitive on a refunded
   * PaymentIntent, and not safely automatable without a fresh payment
   * method. Both cases are rejected here rather than silently no-op'd.
   */
  async reverseNoShow(bookingId: string, reason: string, actorAccountId: string): Promise<void> {
    if (!reason.trim()) {
      throw new ConflictError('errors.payments.reasonRequired');
    }
    const auth = await this.pool.query<{
      status: string;
      stripe_payment_intent_id: string | null;
    }>(
      'SELECT status, stripe_payment_intent_id FROM payments.authorizations WHERE booking_id = $1',
      [bookingId],
    );
    const row = auth.rows[0];
    if (!row || row.status !== 'CAPTURED' || !row.stripe_payment_intent_id) {
      throw new ConflictError('errors.payments.noShowNotReversible');
    }
    const capture = await this.pool.query<{ result: { amountMinor?: number; currency?: string } }>(
      `SELECT result FROM payments.operations WHERE key = $1 AND kind = 'capture' AND state = 'succeeded'`,
      [`capture:${bookingId}`],
    );
    const amountMinor = capture.rows[0]?.result?.amountMinor;
    const currency = capture.rows[0]?.result?.currency;
    if (amountMinor === undefined || !currency) {
      throw new ConflictError('errors.payments.noShowNotReversible');
    }
    await this.refundWithKey(
      `no-show-reversal:${bookingId}`,
      bookingId,
      amountMinor,
      currency,
      reason,
    );
    await this.recordManualAction(
      bookingId,
      'no_show_reversal',
      amountMinor,
      currency,
      reason,
      actorAccountId,
    );
  }

  /**
   * Shared by refund() (state-machine-driven) and manualRefund()/
   * reverseNoShow() (OPS-003, admin-driven) — same Stripe call and
   * payments.operations bookkeeping, different idempotency-key namespace so
   * the three call sites can never collide on the same key.
   */
  private async refundWithKey(
    key: string,
    bookingId: string,
    amountMinor: number,
    currency: string,
    reason: string,
  ): Promise<void> {
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
      await this.completeOperation(key, 'failed', {
        message: 'no authorization on file',
        amountMinor,
        currency,
        reason,
      });
      throw new PaymentError('errors.payments.noAuthorization');
    }

    try {
      if (this.stripe) {
        await this.stripe.refunds.create(
          { payment_intent: paymentIntentId, amount: amountMinor },
          { idempotencyKey: key },
        );
      }
      await this.completeOperation(key, 'succeeded', { amountMinor, currency, reason });
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE payments.authorizations SET status = 'REFUNDED', updated_at = now() WHERE booking_id = $1`,
          [bookingId],
        );
        await insertOutboxEvent(client, 'payments', 'PaymentRefunded', {
          bookingId,
          amountMinor,
          currency,
          reason,
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      await this.completeOperation(key, 'failed', {
        message: (error as Error).message,
        amountMinor,
        currency,
        reason,
      });
      // OBS-004: named alarm — refund failure.
      fireAlarm('refundFailure', {
        bookingId,
        amountMinor,
        currency,
        reason,
        message: (error as Error).message,
      });
      throw new PaymentError('errors.payments.refundFailed');
    }
  }

  /**
   * OPS-002: retries a failed capture/refund by re-invoking the same
   * capture()/refund() method with the amount/currency/reason recorded at
   * failure time — the idempotency key is deterministic (`capture:<id>` or
   * `refund:<id>:<reason>`), so this is the same call the original saga
   * would have made, not a new mechanism. Throws if the operation isn't
   * found, isn't in `failed` state, or its recorded result is missing the
   * amount needed to replay it.
   */
  async retryFailedOperation(key: string): Promise<void> {
    const existing = await this.pool.query<{
      kind: OperationKind;
      booking_id: string;
      state: OperationState;
      result: { amountMinor?: number; currency?: string; reason?: string } | null;
    }>(`SELECT kind, booking_id, state, result FROM payments.operations WHERE key = $1`, [key]);
    const row = existing.rows[0];
    if (!row) {
      throw new NotFoundError('errors.payments.operationNotFound');
    }
    // Idempotent against a double-click: an operation this retry (or a
    // concurrent one) already moved to `succeeded` is a no-op, not an
    // error — the plan's own acceptance criterion is "retrying the same
    // failed operation twice is idempotent (no double-capture)," and a
    // second click landing after the first has already resolved is exactly
    // that case, not a distinct failure mode admins need surfaced.
    if (row.state === 'succeeded') {
      return;
    }
    if (row.state !== 'failed') {
      throw new ConflictError('errors.payments.operationNotFailed');
    }
    const amountMinor = row.result?.amountMinor;
    const currency = row.result?.currency;
    if (amountMinor === undefined || !currency) {
      throw new ConflictError('errors.payments.operationNotRetryable');
    }
    if (row.kind === 'capture') {
      await this.capture(row.booking_id, amountMinor, currency);
      return;
    }
    if (row.kind === 'refund') {
      const reason = row.result?.reason;
      if (!reason) {
        throw new ConflictError('errors.payments.operationNotRetryable');
      }
      await this.refund(row.booking_id, amountMinor, reason, currency);
      return;
    }
    throw new ConflictError('errors.payments.operationNotRetryable');
  }
}
