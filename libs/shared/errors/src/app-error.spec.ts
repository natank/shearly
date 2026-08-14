import { describe, expect, it } from 'vitest';
import { ValidationError, toErrorBody } from './app-error.js';

describe('toErrorBody', () => {
  it('exposes a translation key and no English sentence', () => {
    const body = toErrorBody(new ValidationError());
    expect(body).toEqual({ error: 'VALIDATION', translationKey: 'errors.validation' });
    expect(JSON.stringify(body)).not.toMatch(/[A-Z][a-z]+ [a-z]+/);
  });
});
