import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function migratePayments(databaseUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query(`
      DO $payments_schema$
      BEGIN
        CREATE SCHEMA IF NOT EXISTS payments;
      EXCEPTION
        WHEN duplicate_schema THEN NULL;
      END
      $payments_schema$;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments.schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM payments.schema_migrations',
    );
    const done = new Set(existing.rows.map((row) => row.id));
    for (const file of files) {
      if (done.has(file)) {
        continue;
      }
      await client.query(readFileSync(join(migrationsDir, file), 'utf8'));
      await client.query('INSERT INTO payments.schema_migrations (id) VALUES ($1)', [file]);
      applied.push(file);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
