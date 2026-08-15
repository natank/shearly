import { describe, expect, it } from 'vitest';
import { PAYMENTS_SERVICE_NAME } from './index.js';
import { migratePayments } from './migrate.js';

const url = process.env.DATABASE_URL;

describe('payments stub', () => {
  it('exports its name', () => {
    expect(PAYMENTS_SERVICE_NAME).toBe('payments');
  });

  it('migrates the connect table idempotently', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M2-P1)');
      }
      return;
    }
    await migratePayments(url);
    expect(await migratePayments(url)).toEqual([]);
  });
});
