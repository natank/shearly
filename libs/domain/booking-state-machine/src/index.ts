export const BOOKING_STATE_MACHINE_NAME = 'booking-state-machine';

export type BookingState =
  | 'PENDING'
  | 'CONFIRMED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'COMPLETED'
  | 'CANCELLED_BY_CUSTOMER'
  | 'CANCELLED_BY_PROVIDER'
  | 'NO_SHOW_CUSTOMER'
  | 'NO_SHOW_PROVIDER';

export const TERMINAL_STATES: readonly BookingState[] = [
  'DECLINED',
  'EXPIRED',
  'COMPLETED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROVIDER',
  'NO_SHOW_CUSTOMER',
  'NO_SHOW_PROVIDER',
];

export type BookingEvent =
  | 'ProviderAccepts'
  | 'ProviderDeclines'
  | 'ResponseDeadlinePassed'
  | 'CustomerCancels'
  | 'ProviderCancels'
  | 'ProviderCompletes'
  | 'AutoCompleteElapsed'
  | 'ProviderReportsCustomerNoShow'
  | 'CustomerReportsProviderNoShow';

export type Actor = 'customer' | 'provider' | 'system';

export type TransitionEffect =
  | { type: 'ReleaseAuth' }
  | { type: 'Capture'; pct: 100 | 50 }
  | { type: 'Refund'; pct: 100 | 50 }
  | { type: 'Split' }
  | { type: 'ReleaseHold' }
  | { type: 'Notify'; recipients: Actor[]; withAlternatives?: boolean }
  | { type: 'RecordStanding'; kind: 'response_miss' | 'provider_cancel' | 'provider_no_show' };

export type TransitionResult = {
  nextState: BookingState;
  effects: TransitionEffect[];
};

export type TransitionContext = {
  clock: Date;
  slotStart: Date;
  actor: Actor;
  /**
   * Fixed at booking-creation time as `min(now + responseWindowHours, slotStart)`
   * (design §7.4, requirements Q-1) and persisted — never recomputed from the
   * current clock, or a booking's deadline would slide forward on every check.
   * Required for `ResponseDeadlinePassed`; unused otherwise.
   */
  responseDeadline?: Date;
  /** Configuration, not a literal — requirements `[D-3]`. */
  cancelFullRefundHours: number;
  /** Set only for CustomerCancels/ProviderCancels/no-show effects that depend on prior capture state. */
  alreadyCaptured?: boolean;
};

/**
 * Computes the fixed response deadline at booking-creation time. A booking never
 * expires after its own slot start (requirements BOK-004).
 */
export function computeResponseDeadline(
  createdAt: Date,
  slotStart: Date,
  responseWindowHours: number,
): Date {
  const windowMs = responseWindowHours * 60 * 60 * 1000;
  return new Date(Math.min(createdAt.getTime() + windowMs, slotStart.getTime()));
}

export class TransitionError extends Error {
  constructor(
    readonly code: 'TERMINAL_STATE' | 'UNAUTHORIZED_ACTOR' | 'GUARD_FAILED' | 'NO_SUCH_TRANSITION',
    message: string,
  ) {
    super(message);
    this.name = 'TransitionError';
  }
}

function isTerminal(state: BookingState): boolean {
  return TERMINAL_STATES.includes(state);
}

function hoursUntil(clock: Date, target: Date): number {
  return (target.getTime() - clock.getTime()) / (60 * 60 * 1000);
}

function responseDeadlinePassed(context: TransitionContext): boolean {
  if (!context.responseDeadline) {
    throw new TransitionError('GUARD_FAILED', 'booking.missingResponseDeadline');
  }
  return context.clock.getTime() >= context.responseDeadline.getTime();
}

/**
 * Pure, no I/O. Oracle for NFR-CI-004. Returns declarative effects; the booking
 * service executes them (design §7.1) — every row here mirrors design §7.4 verbatim.
 */
export function transition(
  current: BookingState,
  event: BookingEvent,
  context: TransitionContext,
): TransitionResult {
  if (isTerminal(current)) {
    throw new TransitionError(
      'TERMINAL_STATE',
      `booking.terminalState:${current}`,
    );
  }

  switch (current) {
    case 'PENDING':
      return transitionFromPending(event, context);
    case 'CONFIRMED':
      return transitionFromConfirmed(event, context);
    default:
      throw new TransitionError('NO_SUCH_TRANSITION', `booking.noSuchTransition:${current}:${event}`);
  }
}

function requireActor(context: TransitionContext, expected: Actor): void {
  if (context.actor !== expected) {
    throw new TransitionError(
      'UNAUTHORIZED_ACTOR',
      `booking.unauthorizedActor:expected=${expected}:actual=${context.actor}`,
    );
  }
}

