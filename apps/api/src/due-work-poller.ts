import type { QueryResultRow } from 'pg';
import { claimDueWork, type Queryable } from '@shearly/shared-poller';
import {
  transition,
  type BookingEvent,
  type TransitionEffect,
} from '@shearly/domain-booking-state-machine';
import type { AppServices } from './compose.js';
import { executeEffects } from './booking-effects.js';

type DueBookingRow = QueryResultRow & {
  id: string;
  state: 'PENDING' | 'CONFIRMED';
  provider_id: string;
  price_minor: number;
  currency: string;
  slot_start: Date;
  response_deadline: Date | null;
};

type DueAuthorizationRow = QueryResultRow & {
  booking_id: string;
};

/**
 * Claims and transitions due bookings for one event (`ResponseDeadlinePassed`
 * or `AutoCompleteElapsed`). `executeEffects()` deliberately runs *after*
 * `claimDueWork` returns, not from inside its `handle` callback: `handle`
 * runs on the claim's own connection while still holding a `FOR UPDATE`
 * lock on the booking row, and `RecordStanding`'s
 * `INSERT INTO booking.standing_events` (executed by `executeEffects` on a
 * *different* pool connection) has a foreign key to `booking.bookings` —
 * its FK check blocks on that still-open lock, which can never release
 * because `handle` itself is waiting on `executeEffects` to return. Running
 * effects only after every claimed row's transaction has already committed
 * avoids the self-deadlock entirely.
 */
async function claimAndTransitionBookings(
  services: AppServices,
  event: Extract<BookingEvent, 'ResponseDeadlinePassed' | 'AutoCompleteElapsed'>,
  claimSql: string,
  now: Date,
): Promise<{ succeeded: number; failed: number }> {
  const toRunEffectsFor: { row: DueBookingRow; effects: TransitionEffect[] }[] = [];

  const result = await claimDueWork<DueBookingRow>(
    services.pool,
    {
      claimSql,
      claimParams: [now],
      markDone: async () => undefined,
      markFailed: async (client: Queryable, row: DueBookingRow) => {
        await client.query(
          `INSERT INTO booking.state_transitions (booking_id, from_state, to_state, event, actor, reason)
           VALUES ($1, $2, $2, $3, 'system', 'poller_attempt_failed')`,
          [row.id, row.state, event],
        );
      },
    },
    async (client, row) => {
      const transitionResult = transition(row.state, event, {
        clock: now,
        slotStart: row.slot_start,
        actor: 'system',
        cancelFullRefundHours: services.config.cancelFullRefundHours,
        responseDeadline: row.response_deadline ?? undefined,
      });
      await client.query(
        `UPDATE booking.bookings SET state = $2, updated_at = now() WHERE id = $1`,
        [row.id, transitionResult.nextState],
      );
      await client.query(
        `INSERT INTO booking.state_transitions (booking_id, from_state, to_state, event, actor)
         VALUES ($1, $2, $3, $4, 'system')`,
        [row.id, row.state, transitionResult.nextState, event],
      );
      toRunEffectsFor.push({ row, effects: transitionResult.effects });
    },
  );

  let effectFailures = 0;
  for (const { row, effects } of toRunEffectsFor) {
    try {
      await executeEffects(
        services,
        row.id,
        row.provider_id,
        row.price_minor,
        row.currency,
        event === 'ResponseDeadlinePassed' ? 'response_deadline_passed' : 'auto_complete_elapsed',
        effects,
      );
    } catch {
      // design §8.4 / booking-effects.ts's own doc comment: an effect
      // failure never rolls back the state transition already committed
      // above — it surfaces separately for OPS-002 (M5-P6) visibility.
      // This row is the queryable shape that PR needs; there is no retry
      // here because the booking has already left the state the claim
      // query matches on (e.g. PENDING), so a later poll tick would never
      // reclaim it.
      effectFailures += 1;
      await services.pool.query(
        `INSERT INTO booking.state_transitions (booking_id, from_state, to_state, event, actor, reason)
         VALUES ($1, $2, $2, $3, 'system', 'effect_failed')`,
        [row.id, row.state, event],
      );
    }
  }

  return { succeeded: result.succeeded, failed: result.failed + effectFailures };
}

/**
 * design §6.6: claims `PENDING` bookings past `response_deadline` and
 * `CONFIRMED` bookings past `auto_complete_at`, running each through the
 * same `transition()` the live HTTP routes use — the state machine has no
 * separate "poller path", only a different caller.
 *
 * `payments.authorizations` rows past `authorize_after`/`reauthorize_by`
 * are claimed too, but the deferred-authorize confirm itself stays a named
 * hole (M4-Q4, reconfirmed at M5-P2 write time — nothing in this
 * environment ever produces a `SETUP_ONLY` row with those columns set, so
 * this claim exists for when Stripe test-mode work fills that in, not
 * because it does anything yet).
 */
export async function runDueWorkOnce(services: AppServices): Promise<{
  expiredBookings: number;
  autoCompletedBookings: number;
  failedBookings: number;
  claimedAuthorizations: number;
}> {
  const now = new Date();

  const expiry = await claimAndTransitionBookings(
    services,
    'ResponseDeadlinePassed',
    `SELECT id, state, provider_id, price_minor, currency, slot_start, response_deadline
     FROM booking.bookings
     WHERE state = 'PENDING' AND response_deadline IS NOT NULL AND response_deadline <= $1
     ORDER BY response_deadline
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    now,
  );

  const autoComplete = await claimAndTransitionBookings(
    services,
    'AutoCompleteElapsed',
    `SELECT id, state, provider_id, price_minor, currency, slot_start, response_deadline
     FROM booking.bookings
     WHERE state = 'CONFIRMED' AND auto_complete_at IS NOT NULL AND auto_complete_at <= $1
     ORDER BY auto_complete_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    now,
  );

  // Named hole (see doc comment): nothing ever sets authorize_after on a
  // SETUP_ONLY row or reauthorize_by on an AUTHORIZED row in this
  // environment, so this claim is expected to find zero rows. It stays
  // wired so the poller's shape doesn't need to change once that becomes
  // real.
  const deferredAuth = await claimDueWork<DueAuthorizationRow>(
    services.pool,
    {
      claimSql: `SELECT booking_id FROM payments.authorizations
                 WHERE (status = 'SETUP_ONLY' AND authorize_after IS NOT NULL AND authorize_after <= $1)
                    OR (status = 'AUTHORIZED' AND reauthorize_by IS NOT NULL AND reauthorize_by <= $1)
                 ORDER BY COALESCE(authorize_after, reauthorize_by)
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`,
      claimParams: [now],
      markDone: async () => undefined,
      markFailed: async () => undefined,
    },
    async () => {
      // Deferred off-session confirm: not implemented, named hole (M4-Q4).
    },
  );

  return {
    expiredBookings: expiry.succeeded,
    autoCompletedBookings: autoComplete.succeeded,
    failedBookings: expiry.failed + autoComplete.failed,
    claimedAuthorizations: deferredAuth.claimed,
  };
}

/** Starts the poll loop; returns a stop function. Interval is config-driven (NOT-001's one-minute bound). */
export function startDueWorkPoller(services: AppServices): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    if (stopped) {
      return;
    }
    try {
      await runDueWorkOnce(services);
    } catch (error) {
      // A poller tick failing must never crash the process — log and retry
      // on the next interval.
      process.stderr.write(`due-work poller tick failed: ${(error as Error).message}\n`);
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, services.config.pollIntervalMs);
      }
    }
  };
  timer = setTimeout(tick, services.config.pollIntervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
