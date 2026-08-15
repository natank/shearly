import { describe, expect, it } from 'vitest';
import { PRICING_NAME, splitPrice } from './index.js';

describe('pricing', () => {
  it('exports its name', () => {
    expect(PRICING_NAME).toBe('pricing');
  });

  it('splits 20000 at 20% with no leftover agora', () => {
    const quote = splitPrice(20000, 0.2);
    expect(quote).toEqual({
      gross: 20000,
      commission: 4000,
      net: 16000,
      commissionRate: 0.2,
      travelIncluded: true,
    });
    expect(quote.gross).toBe(quote.commission + quote.net);
  });
});
