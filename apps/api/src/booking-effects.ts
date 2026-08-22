import pg from 'pg';
import type { TransitionEffect } from '@shearly/domain-booking-state-machine';
import type { AuthorizationService, LedgerService } from '@shearly/services-payments';

export type ExecuteEffectsDeps = {
  pool: pg.Pool;
  authorizations: AuthorizationService;
  ledger: LedgerService;
};

/**
 * Executes the declarative effects `transition()` returns (design §7.1). The
 * machine decides what must happen; this is the "booking service executes
 * it" half. `ReleaseHold` needs no action here — the exclusion constraint
 * (M4-P1) only applies to PENDING/CONFIRMED, so the state UPDATE already
 * committed by the caller is what frees the interval.
 *
 * Failure of a payment effect does not roll back the booking state already
 * committed (design §8.4, PAY-002) — the caller has already applied the
 * state transition before calling this; effect failures surface to the
 * caller as thrown errors for OPS-002 visibility (M5), not as a reason to
 * revert the booking state.
 */
export async function executeEffects(
  deps: ExecuteEffectsDeps,
  bookingId: string,
  providerId: string,
  priceMinor: number,
  reason: string,
  effects: TransitionEffect[],
): Promise<void> {
  // The amount Split writes to the ledger is what actually moved in *this*
  // settlement (design §7.4: late-cancel splits the 50% captured/refunded,
  // not the full original price) — tracked from the Capture/Refund effect
  // that precedes Split in the same effects list, per the transition table.
  let settledMinor = priceMinor;
  for (const effect of effects) {
    switch (effect.type) {
      case 'ReleaseAuth':
        await deps.authorizations.cancelAuthorization(bookingId, bookingId);
        break;
      case 'Capture':
        settledMinor = Math.round((priceMinor * effect.pct) / 100);
        await deps.authorizations.capture(bookingId, settledMinor);
        break;
      case 'Refund':
        settledMinor = Math.round((priceMinor * effect.pct) / 100);
        await deps.authorizations.refund(bookingId, settledMinor, reason);
        break;
      case 'Split':
        await deps.ledger.split(bookingId, settledMinor);
        break;
      case 'RecordStanding':
        await deps.pool.query(
          `INSERT INTO booking.standing_events (booking_id, provider_id, kind) VALUES ($1, $2, $3)`,
          [bookingId, providerId, effect.kind],
        );
        break;
      case 'ReleaseHold':
      case 'Notify':
        // ReleaseHold: no-op, see doc comment above.
        // Notify: real dispatch is M5 (design §6.6); the call site exists so
        // M5 only swaps the implementation, per the master plan's stated pattern.
        break;
      default:
        break;
    }
  }
}
