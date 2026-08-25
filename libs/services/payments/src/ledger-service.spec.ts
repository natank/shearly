import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { LedgerService } from './ledger-service.js';
import { migratePayments } from './migrate.js';

const url = process.env.DATABASE_URL;

describe('LedgerService', () => {
  it('splits gross into commission and net at the configured rate', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const ledger = new LedgerService(pool, 0.2);
    const bookingId = crypto.randomUUID();
    try {
      const entries = await ledger.split(bookingId, 20000);
      expect(entries).toEqual([
        { kind: 'gross', amountMinor: 20000 },
        { kind: 'commission', amountMinor: 4000 },
        { kind: 'net', amountMinor: 16000 },
      ]);

      const stored = await ledger.entriesForBooking(bookingId);
      expect(stored).toEqual(entries);
    } finally {
      await pool.query('DELETE FROM payments.ledger WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('gross/commission/net are separate persisted rows, not derived at read time', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const ledger = new LedgerService(pool, 0.2);
    const bookingId = crypto.randomUUID();
    try {
      await ledger.split(bookingId, 20000);
      const rows = await pool.query(
        'SELECT kind, amount_minor FROM payments.ledger WHERE booking_id = $1',
        [bookingId],
      );
      expect(rows.rowCount).toBe(3);
    } finally {
      await pool.query('DELETE FROM payments.ledger WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('pending balance is zero when the account has no bookings yet', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const ledger = new LedgerService(pool, 0.2);
    try {
      expect(await ledger.pendingBalance(crypto.randomUUID(), [])).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('computes pending balance as net entries minus succeeded payouts', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const ledger = new LedgerService(pool, 0.2);
    const providerAccountId = crypto.randomUUID();
    const bookingId = crypto.randomUUID();
    try {
      await ledger.split(bookingId, 20000); // net 16000
      const pending = await ledger.pendingBalance(providerAccountId, [bookingId]);
      expect(pending).toBe(16000);

      await pool.query(
        `INSERT INTO payments.payouts (provider_account_id, amount_minor, status, triggered_by)
         VALUES ($1, 10000, 'succeeded', 'admin')`,
        [providerAccountId],
      );
      const pendingAfterPayout = await ledger.pendingBalance(providerAccountId, [bookingId]);
      expect(pendingAfterPayout).toBe(6000);

      const paidOut = await ledger.paidOutBalance(providerAccountId);
      expect(paidOut).toBe(10000);
    } finally {
      await pool.query('DELETE FROM payments.payouts WHERE provider_account_id = $1', [
        providerAccountId,
      ]);
      await pool.query('DELETE FROM payments.ledger WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('groups ledger entries by booking for a provider earnings listing', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P2)');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const ledger = new LedgerService(pool, 0.2);
    const bookingA = crypto.randomUUID();
    const bookingB = crypto.randomUUID();
    try {
      expect(await ledger.entriesByBooking([])).toEqual(new Map());

      await ledger.split(bookingA, 20000);
      await ledger.split(bookingB, 10000);
      const byBooking = await ledger.entriesByBooking([bookingA, bookingB]);
      expect(byBooking.get(bookingA)).toEqual([
        { kind: 'gross', amountMinor: 20000 },
        { kind: 'commission', amountMinor: 4000 },
        { kind: 'net', amountMinor: 16000 },
      ]);
      expect(byBooking.get(bookingB)).toEqual([
        { kind: 'gross', amountMinor: 10000 },
        { kind: 'commission', amountMinor: 2000 },
        { kind: 'net', amountMinor: 8000 },
      ]);
    } finally {
      await pool.query('DELETE FROM payments.ledger WHERE booking_id = ANY($1::uuid[])', [
        [bookingA, bookingB],
      ]);
      await pool.end();
    }
  });

  it('triggerPayout (OPS-005) pays out the pending balance, is idempotent by key, and rejects a zero balance', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const ledger = new LedgerService(pool, 0.2);
    const providerAccountId = crypto.randomUUID();
    const bookingId = crypto.randomUUID();
    try {
      await ledger.split(bookingId, 20000); // net 16000

      const key = crypto.randomUUID();
      const payout = await ledger.triggerPayout(key, providerAccountId, [bookingId]);
      expect(payout).toMatchObject({
        providerAccountId,
        amountMinor: 16000,
        status: 'succeeded',
        triggeredBy: 'admin',
      });

      const paidOut = await ledger.paidOutBalance(providerAccountId);
      expect(paidOut).toBe(16000);

      // Idempotent against a double-click: same key returns the same
      // payout row rather than computing a fresh (now-zero) balance.
      const repeat = await ledger.triggerPayout(key, providerAccountId, [bookingId]);
      expect(repeat.id).toBe(payout.id);
      expect(await ledger.paidOutBalance(providerAccountId)).toBe(16000);

      // A distinct key against a now-zero pending balance is a genuine
      // conflict, not a second payout.
      await expect(
        ledger.triggerPayout(crypto.randomUUID(), providerAccountId, [bookingId]),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    } finally {
      await pool.query('DELETE FROM payments.payouts WHERE provider_account_id = $1', [
        providerAccountId,
      ]);
      await pool.query('DELETE FROM payments.ledger WHERE booking_id = $1', [bookingId]);
      await pool.end();
    }
  });

  it('accountsDueForScheduledPayout (PAY-006) finds only complete accounts whose cadence has elapsed', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const ledger = new LedgerService(pool, 0.2);
    const dueAccountId = crypto.randomUUID();
    const notYetDueAccountId = crypto.randomUUID();
    const pendingAccountId = crypto.randomUUID();
    try {
      await pool.query(
        `INSERT INTO payments.connect_accounts (account_id, status, next_payout_at)
         VALUES ($1, 'complete', now() - interval '1 minute')`,
        [dueAccountId],
      );
      await pool.query(
        `INSERT INTO payments.connect_accounts (account_id, status, next_payout_at)
         VALUES ($1, 'complete', now() + interval '7 days')`,
        [notYetDueAccountId],
      );
      // A 'pending' (not yet onboarded) account must never be claimable even
      // if something set next_payout_at on it — status is the primary gate.
      await pool.query(
        `INSERT INTO payments.connect_accounts (account_id, status, next_payout_at)
         VALUES ($1, 'pending', now() - interval '1 minute')`,
        [pendingAccountId],
      );

      const due = await ledger.accountsDueForScheduledPayout(new Date());
      expect(due).toContain(dueAccountId);
      expect(due).not.toContain(notYetDueAccountId);
      expect(due).not.toContain(pendingAccountId);
    } finally {
      await pool.query('DELETE FROM payments.connect_accounts WHERE account_id = ANY($1)', [
        [dueAccountId, notYetDueAccountId, pendingAccountId],
      ]);
      await pool.end();
    }
  });

  it('triggerScheduledPayout (PAY-006) pays out a positive balance and always advances next_payout_at by one cadence period', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    await migratePayments(url);
    const pool = new pg.Pool({ connectionString: url });
    const ledger = new LedgerService(pool, 0.2);
    const providerAccountId = crypto.randomUUID();
    const bookingId = crypto.randomUUID();
    try {
      const initialNextPayoutAt = new Date();
      await pool.query(
        `INSERT INTO payments.connect_accounts (account_id, status, next_payout_at)
         VALUES ($1, 'complete', $2)`,
        [providerAccountId, initialNextPayoutAt],
      );
      await ledger.split(bookingId, 20000); // net 16000

      const payout = await ledger.triggerScheduledPayout(providerAccountId, [bookingId], 7);
      expect(payout).toMatchObject({
        providerAccountId,
        amountMinor: 16000,
        status: 'succeeded',
        triggeredBy: 'schedule',
      });

      const row = await pool.query<{ next_payout_at: Date }>(
        'SELECT next_payout_at FROM payments.connect_accounts WHERE account_id = $1',
        [providerAccountId],
      );
      const daysAdvanced =
        (new Date(row.rows[0].next_payout_at).getTime() - initialNextPayoutAt.getTime()) /
        (24 * 60 * 60 * 1000);
      expect(daysAdvanced).toBeGreaterThan(6.9);
      expect(daysAdvanced).toBeLessThan(7.1);

      // A second scheduled run with the same (now zero) balance is not an
      // error — unlike the admin-triggered path, a quiet week is routine —
      // and still advances the clock so the row isn't reclaimed forever.
      const secondNextPayoutAt = row.rows[0].next_payout_at;
      const noPayout = await ledger.triggerScheduledPayout(providerAccountId, [bookingId], 7);
      expect(noPayout).toBeNull();
      const rowAfter = await pool.query<{ next_payout_at: Date }>(
        'SELECT next_payout_at FROM payments.connect_accounts WHERE account_id = $1',
        [providerAccountId],
      );
      expect(new Date(rowAfter.rows[0].next_payout_at).getTime()).toBeGreaterThan(
        new Date(secondNextPayoutAt).getTime(),
      );
    } finally {
      await pool.query('DELETE FROM payments.payouts WHERE provider_account_id = $1', [
        providerAccountId,
      ]);
      await pool.query('DELETE FROM payments.ledger WHERE booking_id = $1', [bookingId]);
      await pool.query('DELETE FROM payments.connect_accounts WHERE account_id = $1', [
        providerAccountId,
      ]);
      await pool.end();
    }
  });
});
