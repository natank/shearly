import { describe, expect, it } from 'vitest';
import { isCompleteDraft } from './draft.js';

describe('isCompleteDraft', () => {
  it('is complete when every required field is present', () => {
    expect(
      isCompleteDraft({
        providerId: 'p1',
        serviceId: 's1',
        slotStart: '2026-09-01T09:00:00Z',
        addressLine: 'Home 1',
        lat: 32.08,
        lng: 34.78,
      }),
    ).toBe(true);
  });

  it('is incomplete when the address is missing (the guest has not entered one yet)', () => {
    expect(
      isCompleteDraft({
        providerId: 'p1',
        serviceId: 's1',
        slotStart: '2026-09-01T09:00:00Z',
        lat: 32.08,
        lng: 34.78,
      }),
    ).toBe(false);
  });

  it('is incomplete when lat/lng are missing', () => {
    expect(
      isCompleteDraft({
        providerId: 'p1',
        serviceId: 's1',
        slotStart: '2026-09-01T09:00:00Z',
        addressLine: 'Home 1',
      }),
    ).toBe(false);
  });

  it('is incomplete when the provider or service id is missing', () => {
    expect(
      isCompleteDraft({
        serviceId: 's1',
        slotStart: '2026-09-01T09:00:00Z',
        addressLine: 'Home 1',
        lat: 32.08,
        lng: 34.78,
      }),
    ).toBe(false);
    expect(
      isCompleteDraft({
        providerId: 'p1',
        slotStart: '2026-09-01T09:00:00Z',
        addressLine: 'Home 1',
        lat: 32.08,
        lng: 34.78,
      }),
    ).toBe(false);
  });

  it('accessNotes is optional', () => {
    expect(
      isCompleteDraft({
        providerId: 'p1',
        serviceId: 's1',
        slotStart: '2026-09-01T09:00:00Z',
        addressLine: 'Home 1',
        lat: 32.08,
        lng: 34.78,
      }),
    ).toBe(true);
  });
});
