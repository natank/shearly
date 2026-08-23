import type { Pool, PoolClient } from 'pg';
import type { EventCatalog, EventType, OutboxEventRow } from './event-catalog.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

/**
 * design §6.4: writes an outbox row in the caller's own transaction — pass
 * the same `client` the caller already has an open `BEGIN`/`COMMIT` on, so
 * the event and the state change it describes commit or roll back together.
 * Each service calls this against its *own* schema (design §6.2 forbids a
 * shared events schema — see the M5 plan's M5-Q1 resolution), so `schema`
 * is the caller's own schema name, not a fixed constant.
 */
export async function insertOutboxEvent<T extends EventType>(
  client: Queryable,
  schema: string,
  type: T,
  payload: EventCatalog[T],
): Promise<void> {
  await client.query(`INSERT INTO ${schema}.outbox (type, payload) VALUES ($1, $2::jsonb)`, [
    type,
    JSON.stringify(payload),
  ]);
}

/**
 * Claims up to `limit` undispatched rows with `FOR UPDATE SKIP LOCKED`
 * (same concurrency guarantee as booking's own occupancy work, M4) so two
 * dispatcher instances racing the same schema's outbox never double-claim
 * a row. Runs `handle` for each; a throw leaves the row `dispatched_at`
 * null and increments `attempts` rather than losing the event.
 */
export async function dispatchDueOutboxEvents(
  pool: Pool,
  schema: string,
  handle: (row: OutboxEventRow) => Promise<void>,
  limit = 50,
): Promise<{ dispatched: number; failed: number }> {
  let dispatched = 0;
  let failed = 0;

  // Each row is claimed and handled in its own transaction — the SKIP
  // LOCKED row lock must stay held for the handler's full duration, not
  // just the SELECT, or a second tick can claim the same row while the
  // first tick's handler is still running.
  for (;;) {
    const client = await pool.connect();
    let claimed: {
      id: string;
      type: EventType;
      payload: unknown;
      created_at: Date;
      dispatched_at: Date | null;
      attempts: number;
    } | null = null;
    try {
      await client.query('BEGIN');
      const due = await client.query<{
        id: string;
        type: EventType;
        payload: unknown;
        created_at: Date;
        dispatched_at: Date | null;
        attempts: number;
      }>(
        `SELECT id, type, payload, created_at, dispatched_at, attempts
         FROM ${schema}.outbox
         WHERE dispatched_at IS NULL
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      );
      claimed = due.rows[0] ?? null;
      if (!claimed) {
        await client.query('COMMIT');
        client.release();
        break;
      }

      const event: OutboxEventRow = {
        id: claimed.id,
        type: claimed.type,
        payload: claimed.payload as EventCatalog[EventType],
        created_at: claimed.created_at,
        dispatched_at: claimed.dispatched_at,
        attempts: claimed.attempts,
      };
      try {
        await handle(event);
        await client.query(`UPDATE ${schema}.outbox SET dispatched_at = now() WHERE id = $1`, [
          claimed.id,
        ]);
        await client.query('COMMIT');
        dispatched += 1;
      } catch {
        await client.query(`UPDATE ${schema}.outbox SET attempts = attempts + 1 WHERE id = $1`, [
          claimed.id,
        ]);
        await client.query('COMMIT');
        failed += 1;
      }
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
    client.release();
    if (dispatched + failed >= limit) {
      break;
    }
  }
  return { dispatched, failed };
}
