import { describe, expect, it } from 'vitest';
import { canReportProviderNoShow } from './history.js';

describe('canReportProviderNoShow', () => {
  const now = new Date('2026-08-25T12:00:00.000Z');

  it('is false before slot_start has passed, even when CONFIRMED', () => {
    expect(
      canReportProviderNoShow({ state: 'CONFIRMED', slotStart: '2026-08-25T13:00:00.000Z' }, now),
    ).toBe(false);
  });

  it('is true once slot_start has passed and the booking is CONFIRMED', () => {
    expect(
      canReportProviderNoShow({ state: 'CONFIRMED', slotStart: '2026-08-25T11:00:00.000Z' }, now),
    ).toBe(true);
  });

  it('is false for any state other than CONFIRMED, regardless of timing', () => {
    for (const state of ['PENDING', 'COMPLETED', 'CANCELLED_BY_CUSTOMER', 'NO_SHOW_PROVIDER']) {
      expect(canReportProviderNoShow({ state, slotStart: '2026-08-25T11:00:00.000Z' }, now)).toBe(
        false,
      );
    }
  });
});
