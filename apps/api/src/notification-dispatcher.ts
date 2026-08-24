import { dispatchDueOutboxEvents } from '@shearly/shared-events';
import type { BookingStateChangedPayload } from '@shearly/shared-events';
import { fireAlarm } from '@shearly/shared-observability';
import type { AppServices } from './compose.js';

/**
 * NOT-001/M5-P4: the outbox's first real consumer for booking notifications.
 * `BookingService.applyTransition()`/`create()` (M5-P1) already write a
 * `BookingStateChanged` row in the *same transaction* as every state
 * change — that write is what `transition()`'s declarative `Notify`
 * effect actually becomes real; `executeEffects()`'s `Notify` case stays a
 * documented no-op (see booking-effects.ts) because there is nothing left
 * for it to do; the event already exists once the transaction commits.
 * This dispatcher is what turns that committed row into an actual email.
 *
 * design §6.3 / booking-effects.ts's own PAY-002 doc comment: a
 * notification-send failure must never block or reverse the state
 * transition it describes — the transition already committed before this
 * poll tick ever runs. dispatchDueOutboxEvents() (M5-P1) already gives
 * that for free: a handler throw increments `attempts` and retries next
 * tick, it never touches `booking.bookings`.
 */
export async function runNotificationDispatchOnce(
  services: AppServices,
): Promise<{ dispatched: number; failed: number }> {
  return dispatchDueOutboxEvents(services.pool, 'booking', async (row) => {
    if (row.type !== 'BookingStateChanged') {
      return;
    }
    try {
      await services.notifications.handleBookingStateChanged(
        row.payload as BookingStateChangedPayload,
      );
    } catch (error) {
      // OBS-004: named alarm — SES bounce rate (SMTP delivery failure is
      // the local proxy: Mailhog has no bounce-webhook this app consumes,
      // and a real SES integration's bounce notifications are an
      // extraction-time concern per this alarm's own design note). Still
      // rethrown so dispatchDueOutboxEvents' existing retry-on-attempts
      // semantics are unaffected — this alarm observes, it doesn't change
      // delivery behavior.
      fireAlarm('sesBounceRate', {
        eventType: row.type,
        message: (error as Error).message,
      });
      throw error;
    }
  });
}

/** Starts the poll loop; returns a stop function. Interval is config-driven (NOT-001's one-minute bound). */
export function startNotificationDispatcher(services: AppServices): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    if (stopped) {
      return;
    }
    try {
      await runNotificationDispatchOnce(services);
    } catch (error) {
      // A dispatch tick failing must never crash the process — log and
      // retry on the next interval.
      process.stderr.write(`notification dispatcher tick failed: ${(error as Error).message}\n`);
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
