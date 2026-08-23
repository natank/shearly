import type { Pool, PoolClient, QueryResultRow } from 'pg';

export type Queryable = Pick<Pool | PoolClient, 'query'>;

export type ClaimDueWorkSource<TRow extends QueryResultRow> = {
  /** Must end in `FOR UPDATE SKIP LOCKED` and select at most one row (`LIMIT 1`). */
  claimSql: string;
  claimParams?: unknown[];
  /** Runs in the same transaction as the claim, right before COMMIT, on success. */
  markDone: (client: Queryable, row: TRow) => Promise<void>;
  /** Runs in the same transaction as the claim, right before COMMIT, on handler failure. */
  markFailed: (client: Queryable, row: TRow) => Promise<void>;
};

/**
 * design §6.6: one lock row per due item, `FOR UPDATE SKIP LOCKED` (same
 * guarantee as M4's booking-occupancy exclusion and M5-P1's outbox
 * dispatcher) so two poller ticks racing the same due row never claim it
 * twice. The row lock is held for the handler's full duration — claim,
 * handle, and mark-done/mark-failed all happen inside one transaction —
 * or a second tick could claim the row while the first tick's handler is
 * still running (the exact bug the M5-P1 outbox dispatcher had before its
 * concurrency test caught it).
 *
 * A handler that throws leaves the row exactly as `markFailed` left it
 * (typically an incremented attempt counter), never half-applied: `handle`
 * runs inside a savepoint, so a throw undoes only what `handle` itself
 * wrote, and `markFailed` then runs against the still-locked, still-open
 * outer transaction — a booking (or any claimed row) can never end up
 * partially transitioned.
 */
export async function claimDueWork<TRow extends QueryResultRow>(
  pool: Pool,
  source: ClaimDueWorkSource<TRow>,
  handle: (client: PoolClient, row: TRow) => Promise<void>,
  limit = 50,
): Promise<{ claimed: number; succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  let claimed = 0;

  for (;;) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const due = await client.query<TRow>(source.claimSql, source.claimParams);
      const row = due.rows[0];
      if (!row) {
        await client.query('COMMIT');
        client.release();
        break;
      }
      claimed += 1;

      // `handle` runs inside a savepoint, not the outer transaction directly:
      // a throw rolls back only what `handle` wrote, while the outer
      // transaction — and the row lock the claim above took — stays open,
      // so `markFailed` runs against the same locked row rather than racing
      // a second tick that could otherwise reclaim it in the gap.
      await client.query('SAVEPOINT handle_attempt');
      try {
        await handle(client, row);
        await client.query('RELEASE SAVEPOINT handle_attempt');
        await source.markDone(client, row);
        await client.query('COMMIT');
        succeeded += 1;
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT handle_attempt');
        await source.markFailed(client, row);
        await client.query('COMMIT');
        failed += 1;
      }
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }
    client.release();
    if (claimed >= limit) {
      break;
    }
  }
  return { claimed, succeeded, failed };
}
