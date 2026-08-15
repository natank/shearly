import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

export function listCatalogMigrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

export async function migrateCatalog(databaseUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query(`
      DO $catalog_schema$
      BEGIN
        CREATE SCHEMA IF NOT EXISTS catalog;
      EXCEPTION
        WHEN duplicate_schema THEN NULL;
      END
      $catalog_schema$;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS catalog.schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const existing = await client.query<{ id: string }>('SELECT id FROM catalog.schema_migrations');
    const done = new Set(existing.rows.map((row) => row.id));
    for (const file of listCatalogMigrationFiles()) {
      if (done.has(file)) {
        continue;
      }
      await client.query(readFileSync(join(migrationsDir, file), 'utf8'));
      await client.query('INSERT INTO catalog.schema_migrations (id) VALUES ($1)', [file]);
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
