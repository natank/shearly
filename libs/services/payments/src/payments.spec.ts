import { describe, expect, it } from 'vitest';
import { PAYMENTS_SERVICE_NAME } from './index.js';

describe('payments stub', () => {
  it('exports its name', () => {
    expect(PAYMENTS_SERVICE_NAME).toBe('payments');
  });
});
