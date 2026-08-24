import pg from 'pg';
import { ConflictError } from '@shearly/shared-errors';

export type LedgerEntry = { kind: 'gross' | 'commission' | 'net'; amountMinor: number };
export type Payout = {
  id: string;
  providerAccountId: string;
  amountMinor: number;
  status: 'pending' | 'succeeded' | 'failed';
  triggeredBy: 'admin' | 'schedule';
  createdAt: Date;
};

function toPayout(row: {
  id: string;
  provider_account_id: string;
  amount_minor: number;
  status: 'pending' | 'succeeded' | 'failed';
  triggered_by: 'admin' | 'schedule';
  created_at: Date;
}): Payout {
  return {
    id: row.id,
    providerAccountId: row.provider_account_id,
    amountMinor: row.amount_minor,
    status: row.status,
    triggeredBy: row.triggered_by,
    createdAt: row.created_at,
  };
}

/**
 * design §8.3: append-only, double-entry-shaped. Balance is derived by
 * summation, never a mutable field. Split is called once per booking
 * settlement (complete, late-cancel, no-show) — the caller is responsible
 * for calling it exactly once per booking per settlement event; re-running
 * `split` for the same booking appends a second set of rows, so callers must
 * gate on the booking's own state transition having not already happened
 * (the booking service's transition-already-applied check, not this class).
 */
export class LedgerService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly commissionRate = 0.2,
  ) {}

  async split(bookingId: string, grossMinor: number): Promise<LedgerEntry[]> {
    const commissionMinor = Math.round(grossMinor * this.commissionRate);
    const netMinor = grossMinor - commissionMinor;
    const entries: LedgerEntry[] = [
      { kind: 'gross', amountMinor: grossMinor },
      { kind: 'commission', amountMinor: commissionMinor },
      { kind: 'net', amountMinor: netMinor },
    ];
    for (const entry of entries) {
      await this.pool.query(
        `INSERT INTO payments.ledger (booking_id, kind, amount_minor) VALUES ($1, $2, $3)`,
        [bookingId, entry.kind, entry.amountMinor],
      );
    }
    return entries;
  }

  async entriesForBooking(bookingId: string): Promise<LedgerEntry[]> {
    const result = await this.pool.query<{
      kind: 'gross' | 'commission' | 'net';
      amount_minor: number;
    }>('SELECT kind, amount_minor FROM payments.ledger WHERE booking_id = $1 ORDER BY created_at', [
      bookingId,
    ]);
    return result.rows.map((row) => ({ kind: row.kind, amountMinor: row.amount_minor }));
  }

  /** PAY-004: every ledger row across a provider's bookings, grouped by booking. */
  async entriesByBooking(bookingIds: string[]): Promise<Map<string, LedgerEntry[]>> {
    const byBooking = new Map<string, LedgerEntry[]>();
    if (bookingIds.length === 0) {
      return byBooking;
    }
    const result = await this.pool.query<{
      booking_id: string;
      kind: 'gross' | 'commission' | 'net';
      amount_minor: number;
    }>(
      `SELECT booking_id, kind, amount_minor FROM payments.ledger
       WHERE booking_id = ANY($1::uuid[]) ORDER BY booking_id, created_at`,
      [bookingIds],
    );
    for (const row of result.rows) {
      const entries = byBooking.get(row.booking_id) ?? [];
      entries.push({ kind: row.kind, amountMinor: row.amount_minor });
      byBooking.set(row.booking_id, entries);
    }
    return byBooking;
  }

  /** PAY-004: pending balance (net entries not yet paid out) for a provider account. */
  async pendingBalance(providerAccountId: string, bookingIdsForAccount: string[]): Promise<number> {
    if (bookingIdsForAccount.length === 0) {
      return 0;
    }
    const result = await this.pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount_minor), 0)::text AS total
       FROM payments.ledger
       WHERE kind = 'net' AND booking_id = ANY($1::uuid[])`,
      [bookingIdsForAccount],
    );
    const gross = Number(result.rows[0]?.total ?? 0);
    const paidOut = await this.pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount_minor), 0)::text AS total
       FROM payments.payouts
       WHERE provider_account_id = $1 AND status = 'succeeded'`,
      [providerAccountId],
    );
    return gross - Number(paidOut.rows[0]?.total ?? 0);
  }

  /**
   * OPS-005: triggers a manual payout for a provider's current pending
   * balance. `payments.payouts` has existed unused since M4 — this is its
   * first writer. Stubbed the same way ConnectService's onboarding is (no
   * real Stripe Connect account creation exists yet to transfer to): the
   * payout row is recorded and marked succeeded immediately rather than
   * calling a real transfer API. Idempotent against a double-click via a
   * client-supplied key (same pattern as booking creation's
   * `Idempotency-Key` header) rather than a time window — a repeat call
   * with the same key returns the original payout row unchanged instead of
   * computing a fresh balance and creating a second one.
   */
  async triggerPayout(
    key: string,
    providerAccountId: string,
    bookingIdsForAccount: string[],
  ): Promise<Payout> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{
        id: string;
        provider_account_id: string;
        amount_minor: number;
        status: 'pending' | 'succeeded' | 'failed';
        triggered_by: 'admin' | 'schedule';
        created_at: Date;
      }>(`SELECT * FROM payments.payouts WHERE idempotency_key = $1`, [key]);
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return toPayout(existing.rows[0]);
      }

      const netResult = await client.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(amount_minor), 0)::text AS total
         FROM payments.ledger
         WHERE kind = 'net' AND booking_id = ANY($1::uuid[])`,
        [bookingIdsForAccount],
      );
      const gross = Number(netResult.rows[0]?.total ?? 0);
      const paidOutResult = await client.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(amount_minor), 0)::text AS total
         FROM payments.payouts
         WHERE provider_account_id = $1 AND status = 'succeeded'`,
        [providerAccountId],
      );
      const pendingMinor = gross - Number(paidOutResult.rows[0]?.total ?? 0);
      if (pendingMinor <= 0) {
        throw new ConflictError('errors.payments.noPendingBalance');
      }

      const inserted = await client.query<{
        id: string;
        provider_account_id: string;
        amount_minor: number;
        status: 'pending' | 'succeeded' | 'failed';
        triggered_by: 'admin' | 'schedule';
        created_at: Date;
      }>(
        `INSERT INTO payments.payouts (idempotency_key, provider_account_id, amount_minor, status, triggered_by)
         VALUES ($1, $2, $3, 'succeeded', 'admin')
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING *`,
        [key, providerAccountId, pendingMinor],
      );
      if (inserted.rows[0]) {
        await client.query('COMMIT');
        return toPayout(inserted.rows[0]);
      }
      // Lost the insert race to a concurrent call with the same key — its
      // row is now committed (or about to be); re-select rather than
      // treating this as a failure.
      const raced = await client.query<{
        id: string;
        provider_account_id: string;
        amount_minor: number;
        status: 'pending' | 'succeeded' | 'failed';
        triggered_by: 'admin' | 'schedule';
        created_at: Date;
      }>(`SELECT * FROM payments.payouts WHERE idempotency_key = $1`, [key]);
      await client.query('COMMIT');
      return toPayout(raced.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async paidOutBalance(providerAccountId: string): Promise<number> {
    const result = await this.pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount_minor), 0)::text AS total
       FROM payments.payouts
       WHERE provider_account_id = $1 AND status = 'succeeded'`,
      [providerAccountId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }
}
