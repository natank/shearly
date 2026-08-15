import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { AvailabilityService } from './availability-service.js';
import { migrateAvailability } from './migrate.js';

const url = process.env.DATABASE_URL;

describe('AvailabilityService', () => {
  const pool = url ? new pg.Pool({ connectionString: url }) : null;
  const availability = pool ? new AvailabilityService(pool, 30, 15) : null;

  beforeAll(async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M2-P4)');
      }
      return;
    }
    await migrateAvailability(url);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('rejects a block that overlaps fixture occupancy', async () => {
    if (!availability) {
      return;
    }
    const accountId = crypto.randomUUID();
    await availability.replaceWeekly(accountId, [
      { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
    ]);
    await expect(
      availability.addException(accountId, { date: '2026-08-17', kind: 'block' }, [
        {
          id: 'fix-1',
          start: new Date('2026-08-17T10:00:00.000Z'),
          end: new Date('2026-08-17T11:00:00.000Z'),
        },
      ]),
    ).rejects.toMatchObject({ translationKey: 'availability.conflicts:fix-1' });
    await availability.addException(accountId, { date: '2026-08-18', kind: 'block' });
    expect(await availability.hasAvailability(accountId)).toBe(true);
    const slots = await availability.slots(accountId, {
      durationMinutes: 60,
      from: new Date('2026-08-17T00:00:00.000Z'),
      to: new Date('2026-08-17T00:00:00.000Z'),
      now: new Date('2026-08-16T00:00:00.000Z'),
    });
    expect(slots.length).toBeGreaterThan(0);
  });
});
