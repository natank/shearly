import type { QueryResultRow } from 'pg';
import { claimDueWork, type Queryable } from '@shearly/shared-poller';
import { insertOutboxEvent } from '@shearly/shared-events';
import {
  transition,
  type BookingEvent,
  type TransitionEffect,
} from '@shearly/domain-booking-state-machine';
import { createExpirySpikeDetector, fireAlarm } from '@shearly/shared-observability';
import type { AppServices } from './compose.js';
import { executeEffects } from './booking-effects.js';

// OBS-004: booking expiry spike is a rate, not a single event — an
// individual expiry is an expected, routine outcome (a provider simply
// didn't respond in time); 5+ within a 10-minute window is the signal
// something is actually wrong (e.g. a provider-side outage, or a bug in
// the response-window logic itself). One detector per process, since the
// poller itself is a per-process singleton (startDueWorkPoller below).
const expirySpikeDetector = createExpirySpikeDetector(10 * 60 * 1000, 5);

type DueBookingRow = QueryResultRow & {
  id: string;
  state: 'PENDING' | 'CONFIRMED';
  provider_id: string;
  customer_id: string;
  price_minor: number;
  currency: string;
  slot_start: Date;
  response_deadline: Date | null;
};

type DueAuthorizationRow = QueryResultRow & {
  booking_id: string;
};

type DueReminderRow = QueryResultRow & {
  id: string;
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
      // Same outbox write BookingService.applyTransition() makes for every
      // HTTP-driven transition (M5-P1) — the poller drives transitions too
      // and must not skip it, or M5-P4's notification dispatcher never
      // fires for expiry/auto-complete.
      await insertOutboxEvent(client, 'booking', 'BookingStateChanged', {
        bookingId: row.id,
        fromState: row.state,
        toState: transitionResult.nextState,
        event,
        actor: 'system',
      });
      if (transitionResult.nextState === 'COMPLETED') {
        await insertOutboxEvent(client, 'booking', 'BookingCompleted', {
          bookingId: row.id,
          providerId: row.provider_id,
          customerId: row.customer_id,
          grossMinor: row.price_minor,
          currency: row.currency,
        });
      }
      // NOT-002: leaving CONFIRMED for any other state invalidates any
      // still-pending reminder row, same rule BookingService.applyTransition()
      // enforces for HTTP-driven transitions.
      if (row.state === 'CONFIRMED' && transitionResult.nextState !== 'CONFIRMED') {
        await client.query(
          `DELETE FROM booking.reminders WHERE booking_id = $1 AND sent_at IS NULL`,
          [row.id],
        );
      }
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
 * NOT-002: claims `booking.reminders` rows past `remind_at` and unsent
 * (`sent_at IS NULL` — the same guard the M4-P1 index already carries).
 * `NotificationService.handleReminder()` runs only after the claim
 * transaction commits — same reasoning as `claimAndTransitionBookings`'s
 * own doc comment, it uses a different pool connection. `sent_at` is only
 * written once the send actually succeeds: marking it inside the claim
 * transaction (before the send even runs) would record a reminder as sent
 * when it wasn't, and the row would never be retried after a failure —
 * the opposite of what "unsent" should mean. A failed send simply leaves
 * `sent_at` null, so the next tick's claim query picks it up again.
 */
async function sendDueReminders(
  services: AppServices,
  now: Date,
): Promise<{ succeeded: number; failed: number }> {
  const toSendFor: DueReminderRow[] = [];

  await claimDueWork<DueReminderRow>(
    services.pool,
    {
      claimSql: `SELECT id, booking_id FROM booking.reminders
                 WHERE sent_at IS NULL AND remind_at <= $1
                 ORDER BY remind_at
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`,
      claimParams: [now],
      markDone: async () => undefined,
      markFailed: async () => undefined,
    },
    async (_client, row) => {
      toSendFor.push(row);
    },
  );

  let succeeded = 0;
  let failed = 0;
  for (const row of toSendFor) {
    try {
      await services.notifications.handleReminder(row.booking_id);
      await services.pool.query(`UPDATE booking.reminders SET sent_at = now() WHERE id = $1`, [
        row.id,
      ]);
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }

  return { succeeded, failed };
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
  remindersSent: number;
}> {
  const now = new Date();

  const expiry = await claimAndTransitionBookings(
    services,
    'ResponseDeadlinePassed',
    `SELECT id, state, provider_id, customer_id, price_minor, currency, slot_start, response_deadline
     FROM booking.bookings
     WHERE state = 'PENDING' AND response_deadline IS NOT NULL AND response_deadline <= $1
     ORDER BY response_deadline
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    now,
  );
  for (let i = 0; i < expiry.succeeded; i += 1) {
    // OBS-004: named alarm — booking expiry spike.
    if (expirySpikeDetector.record()) {
      fireAlarm('bookingExpirySpike', { windowMs: 10 * 60 * 1000, threshold: 5 });
    }
  }

  const autoComplete = await claimAndTransitionBookings(
    services,
    'AutoCompleteElapsed',
    `SELECT id, state, provider_id, customer_id, price_minor, currency, slot_start, response_deadline
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
    async (_client, row) => {
      // Deferred off-session confirm: not implemented, named hole (M4-Q4).
      // Claiming a row here at all is therefore itself the anomaly — an
      // orphaned authorization nothing in this environment should be
      // able to produce yet.
      fireAlarm('orphanAuthorizationReconcilerAction', { bookingId: row.booking_id });
    },
  );

  const remindersSent = await sendDueReminders(services, now);

  return {
    expiredBookings: expiry.succeeded,
    autoCompletedBookings: autoComplete.succeeded,
    failedBookings: expiry.failed + autoComplete.failed + remindersSent.failed,
    claimedAuthorizations: deferredAuth.claimed,
    remindersSent: remindersSent.succeeded,
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
