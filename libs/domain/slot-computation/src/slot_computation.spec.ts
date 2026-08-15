import { describe, expect, it } from 'vitest';
import {
  SLOT_COMPUTATION_NAME,
  computeSlots,
  distanceBandMinutes,
  haversineKm,
  occupancyConflicts,
} from './index.js';

const monday = new Date('2026-08-17T00:00:00.000Z');
const weekly = [{ weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }];

describe('slot-computation', () => {
  it('exports its name', () => {
    expect(SLOT_COMPUTATION_NAME).toBe('slot-computation');
  });

  it('emits 60-minute Monday slots inside the window', () => {
    const slots = computeSlots({
      weekly,
      exceptions: [],
      durationMinutes: 60,
      bufferMinutes: 15,
      occupancy: [],
      from: monday,
      to: monday,
      now: new Date('2026-08-16T00:00:00.000Z'),
    });
    expect(slots).toHaveLength(8);
    expect(slots[0]?.start.toISOString()).toBe('2026-08-17T09:00:00.000Z');
    expect(slots.at(-1)?.start.toISOString()).toBe('2026-08-17T16:00:00.000Z');
  });

  it('removes a blocked day and honors extra hours', () => {
    const blocked = computeSlots({
      weekly,
      exceptions: [{ date: '2026-08-17', kind: 'block' }],
      durationMinutes: 60,
      bufferMinutes: 0,
      occupancy: [],
      from: monday,
      to: monday,
      now: new Date('2026-08-16T00:00:00.000Z'),
    });
    expect(blocked).toEqual([]);
    const extra = computeSlots({
      weekly: [],
      exceptions: [{ date: '2026-08-17', kind: 'extra', startMinute: 12 * 60, endMinute: 14 * 60 }],
      durationMinutes: 60,
      bufferMinutes: 0,
      occupancy: [],
      from: monday,
      to: monday,
      now: new Date('2026-08-16T00:00:00.000Z'),
    });
    expect(extra).toHaveLength(2);
  });

  it('applies buffer on both sides of occupancy and a distance band', () => {
    const occupancyStart = new Date('2026-08-17T11:00:00.000Z');
    const slots = computeSlots({
      weekly,
      exceptions: [],
      durationMinutes: 60,
      bufferMinutes: 15,
      occupancy: [
        {
          start: occupancyStart,
          end: new Date('2026-08-17T12:00:00.000Z'),
          lat: 32.08,
          lng: 34.78,
        },
      ],
      origin: { lat: 32.2, lng: 34.9 },
      from: monday,
      to: monday,
      now: new Date('2026-08-16T00:00:00.000Z'),
    });
    const starts = slots.map((slot) => slot.start.toISOString());
    expect(starts).not.toContain('2026-08-17T11:00:00.000Z');
    expect(starts).not.toContain('2026-08-17T10:00:00.000Z');
    expect(starts).not.toContain('2026-08-17T12:00:00.000Z');
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    expect(distanceBandMinutes(3)).toBe(0);
    expect(distanceBandMinutes(7)).toBe(15);
    expect(distanceBandMinutes(12)).toBe(30);
    expect(
      occupancyConflicts([{ start: occupancyStart, end: occupancyStart }], '2026-08-17'),
    ).toHaveLength(1);
  });
});
