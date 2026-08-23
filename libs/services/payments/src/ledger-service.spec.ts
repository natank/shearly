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
});
