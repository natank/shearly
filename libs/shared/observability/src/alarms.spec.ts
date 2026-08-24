import { describe, expect, it, vi } from 'vitest';
import { createExpirySpikeDetector, fireAlarm } from './alarms.js';

describe('fireAlarm', () => {
  it('writes a structured, greppable ALARM:<name> line to stderr', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      fireAlarm('paymentCaptureFailure', { bookingId: 'b-1', amountMinor: 2000 });
      expect(write).toHaveBeenCalledTimes(1);
      const line = write.mock.calls[0]?.[0] as string;
      expect(line.startsWith('ALARM:paymentCaptureFailure ')).toBe(true);
      const payload = JSON.parse(line.slice('ALARM:paymentCaptureFailure '.length)) as {
        bookingId: string;
        amountMinor: number;
        at: string;
      };
      expect(payload).toMatchObject({ bookingId: 'b-1', amountMinor: 2000 });
      expect(typeof payload.at).toBe('string');
    } finally {
      write.mockRestore();
    }
  });
});

describe('createExpirySpikeDetector', () => {
  it('does not fire under a condition that should not trigger it: below-threshold events within the window', () => {
    const detector = createExpirySpikeDetector(10 * 60 * 1000, 5);
    const base = 1_000_000;
    expect(detector.record(base)).toBe(false);
    expect(detector.record(base + 1000)).toBe(false);
    expect(detector.record(base + 2000)).toBe(false);
    expect(detector.record(base + 3000)).toBe(false);
    // 4 events, threshold is 5 — must not fire yet.
  });

  it('fires under a scripted condition that should trigger it: threshold events within the window', () => {
    const detector = createExpirySpikeDetector(10 * 60 * 1000, 5);
    const base = 1_000_000;
    expect(detector.record(base)).toBe(false);
    expect(detector.record(base + 1000)).toBe(false);
    expect(detector.record(base + 2000)).toBe(false);
    expect(detector.record(base + 3000)).toBe(false);
    expect(detector.record(base + 4000)).toBe(true);
  });

  it('does not fire when the same event count is spread outside the window', () => {
    const detector = createExpirySpikeDetector(10 * 60 * 1000, 5);
    const base = 1_000_000;
    const windowMs = 10 * 60 * 1000;
    expect(detector.record(base)).toBe(false);
    expect(detector.record(base + 1000)).toBe(false);
    expect(detector.record(base + 2000)).toBe(false);
    expect(detector.record(base + 3000)).toBe(false);
    // The 5th event lands well after the first has aged out of the
    // window — should still be below threshold, not a spike.
    expect(detector.record(base + windowMs + 4000)).toBe(false);
  });
});
