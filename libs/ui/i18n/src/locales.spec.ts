import { describe, expect, it } from 'vitest';
import { getTextDirection, isLocale, loadCommonMessages } from './index';

describe('getTextDirection', () => {
  it('is rtl for Hebrew', () => {
    expect(getTextDirection('he')).toBe('rtl');
  });

  it('is ltr for English', () => {
    expect(getTextDirection('en')).toBe('ltr');
  });
});

describe('isLocale', () => {
  it('accepts en and he', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('he')).toBe(true);
    expect(isLocale('fr')).toBe(false);
  });
});

describe('loadCommonMessages', () => {
  it('loads Hebrew app name', async () => {
    const messages = await loadCommonMessages('he');
    expect(messages.appName).toBe('שירלי');
  });
});
