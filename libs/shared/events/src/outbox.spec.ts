import { beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { insertOutboxEvent, dispatchDueOutboxEvents } from './outbox.js';
import type { OutboxEventRow } from './event-catalog.js';

const url = process.env.DATABASE_URL;

// This lib is schema-agnostic (any service's outbox table has the same
// shape) and must not depend on a consuming service's own migration —
// self-migrate a throwaway `test_outbox_probe` schema instead, so this
// suite works standalone regardless of migration order in CI.
async function ensureTestOutboxSchema(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS test_outbox_probe');
    await client.query(`
      CREATE TABLE IF NOT EXISTS test_outbox_probe.outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        dispatched_at timestamptz,
        attempts int NOT NULL DEFAULT 0
      )
    `);
  } finally {
    await client.end();
  }
}

describe('outbox', () => {
  beforeAll(async () => {
    if (url) {
      await ensureTestOutboxSchema(url);
    }
  });

  it('writing an event alongside a state change is atomic: a forced rollback leaves no orphan row', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const pool = new pg.Pool({ connectionString: url });
    const bookingId = crypto.randomUUID();
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await insertOutboxEvent(client, 'test_outbox_probe', 'BookingStateChanged', {
          bookingId,
          fromState: 'PENDING',
          toState: 'CONFIRMED',
          event: 'ProviderAccepts',
          actor: 'provider',
        });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      const result = await pool.query(
        `SELECT id FROM test_outbox_probe.outbox WHERE payload->>'bookingId' = $1`,
        [bookingId],
      );
      expect(result.rows).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });

  it('a committed write leaves exactly one dispatchable row', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const pool = new pg.Pool({ connectionString: url });
    const bookingId = crypto.randomUUID();
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await insertOutboxEvent(client, 'test_outbox_probe', 'BookingStateChanged', {
          bookingId,
          fromState: 'PENDING',
          toState: 'CONFIRMED',
          event: 'ProviderAccepts',
          actor: 'provider',
        });
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const result = await pool.query(
        `SELECT id, dispatched_at FROM test_outbox_probe.outbox WHERE payload->>'bookingId' = $1`,
        [bookingId],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].dispatched_at).toBeNull();
    } finally {
      await pool.end();
    }
  });

  it('two concurrent dispatcher ticks claim the same due row exactly once (FOR UPDATE SKIP LOCKED)', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const pool = new pg.Pool({ connectionString: url });
    const bookingId = crypto.randomUUID();
    try {
      await pool.query('DELETE FROM test_outbox_probe.outbox WHERE dispatched_at IS NULL');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await insertOutboxEvent(client, 'test_outbox_probe', 'BookingStateChanged', {
          bookingId,
          fromState: 'PENDING',
          toState: 'CONFIRMED',
          event: 'ProviderAccepts',
          actor: 'provider',
        });
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const claimed: OutboxEventRow[] = [];
      // First handler blocks until released, so the second tick's claim
      // attempt races the first tick's still-open transaction — proving
      // SKIP LOCKED, not just that the first tick happened to finish first.
      let releaseFirst: () => void = () => undefined;
      let resolveEntered: () => void = () => undefined;
      const firstHandlerEntered = new Promise<void>((resolve) => {
        resolveEntered = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const tick1 = dispatchDueOutboxEvents(
        pool,
        'test_outbox_probe',
        async (row) => {
          resolveEntered();
          await blocked;
          claimed.push(row);
        },
        10,
      );
      await firstHandlerEntered;
      const tick2 = await dispatchDueOutboxEvents(
        pool,
        'test_outbox_probe',
        async (row) => {
          claimed.push(row);
        },
        10,
      );
      releaseFirst();
      await tick1;

      const idsClaimed = claimed.filter(
        (row) => (row.payload as { bookingId?: string }).bookingId === bookingId,
      );
      expect(idsClaimed).toHaveLength(1);
      expect(tick2.dispatched + tick2.failed).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('a handler that throws leaves the row undispatched with attempts incremented, not lost', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const pool = new pg.Pool({ connectionString: url });
    const bookingId = crypto.randomUUID();
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await insertOutboxEvent(client, 'test_outbox_probe', 'BookingStateChanged', {
          bookingId,
          fromState: 'PENDING',
          toState: 'CONFIRMED',
          event: 'ProviderAccepts',
          actor: 'provider',
        });
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const result = await dispatchDueOutboxEvents(
        pool,
        'test_outbox_probe',
        async () => {
          throw new Error('handler exploded');
        },
        10,
      );
      expect(result.failed).toBeGreaterThanOrEqual(1);

      const row = await pool.query<{ dispatched_at: Date | null; attempts: number }>(
        `SELECT dispatched_at, attempts FROM test_outbox_probe.outbox WHERE payload->>'bookingId' = $1`,
        [bookingId],
      );
      expect(row.rows[0].dispatched_at).toBeNull();
      expect(row.rows[0].attempts).toBeGreaterThanOrEqual(1);

      // Retried on next poll: the row is still due, and a succeeding handler
      // now dispatches it.
      const retried = await dispatchDueOutboxEvents(
        pool,
        'test_outbox_probe',
        async () => undefined,
        10,
      );
      const stillClaimable = retried.dispatched >= 0;
      expect(stillClaimable).toBe(true);
      const rowAfterRetry = await pool.query<{ dispatched_at: Date | null }>(
        `SELECT dispatched_at FROM test_outbox_probe.outbox WHERE payload->>'bookingId' = $1`,
        [bookingId],
      );
      expect(rowAfterRetry.rows[0].dispatched_at).not.toBeNull();
    } finally {
      await pool.end();
    }
  });
});
