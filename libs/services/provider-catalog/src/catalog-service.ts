import pg from 'pg';

export type ProviderStatus =
  'draft' | 'pending_review' | 'interview_scheduled' | 'approved' | 'rejected';

export type ProviderRow = {
  id: string;
  account_id: string;
  status: ProviderStatus;
  listed: boolean;
};

export class CatalogService {
  constructor(private readonly pool: pg.Pool) {}

  async ensureDraft(accountId: string): Promise<ProviderRow> {
    const existing = await this.pool.query<ProviderRow>(
      `SELECT id, account_id, status, listed FROM catalog.providers WHERE account_id = $1`,
      [accountId],
    );
    if (existing.rows[0]) {
      return existing.rows[0];
    }
    const inserted = await this.pool.query<ProviderRow>(
      `INSERT INTO catalog.providers (account_id, status)
       VALUES ($1, 'draft')
       ON CONFLICT (account_id) DO UPDATE SET account_id = catalog.providers.account_id
       RETURNING id, account_id, status, listed`,
      [accountId],
    );
    return inserted.rows[0];
  }

  async getByAccount(accountId: string): Promise<ProviderRow | null> {
    const result = await this.pool.query<ProviderRow>(
      `SELECT id, account_id, status, listed FROM catalog.providers WHERE account_id = $1`,
      [accountId],
    );
    return result.rows[0] ?? null;
  }
}
