import type { TransitionEffect } from '@shearly/domain-booking-state-machine';

export type CancelConsequence =
  { kind: 'no_charge' } | { kind: 'partial_charge'; chargePct: number };

/**
 * Derives the customer-facing disclosure (BOK-005: "the exact financial
 * consequence is stated before I confirm") from the same effects
 * `transition()` would return for `CustomerCancels` — never a second,
 * hand-maintained copy of the `[D-3]` boundary math (M4 plan §9 M4-Q2).
 * Calling `transition()` for a dry-run is safe: it is pure, no I/O, and
 * this function does not execute the effects it inspects.
 *
 * `CustomerCancels` never fires after a capture has occurred — captures
 * only happen on completion or no-show, both terminal, both unreachable
 * once a cancel is possible — so `transition()`'s `alreadyCaptured` branch
 * (`Refund`) never appears here; only `ReleaseAuth` (no charge, hold
 * released) or `Capture(pct)` (a real charge) are reachable.
 */
export function deriveCancelConsequence(effects: TransitionEffect[]): CancelConsequence {
  for (const effect of effects) {
    if (effect.type === 'Capture') {
      return { kind: 'partial_charge', chargePct: effect.pct };
    }
    if (effect.type === 'ReleaseAuth') {
      return { kind: 'no_charge' };
    }
  }
  return { kind: 'no_charge' };
}
