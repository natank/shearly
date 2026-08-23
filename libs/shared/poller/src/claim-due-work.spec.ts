import { beforeAll, describe, expect, it } from 'vitest';
import pg, { type QueryResultRow } from 'pg';
import { claimDueWork, type Queryable } from './claim-due-work.js';

const url = process.env.DATABASE_URL;

type ProbeRow = QueryResultRow & { id: string; value: number; attempts: number };

// This lib is domain-agnostic — the poller claims booking/authorization
// rows in production, but this suite exercises claimDueWork() itself
// against a throwaway schema, independent of any consuming service's
// migration (same reasoning as M5-P1's outbox.spec.ts).
async function ensureProbeSchema(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS test_poller_probe');
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_poller_probe.due_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        value integer NOT NULL,
        done_at timestamptz,
        attempts int NOT NULL DEFAULT 0
      )
    `);
  } finally {
    await client.end();
  }
}

function claimSource() {
  return {
    claimSql: `SELECT id, value, attempts FROM test_poller_probe.due_items
                WHERE done_at IS NULL ORDER BY value LIMIT 1 FOR UPDATE SKIP LOCKED`,
    markDone: async (client: Queryable, row: ProbeRow) => {
      await client.query('UPDATE test_poller_probe.due_items SET done_at = now() WHERE id = $1', [
        row.id,
      ]);
    },
    markFailed: async (client: Queryable, row: ProbeRow) => {
      await client.query(
        'UPDATE test_poller_probe.due_items SET attempts = attempts + 1 WHERE id = $1',
        [row.id],
      );
    },
  };
}

describe('claimDueWork', () => {
  beforeAll(async () => {
    if (url) {
      await ensureProbeSchema(url);
    }
  });

  it('claims and completes a due row', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const pool = new pg.Pool({ connectionString: url });
    try {
      const insert = await pool.query<{ id: string }>(
        'INSERT INTO test_poller_probe.due_items (value) VALUES ($1) RETURNING id',
        [1],
      );
      const id = insert.rows[0].id;

      const result = await claimDueWork<ProbeRow>(pool, claimSource(), async () => undefined, 10);
      expect(result.succeeded).toBeGreaterThanOrEqual(1);

      const row = await pool.query<{ done_at: Date | null }>(
        'SELECT done_at FROM test_poller_probe.due_items WHERE id = $1',
        [id],
      );
      expect(row.rows[0].done_at).not.toBeNull();
    } finally {
      await pool.end();
    }
  });

  it('a handler that throws leaves the row unclaimed-again with attempts incremented, not lost or half-applied', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const pool = new pg.Pool({ connectionString: url });
    try {
      const insert = await pool.query<{ id: string }>(
        'INSERT INTO test_poller_probe.due_items (value) VALUES ($1) RETURNING id',
        [2],
      );
      const id = insert.rows[0].id;

      const result = await claimDueWork<ProbeRow>(
        pool,
        claimSource(),
        async (client) => {
          // Simulate a handler that partially writes, then throws — the
          // partial write must not survive.
          await client.query('UPDATE test_poller_probe.due_items SET value = 999 WHERE id = $1', [
            id,
          ]);
          throw new Error('handler exploded');
        },
        10,
      );
      expect(result.failed).toBeGreaterThanOrEqual(1);

      const row = await pool.query<{ done_at: Date | null; attempts: number; value: number }>(
        'SELECT done_at, attempts, value FROM test_poller_probe.due_items WHERE id = $1',
        [id],
      );
      expect(row.rows[0].done_at).toBeNull();
      expect(row.rows[0].attempts).toBeGreaterThanOrEqual(1);
      expect(row.rows[0].value).toBe(2);

      const retried = await claimDueWork<ProbeRow>(pool, claimSource(), async () => undefined, 10);
      expect(retried.succeeded).toBeGreaterThanOrEqual(1);
      const rowAfterRetry = await pool.query<{ done_at: Date | null }>(
        'SELECT done_at FROM test_poller_probe.due_items WHERE id = $1',
        [id],
      );
      expect(rowAfterRetry.rows[0].done_at).not.toBeNull();
    } finally {
      await pool.end();
    }
  });

  it('two concurrent claims racing the same due row: exactly one claims it', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const pool = new pg.Pool({ connectionString: url });
    try {
      await pool.query('DELETE FROM test_poller_probe.due_items WHERE done_at IS NULL');
      const insert = await pool.query<{ id: string }>(
        'INSERT INTO test_poller_probe.due_items (value) VALUES ($1) RETURNING id',
        [3],
      );
      const id = insert.rows[0].id;

      const claimedIds: string[] = [];
      let releaseFirst: () => void = () => undefined;
      let resolveEntered: () => void = () => undefined;
      const firstHandlerEntered = new Promise<void>((resolve) => {
        resolveEntered = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const tick1 = claimDueWork<ProbeRow>(
        pool,
        claimSource(),
        async (_client, row) => {
          resolveEntered();
          await blocked;
          claimedIds.push(row.id);
        },
        10,
      );
      await firstHandlerEntered;
      const tick2 = await claimDueWork<ProbeRow>(
        pool,
        claimSource(),
        async (_client, row) => {
          claimedIds.push(row.id);
        },
        10,
      );
      releaseFirst();
      await tick1;

      expect(claimedIds.filter((claimedId) => claimedId === id)).toHaveLength(1);
      expect(tick2.claimed).toBe(0);
    } finally {
      await pool.end();
    }
  });
});
