import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

export function listMigrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

export async function migrateIdentity(databaseUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA IF NOT EXISTS identity');
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity.schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM identity.schema_migrations',
    );
    const done = new Set(existing.rows.map((row) => row.id));
    for (const file of listMigrationFiles()) {
      if (done.has(file)) {
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO identity.schema_migrations (id) VALUES ($1)', [file]);
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
