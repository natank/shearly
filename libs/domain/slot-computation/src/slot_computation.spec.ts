import { describe, expect, it } from 'vitest';
import { SLOT_COMPUTATION_NAME } from './index.js';

describe('slot-computation stub', () => {
  it('exports its name', () => {
    expect(SLOT_COMPUTATION_NAME).toBe('slot-computation');
  });
});
