import { describe, expect, it } from 'vitest';
import { evaluateGoLive } from './go-live.js';

describe('evaluateGoLive', () => {
  it('names each missing prerequisite', () => {
    expect(
      evaluateGoLive({
        approved: false,
        connectComplete: false,
        serviceCount: 0,
        hasAvailability: false,
      }).missing,
    ).toEqual(['vetting', 'connect', 'services', 'availability']);
    expect(
      evaluateGoLive({
        approved: true,
        connectComplete: true,
        serviceCount: 1,
        hasAvailability: true,
      }),
    ).toEqual({ ready: true, missing: [] });
  });
});
