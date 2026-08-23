import pg from 'pg';

export type LedgerEntry = { kind: 'gross' | 'commission' | 'net'; amountMinor: number };

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
