import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { IDENTITY_SERVICE_NAME } from './index.js';
import { listMigrationFiles, migrateIdentity } from './migrate.js';

const url = process.env.DATABASE_URL;

describe('identity migrations', () => {
  it('exports the service name', () => {
    expect(IDENTITY_SERVICE_NAME).toBe('identity');
  });

  it('lists SQL files in order', () => {
    expect(listMigrationFiles()[0]).toBe('001_identity_init.sql');
  });

  it('applies the identity schema and is idempotent', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M1-P1)');
      }
      return;
    }

    const first = await migrateIdentity(url);
    const second = await migrateIdentity(url);
    expect(first.length + second.length).toBeGreaterThanOrEqual(0);
    expect(second).toEqual([]);

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const schema = await client.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'identity'`,
      );
      expect(schema.rowCount).toBe(1);
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'identity'
         ORDER BY table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual(
        expect.arrayContaining([
          'accounts',
          'auth_rate_limits',
          'guest_drafts',
          'password_reset_tokens',
          'schema_migrations',
          'sessions',
        ]),
      );
    } finally {
      await client.end();
    }
  });
});
