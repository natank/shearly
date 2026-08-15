import { describe, expect, it } from 'vitest';
import { AVAILABILITY_SERVICE_NAME } from './index.js';
import { migrateAvailability } from './migrate.js';

const url = process.env.DATABASE_URL;

describe('availability migrate', () => {
  it('exports the service name', () => {
    expect(AVAILABILITY_SERVICE_NAME).toBe('availability');
  });

  it('is idempotent', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M2-P1)');
      }
      return;
    }
    await migrateAvailability(url);
    expect(await migrateAvailability(url)).toEqual([]);
  });
});
