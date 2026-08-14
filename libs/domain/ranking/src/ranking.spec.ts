import { describe, expect, it } from 'vitest';
import { RANKING_NAME } from './index.js';

describe('ranking stub', () => {
  it('exports its name', () => {
    expect(RANKING_NAME).toBe('ranking');
  });
});