function transitionFromPending(event: BookingEvent, context: TransitionContext): TransitionResult {
  switch (event) {
    case 'ProviderAccepts':
      requireActor(context, 'provider');
      return {
        nextState: 'CONFIRMED',
        effects: [{ type: 'Notify', recipients: ['customer', 'provider'] }],
      };

    case 'ProviderDeclines':
      requireActor(context, 'provider');
      return {
        nextState: 'DECLINED',
        effects: [
          { type: 'ReleaseAuth' },
          { type: 'ReleaseHold' },
          { type: 'Notify', recipients: ['customer'], withAlternatives: true },
        ],
      };

    case 'ResponseDeadlinePassed':
      requireActor(context, 'system');
      if (!responseDeadlinePassed(context)) {
        throw new TransitionError('GUARD_FAILED', 'booking.responseDeadlineNotYetPassed');
      }
      return {
        nextState: 'EXPIRED',
        effects: [
          { type: 'ReleaseAuth' },
          { type: 'ReleaseHold' },
          { type: 'Notify', recipients: ['customer', 'provider'], withAlternatives: true },
          { type: 'RecordStanding', kind: 'response_miss' },
        ],
      };

    case 'CustomerCancels':
      requireActor(context, 'customer');
      return {
        nextState: 'CANCELLED_BY_CUSTOMER',
        effects: [
          { type: 'ReleaseAuth' },
          { type: 'ReleaseHold' },
          { type: 'Notify', recipients: ['provider'] },
        ],
      };

    default:
      throw new TransitionError('NO_SUCH_TRANSITION', `booking.noSuchTransition:PENDING:${event}`);
  }
}

function transitionFromConfirmed(
  event: BookingEvent,
  context: TransitionContext,
): TransitionResult {
  switch (event) {
    case 'CustomerCancels': {
      requireActor(context, 'customer');
      const hoursOut = hoursUntil(context.clock, context.slotStart);
      if (hoursOut > context.cancelFullRefundHours) {
        return {
          nextState: 'CANCELLED_BY_CUSTOMER',
          effects: [
            context.alreadyCaptured ? { type: 'Refund', pct: 100 } : { type: 'ReleaseAuth' },
            { type: 'ReleaseHold' },
            { type: 'Notify', recipients: ['provider'] },
          ],
        };
      }
      return {
        nextState: 'CANCELLED_BY_CUSTOMER',
        effects: [
          context.alreadyCaptured
            ? { type: 'Refund', pct: 50 }
            : { type: 'Capture', pct: 50 },
          { type: 'Split' },
          { type: 'ReleaseHold' },
          { type: 'Notify', recipients: ['provider'] },
        ],
      };
    }

    case 'ProviderCancels':
      requireActor(context, 'provider');
      return {
        nextState: 'CANCELLED_BY_PROVIDER',
        effects: [
          context.alreadyCaptured ? { type: 'Refund', pct: 100 } : { type: 'ReleaseAuth' },
          { type: 'ReleaseHold' },
          { type: 'RecordStanding', kind: 'provider_cancel' },
          { type: 'Notify', recipients: ['customer'], withAlternatives: true },
        ],
      };

    case 'ProviderCompletes':
      requireActor(context, 'provider');
      if (context.clock.getTime() < context.slotStart.getTime()) {
        throw new TransitionError('GUARD_FAILED', 'booking.completeBeforeSlotStart');
      }
      return {
        nextState: 'COMPLETED',
        effects: [
          { type: 'Capture', pct: 100 },
          { type: 'Split' },
          { type: 'Notify', recipients: ['customer', 'provider'] },
        ],
      };

    case 'AutoCompleteElapsed':
      requireActor(context, 'system');
      return {
        nextState: 'COMPLETED',
        effects: [
          { type: 'Capture', pct: 100 },
          { type: 'Split' },
          { type: 'Notify', recipients: ['customer', 'provider'] },
        ],
      };

    case 'ProviderReportsCustomerNoShow':
      requireActor(context, 'provider');
      if (context.clock.getTime() < context.slotStart.getTime()) {
        throw new TransitionError('GUARD_FAILED', 'booking.noShowBeforeSlotStart');
      }
      return {
        nextState: 'NO_SHOW_CUSTOMER',
        effects: [
          { type: 'Capture', pct: 100 },
          { type: 'Split' },
          { type: 'Notify', recipients: ['customer'] },
        ],
      };

    case 'CustomerReportsProviderNoShow':
      requireActor(context, 'customer');
      if (context.clock.getTime() < context.slotStart.getTime()) {
        throw new TransitionError('GUARD_FAILED', 'booking.noShowBeforeSlotStart');
      }
      return {
        nextState: 'NO_SHOW_PROVIDER',
        effects: [
          context.alreadyCaptured ? { type: 'Refund', pct: 100 } : { type: 'ReleaseAuth' },
          { type: 'RecordStanding', kind: 'provider_no_show' },
          { type: 'Notify', recipients: ['provider'] },
        ],
      };

    default:
      throw new TransitionError('NO_SUCH_TRANSITION', `booking.noSuchTransition:CONFIRMED:${event}`);
  }
}
