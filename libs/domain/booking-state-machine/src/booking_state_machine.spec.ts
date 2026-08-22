import { describe, expect, it } from 'vitest';
import {
  BOOKING_STATE_MACHINE_NAME,
  TERMINAL_STATES,
  TransitionError,
  computeResponseDeadline,
  transition,
  type BookingEvent,
  type BookingState,
  type TransitionContext,
} from './index.js';

const SLOT_START = new Date('2026-09-01T09:00:00Z');

function ctx(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    clock: new Date('2026-08-25T09:00:00Z'),
    slotStart: SLOT_START,
    actor: 'system',
    cancelFullRefundHours: 12,
    ...overrides,
  };
}

describe('booking-state-machine', () => {
  it('exports its name', () => {
    expect(BOOKING_STATE_MACHINE_NAME).toBe('booking-state-machine');
  });

  describe('terminal states reject every event', () => {
    for (const state of TERMINAL_STATES) {
      it(`rejects any event from ${state}`, () => {
        expect(() =>
          transition(state, 'ProviderAccepts', ctx({ actor: 'provider' })),
        ).toThrow(TransitionError);
      });
    }
  });

  describe('PENDING', () => {
    it('ProviderAccepts -> CONFIRMED, notifies both', () => {
      const result = transition('PENDING', 'ProviderAccepts', ctx({ actor: 'provider' }));
      expect(result.nextState).toBe('CONFIRMED');
      expect(result.effects).toContainEqual({
        type: 'Notify',
        recipients: ['customer', 'provider'],
      });
    });

    it('rejects ProviderAccepts from a customer actor', () => {
      expect(() =>
        transition('PENDING', 'ProviderAccepts', ctx({ actor: 'customer' })),
      ).toThrow(/unauthorizedActor/);
    });

    it('ProviderDeclines -> DECLINED, releases auth and hold, notifies with alternatives', () => {
      const result = transition('PENDING', 'ProviderDeclines', ctx({ actor: 'provider' }));
      expect(result.nextState).toBe('DECLINED');
      expect(result.effects).toContainEqual({ type: 'ReleaseAuth' });
      expect(result.effects).toContainEqual({ type: 'ReleaseHold' });
      expect(result.effects).toContainEqual({
        type: 'Notify',
        recipients: ['customer'],
        withAlternatives: true,
      });
    });

    it('ResponseDeadlinePassed -> EXPIRED only once now >= the fixed deadline', () => {
      const createdAt = new Date('2026-08-25T09:00:00Z');
      const deadline = computeResponseDeadline(createdAt, SLOT_START, 2);

      expect(() =>
        transition(
          'PENDING',
          'ResponseDeadlinePassed',
          ctx({ actor: 'system', clock: createdAt, responseDeadline: deadline }),
        ),
      ).toThrow(/responseDeadlineNotYetPassed/);

      const result = transition(
        'PENDING',
        'ResponseDeadlinePassed',
        ctx({
          actor: 'system',
          clock: new Date(deadline.getTime() + 1000),
          responseDeadline: deadline,
        }),
      );
      expect(result.nextState).toBe('EXPIRED');
      expect(result.effects).toContainEqual({ type: 'RecordStanding', kind: 'response_miss' });
    });

    it('a booking never expires after its own slot start (deadline capped at slotStart)', () => {
      const slotStart = new Date('2026-08-25T10:00:00Z');
      const createdAt = new Date('2026-08-25T09:00:00Z');
      // responseWindowHours=100 would push the deadline far past slotStart —
      // computeResponseDeadline must cap it at slotStart itself (BOK-004).
      const deadline = computeResponseDeadline(createdAt, slotStart, 100);
      expect(deadline).toEqual(slotStart);

      const result = transition(
        'PENDING',
        'ResponseDeadlinePassed',
        ctx({
          actor: 'system',
          slotStart,
          clock: new Date(slotStart.getTime() + 1000),
          responseDeadline: deadline,
        }),
      );
      expect(result.nextState).toBe('EXPIRED');
    });

    it('throws if invoked without a computed responseDeadline', () => {
      expect(() =>
        transition('PENDING', 'ResponseDeadlinePassed', ctx({ actor: 'system' })),
      ).toThrow(/missingResponseDeadline/);
    });

    it('CustomerCancels -> CANCELLED_BY_CUSTOMER, full release, no charge regardless of timing', () => {
      const result = transition(
        'PENDING',
        'CustomerCancels',
        ctx({ actor: 'customer', clock: new Date('2026-09-01T08:59:00Z') }),
      );
      expect(result.nextState).toBe('CANCELLED_BY_CUSTOMER');
      expect(result.effects).toContainEqual({ type: 'ReleaseAuth' });
      expect(result.effects).not.toContainEqual(
        expect.objectContaining({ type: 'Capture' }),
      );
    });

    it('rejects an event not defined for PENDING', () => {
      expect(() =>
        transition('PENDING', 'ProviderCompletes', ctx({ actor: 'provider' })),
      ).toThrow(/noSuchTransition/);
    });
  });

  describe('CONFIRMED — customer cancel boundary (`[D-3]`)', () => {
    it('more than 12h out: full refund via ReleaseAuth when uncaptured', () => {
      const result = transition(
        'CONFIRMED',
        'CustomerCancels',
        ctx({ actor: 'customer', clock: new Date('2026-08-31T20:59:59Z') }),
      );
      expect(result.nextState).toBe('CANCELLED_BY_CUSTOMER');
      expect(result.effects).toContainEqual({ type: 'ReleaseAuth' });
    });

    it('more than 12h out: full Refund(100%) when already captured', () => {
      const result = transition(
        'CONFIRMED',
        'CustomerCancels',
        ctx({
          actor: 'customer',
          clock: new Date('2026-08-31T20:59:59Z'),
          alreadyCaptured: true,
        }),
      );
      expect(result.effects).toContainEqual({ type: 'Refund', pct: 100 });
    });

    it('exactly at the 12h boundary charges 50% — design specifies `<= 12h`, not `< 12h`', () => {
      const result = transition(
        'CONFIRMED',
        'CustomerCancels',
        ctx({ actor: 'customer', clock: new Date('2026-08-31T21:00:00Z') }),
      );
      expect(result.effects).toContainEqual({ type: 'Capture', pct: 50 });
    });

    it('one second before the 12h boundary is still full refund', () => {
      const result = transition(
        'CONFIRMED',
        'CustomerCancels',
        ctx({ actor: 'customer', clock: new Date('2026-08-31T20:59:59Z') }),
      );
      expect(result.effects).toContainEqual({ type: 'ReleaseAuth' });
    });

    it('one second past the 12h boundary charges 50%', () => {
      const result = transition(
        'CONFIRMED',
        'CustomerCancels',
        ctx({ actor: 'customer', clock: new Date('2026-08-31T21:00:01Z') }),
      );
      expect(result.nextState).toBe('CANCELLED_BY_CUSTOMER');
      expect(result.effects).toContainEqual({ type: 'Capture', pct: 50 });
      expect(result.effects).toContainEqual({ type: 'Split' });
    });

    it('inside the window and already captured: Refund(50%) not Capture', () => {
      const result = transition(
        'CONFIRMED',
        'CustomerCancels',
        ctx({
          actor: 'customer',
          clock: new Date('2026-09-01T05:00:00Z'),
          alreadyCaptured: true,
        }),
      );
      expect(result.effects).toContainEqual({ type: 'Refund', pct: 50 });
    });

    it('rejects CustomerCancels actor mismatch', () => {
      expect(() =>
        transition('CONFIRMED', 'CustomerCancels', ctx({ actor: 'provider' })),
      ).toThrow(/unauthorizedActor/);
    });
  });

  describe('CONFIRMED — provider cancel', () => {
    it('always refunds 100% with no fee, regardless of timing', () => {
      const late = transition(
        'CONFIRMED',
        'ProviderCancels',
        ctx({ actor: 'provider', clock: new Date('2026-09-01T08:59:59Z') }),
      );
      expect(late.nextState).toBe('CANCELLED_BY_PROVIDER');
      expect(late.effects).toContainEqual({ type: 'ReleaseAuth' });
      expect(late.effects).toContainEqual({ type: 'RecordStanding', kind: 'provider_cancel' });
      expect(late.effects).not.toContainEqual(expect.objectContaining({ type: 'Capture' }));
    });

    it('refunds 100% via Refund when already captured', () => {
      const result = transition(
        'CONFIRMED',
        'ProviderCancels',
        ctx({ actor: 'provider', alreadyCaptured: true }),
      );
      expect(result.effects).toContainEqual({ type: 'Refund', pct: 100 });
    });
  });

  describe('CONFIRMED — complete', () => {
    it('blocks completion before slot start', () => {
      expect(() =>
        transition(
          'CONFIRMED',
          'ProviderCompletes',
          ctx({ actor: 'provider', clock: new Date('2026-09-01T08:59:59Z') }),
        ),
      ).toThrow(/completeBeforeSlotStart/);
    });

    it('completes at or after slot start: captures 100% and splits', () => {
      const result = transition(
        'CONFIRMED',
        'ProviderCompletes',
        ctx({ actor: 'provider', clock: new Date('2026-09-01T09:00:00Z') }),
      );
      expect(result.nextState).toBe('COMPLETED');
      expect(result.effects).toContainEqual({ type: 'Capture', pct: 100 });
      expect(result.effects).toContainEqual({ type: 'Split' });
    });

    it('AutoCompleteElapsed behaves the same as ProviderCompletes', () => {
      const result = transition(
        'CONFIRMED',
        'AutoCompleteElapsed',
        ctx({ actor: 'system', clock: new Date('2026-09-01T12:00:00Z') }),
      );
      expect(result.nextState).toBe('COMPLETED');
      expect(result.effects).toContainEqual({ type: 'Capture', pct: 100 });
    });
  });

  describe('CONFIRMED — no-show', () => {
    it('customer no-show: full capture and split, only after slot start', () => {
      expect(() =>
        transition(
          'CONFIRMED',
          'ProviderReportsCustomerNoShow',
          ctx({ actor: 'provider', clock: new Date('2026-09-01T08:59:59Z') }),
        ),
      ).toThrow(/noShowBeforeSlotStart/);

      const result = transition(
        'CONFIRMED',
        'ProviderReportsCustomerNoShow',
        ctx({ actor: 'provider', clock: new Date('2026-09-01T09:00:00Z') }),
      );
      expect(result.nextState).toBe('NO_SHOW_CUSTOMER');
      expect(result.effects).toContainEqual({ type: 'Capture', pct: 100 });
    });

    it('provider no-show: full refund and standing event', () => {
      const result = transition(
        'CONFIRMED',
        'CustomerReportsProviderNoShow',
        ctx({ actor: 'customer', clock: new Date('2026-09-01T09:00:00Z'), alreadyCaptured: true }),
      );
      expect(result.nextState).toBe('NO_SHOW_PROVIDER');
      expect(result.effects).toContainEqual({ type: 'Refund', pct: 100 });
      expect(result.effects).toContainEqual({ type: 'RecordStanding', kind: 'provider_no_show' });
    });
  });

  describe('unlisted from/event combinations', () => {
    it('rejects an event not defined for CONFIRMED', () => {
      expect(() =>
        transition('CONFIRMED', 'ProviderDeclines', ctx({ actor: 'provider' })),
      ).toThrow(/noSuchTransition/);
    });
  });

  describe('determinism', () => {
    it('identical input produces identical output', () => {
      const a = transition('PENDING', 'ProviderAccepts', ctx({ actor: 'provider' }));
      const b = transition('PENDING', 'ProviderAccepts', ctx({ actor: 'provider' }));
      expect(a).toEqual(b);
    });
  });

  describe('exhaustive table', () => {
    const table: Array<{
      from: BookingState;
      event: BookingEvent;
      actor: TransitionContext['actor'];
      to: BookingState;
    }> = [
      { from: 'PENDING', event: 'ProviderAccepts', actor: 'provider', to: 'CONFIRMED' },
      { from: 'PENDING', event: 'ProviderDeclines', actor: 'provider', to: 'DECLINED' },
      { from: 'PENDING', event: 'CustomerCancels', actor: 'customer', to: 'CANCELLED_BY_CUSTOMER' },
      {
        from: 'CONFIRMED',
        event: 'CustomerCancels',
        actor: 'customer',
        to: 'CANCELLED_BY_CUSTOMER',
      },
      {
        from: 'CONFIRMED',
        event: 'ProviderCancels',
        actor: 'provider',
        to: 'CANCELLED_BY_PROVIDER',
      },
      { from: 'CONFIRMED', event: 'ProviderCompletes', actor: 'provider', to: 'COMPLETED' },
      { from: 'CONFIRMED', event: 'AutoCompleteElapsed', actor: 'system', to: 'COMPLETED' },
      {
        from: 'CONFIRMED',
        event: 'ProviderReportsCustomerNoShow',
        actor: 'provider',
        to: 'NO_SHOW_CUSTOMER',
      },
      {
        from: 'CONFIRMED',
        event: 'CustomerReportsProviderNoShow',
        actor: 'customer',
        to: 'NO_SHOW_PROVIDER',
      },
    ];

    for (const row of table) {
      it(`${row.from} + ${row.event} (by ${row.actor}) -> ${row.to}`, () => {
        const result = transition(
          row.from,
          row.event,
          ctx({ actor: row.actor, clock: new Date('2026-09-01T09:00:00Z') }),
        );
        expect(result.nextState).toBe(row.to);
      });
    }

    it('PENDING + ResponseDeadlinePassed (by system) -> EXPIRED', () => {
      const deadline = computeResponseDeadline(
        new Date('2026-08-25T09:00:00Z'),
        SLOT_START,
        2,
      );
      const result = transition(
        'PENDING',
        'ResponseDeadlinePassed',
        ctx({
          actor: 'system',
          clock: new Date(deadline.getTime() + 1000),
          responseDeadline: deadline,
        }),
      );
      expect(result.nextState).toBe('EXPIRED');
    });
  });
});
