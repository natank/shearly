import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const url = process.env.DATABASE_URL;

describe('postgres smoke', () => {
  it('connects and selects 1 when DATABASE_URL is set', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M0-P6 integration)');
      }
      return;
    }

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const result = await client.query('SELECT 1 AS ok');
      expect(result.rows[0]?.ok).toBe(1);
      const schema = await client.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'identity'`,
      );
      expect(schema.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });
});

afterAll(() => undefined);
