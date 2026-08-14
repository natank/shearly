import { describe, expect, it } from 'vitest';
import { getTextDirection } from './locales.js';

describe('getTextDirection', () => {
  it('is rtl for Hebrew', () => {
    expect(getTextDirection('he')).toBe('rtl');
  });

  it('is ltr for English', () => {
    expect(getTextDirection('en')).toBe('ltr');
  });
});
