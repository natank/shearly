import pg from 'pg';
import { insertOutboxEvent } from '@shearly/shared-events';

export type ConnectStatus = 'not_started' | 'pending' | 'complete';

export class ConnectService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly payoutCadenceDays = 7,
  ) {}

  async getStatus(
    accountId: string,
  ): Promise<{ status: ConnectStatus; stripeAccountId: string | null }> {
    const result = await this.pool.query<{
      status: ConnectStatus;
      stripe_account_id: string | null;
    }>(`SELECT status, stripe_account_id FROM payments.connect_accounts WHERE account_id = $1`, [
      accountId,
    ]);
    const row = result.rows[0];
    return {
      status: row?.status ?? 'not_started',
      stripeAccountId: row?.stripe_account_id ?? null,
    };
  }

  async startOnboarding(
    accountId: string,
    stripeSecretKey: string,
  ): Promise<{ url: string | null; stub: boolean }> {
    await this.pool.query(
      `INSERT INTO payments.connect_accounts (account_id, status)
       VALUES ($1, 'pending')
       ON CONFLICT (account_id) DO UPDATE SET status = 'pending', updated_at = now()`,
      [accountId],
    );
    if (!stripeSecretKey) {
      return { url: null, stub: true };
    }
    return { url: 'https://connect.stripe.com/setup/e/stub', stub: false };
  }

  async completeStub(accountId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // PAY-006: onboarding completion is the earliest point a scheduled
      // payout is ever possible, so the cadence clock starts here.
      await client.query(
        `INSERT INTO payments.connect_accounts (account_id, status, next_payout_at)
         VALUES ($1, 'complete', now() + make_interval(days => $2))
         ON CONFLICT (account_id) DO UPDATE
           SET status = 'complete',
               updated_at = now(),
               next_payout_at = COALESCE(
                 payments.connect_accounts.next_payout_at,
                 now() + make_interval(days => $2)
               )`,
        [accountId, this.payoutCadenceDays],
      );
      await insertOutboxEvent(client, 'payments', 'PayoutAccountReady', { accountId });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async isComplete(accountId: string): Promise<boolean> {
    const { status } = await this.getStatus(accountId);
    return status === 'complete';
  }
}
