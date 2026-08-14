import { describe, expect, it } from 'vitest';
import { PRICING_NAME } from './index.js';

describe('pricing stub', () => {
  it('exports its name', () => {
    expect(PRICING_NAME).toBe('pricing');
  });
});
