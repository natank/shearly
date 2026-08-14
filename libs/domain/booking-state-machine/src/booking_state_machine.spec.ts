import { describe, expect, it } from 'vitest';
import { BOOKING_STATE_MACHINE_NAME } from './index.js';

describe('booking-state-machine stub', () => {
  it('exports its name', () => {
    expect(BOOKING_STATE_MACHINE_NAME).toBe('booking-state-machine');
  });
});
