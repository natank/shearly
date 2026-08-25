import { describe, expect, it } from 'vitest';
import { ConnectService, PAYMENTS_SERVICE_NAME } from './index.js';
import { migratePayments } from './migrate.js';

const url = process.env.DATABASE_URL;

describe('payments stub', () => {
  it('exports its name', () => {
    expect(PAYMENTS_SERVICE_NAME).toBe('payments');
  });

  it('migrates the connect table idempotently', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M2-P1)');
      }
      return;
    }
    await migratePayments(url);
    expect(await migratePayments(url)).toEqual([]);
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url });
    try {
      const connect = new ConnectService(pool);
      const accountId = crypto.randomUUID();
      expect(await connect.isComplete(accountId)).toBe(false);
      const start = await connect.startOnboarding(accountId, '');
      expect(start.stub).toBe(true);
      await connect.completeStub(accountId);
      expect(await connect.isComplete(accountId)).toBe(true);
    } finally {
      await pool.end();
    }
  });

  // PAY-006: next_payout_at is the cadence clock the poller claims against
  // — set once at onboarding completion (the earliest a payout is ever
  // possible), and left untouched by a repeat completeStub call so the
  // clock doesn't silently reset on every re-run.
  it('completeStub sets next_payout_at once, on the configured cadence, and does not reset it on retry', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    await migratePayments(url);
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url });
    try {
      const connect = new ConnectService(pool, 7);
      const accountId = crypto.randomUUID();
      const before = new Date();
      await connect.completeStub(accountId);
      const row = await pool.query<{ next_payout_at: Date }>(
        'SELECT next_payout_at FROM payments.connect_accounts WHERE account_id = $1',
        [accountId],
      );
      const firstNextPayoutAt = row.rows[0]?.next_payout_at;
      expect(firstNextPayoutAt).toBeTruthy();
      const daysAhead =
        (new Date(firstNextPayoutAt).getTime() - before.getTime()) / (24 * 60 * 60 * 1000);
      // Loose bound: `before` is a client-side timestamp taken just ahead of
      // the query, and this suite's other spec files share the same DB
      // connection pool concurrently, so real (if unlikely) scheduling
      // delays between `before` and the server's own `now()` are possible —
      // the invariant under test is "about a cadence period", not exact
      // millisecond parity with a client clock read before the query ran.
      expect(daysAhead).toBeGreaterThan(6.5);
      expect(daysAhead).toBeLessThan(7.1);

      await connect.completeStub(accountId);
      const again = await pool.query<{ next_payout_at: Date }>(
        'SELECT next_payout_at FROM payments.connect_accounts WHERE account_id = $1',
        [accountId],
      );
      expect(new Date(again.rows[0]?.next_payout_at).getTime()).toBe(
        new Date(firstNextPayoutAt).getTime(),
      );
      await pool.query('DELETE FROM payments.connect_accounts WHERE account_id = $1', [accountId]);
    } finally {
      await pool.end();
    }
  });
});
