import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { AuthorizationError, NotFoundError, ValidationError } from '@shearly/shared-errors';
import type { DocumentStore } from './document-store.js';

export type ProviderStatus =
  'draft' | 'pending_review' | 'interview_scheduled' | 'approved' | 'rejected';

export type DocKind = 'government_id' | 'credential' | 'portfolio';

export type ProviderRow = {
  id: string;
  account_id: string;
  status: ProviderStatus;
  listed: boolean;
  bio: string | null;
  base_lat: number | null;
  base_lng: number | null;
  radius_km: number | null;
};

export type DocumentMeta = {
  id: string;
  kind: DocKind;
  original_name: string;
  content_type: string;
};

const PROVIDER_COLS = `id, account_id, status, listed, bio, base_lat, base_lng, radius_km`;

export class CatalogService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly store: DocumentStore,
  ) {}

  async ensureDraft(accountId: string): Promise<ProviderRow> {
    const existing = await this.getByAccount(accountId);
    if (existing) {
      return existing;
    }
    const inserted = await this.pool.query<ProviderRow>(
      `INSERT INTO catalog.providers (account_id, status)
       VALUES ($1, 'draft')
       ON CONFLICT (account_id) DO UPDATE SET account_id = catalog.providers.account_id
       RETURNING ${PROVIDER_COLS}`,
      [accountId],
    );
    return inserted.rows[0];
  }

  async getByAccount(accountId: string): Promise<ProviderRow | null> {
    const result = await this.pool.query<ProviderRow>(
      `SELECT ${PROVIDER_COLS} FROM catalog.providers WHERE account_id = $1`,
      [accountId],
    );
    return result.rows[0] ?? null;
  }

  async getById(providerId: string): Promise<ProviderRow | null> {
    const result = await this.pool.query<ProviderRow>(
      `SELECT ${PROVIDER_COLS} FROM catalog.providers WHERE id = $1`,
      [providerId],
    );
    return result.rows[0] ?? null;
  }

  async addDocument(
    accountId: string,
    input: { kind: DocKind; originalName: string; contentType: string; bytes: Buffer },
  ): Promise<DocumentMeta> {
    const provider = await this.requireOwn(accountId);
    const storageKey = `${provider.id}/${randomUUID()}`;
    const checksum = createHash('sha256').update(input.bytes).digest('hex');
    await this.store.put(storageKey, input.bytes);
    const inserted = await this.pool.query<DocumentMeta>(
      `INSERT INTO catalog.vetting_documents
         (provider_id, kind, original_name, content_type, checksum, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, kind, original_name, content_type`,
      [provider.id, input.kind, input.originalName, input.contentType, checksum, storageKey],
    );
    return inserted.rows[0];
  }

  async application(accountId: string) {
    const provider = await this.requireOwn(accountId);
    const docs = await this.listDocs(provider.id);
    return { provider, documents: docs, missing: missingItems(docs) };
  }

  async submit(accountId: string): Promise<ProviderRow> {
    const provider = await this.requireOwn(accountId);
    if (provider.status !== 'draft' && provider.status !== 'rejected') {
      throw new ValidationError('catalog.submitNotAllowed');
    }
    const docs = await this.listDocs(provider.id);
    const missing = missingItems(docs);
    if (missing.length) {
      throw new ValidationError(`catalog.missing:${missing.join(',')}`);
    }
    const updated = await this.pool.query<ProviderRow>(
      `UPDATE catalog.providers SET status = 'pending_review', updated_at = now()
       WHERE id = $1 RETURNING ${PROVIDER_COLS}`,
      [provider.id],
    );
    return updated.rows[0];
  }

  async listQueue(): Promise<ProviderRow[]> {
    const result = await this.pool.query<ProviderRow>(
      `SELECT ${PROVIDER_COLS} FROM catalog.providers
       WHERE status = 'pending_review'
       ORDER BY created_at ASC`,
    );
    return result.rows;
  }

  async decide(
    actorAccountId: string,
    providerId: string,
    action: 'interview' | 'approve' | 'reject' | 'request_more',
    rationale?: string,
  ): Promise<ProviderRow> {
    const provider = await this.getById(providerId);
    if (!provider) {
      throw new NotFoundError('catalog.providerNotFound');
    }
    const next = nextStatus(provider.status, action);
    const updated = await this.pool.query<ProviderRow>(
      `UPDATE catalog.providers
       SET status = $2, decision_rationale = $3, decided_by = $4, decided_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING ${PROVIDER_COLS}`,
      [providerId, next, rationale ?? null, actorAccountId],
    );
    return updated.rows[0];
  }

  async readDocument(actorAccountId: string, providerId: string, documentId: string) {
    const doc = await this.pool.query<{
      id: string;
      kind: DocKind;
      original_name: string;
      content_type: string;
      storage_key: string;
    }>(
      `SELECT id, kind, original_name, content_type, storage_key
       FROM catalog.vetting_documents WHERE id = $1 AND provider_id = $2`,
      [documentId, providerId],
    );
    const row = doc.rows[0];
    if (!row) {
      throw new NotFoundError('catalog.documentNotFound');
    }
    await this.pool.query(
      `INSERT INTO catalog.document_access_log (document_id, actor_account_id) VALUES ($1, $2)`,
      [documentId, actorAccountId],
    );
    const bytes = await this.store.get(row.storage_key);
    return { bytes, contentType: row.content_type, originalName: row.original_name };
  }

  async accessLogCount(documentId: string): Promise<number> {
    const result = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM catalog.document_access_log WHERE document_id = $1`,
      [documentId],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  private async listDocs(providerId: string): Promise<DocumentMeta[]> {
    const result = await this.pool.query<DocumentMeta>(
      `SELECT id, kind, original_name, content_type FROM catalog.vetting_documents
       WHERE provider_id = $1 ORDER BY created_at ASC`,
      [providerId],
    );
    return result.rows;
  }

  private async requireOwn(accountId: string): Promise<ProviderRow> {
    const provider = await this.ensureDraft(accountId);
    if (provider.account_id !== accountId) {
      throw new AuthorizationError();
    }
    return provider;
  }
}

function missingItems(docs: DocumentMeta[]): string[] {
  const missing: string[] = [];
  if (!docs.some((doc) => doc.kind === 'government_id')) {
    missing.push('government_id');
  }
  if (!docs.some((doc) => doc.kind === 'credential')) {
    missing.push('credential');
  }
  if (docs.filter((doc) => doc.kind === 'portfolio').length < 5) {
    missing.push('portfolio');
  }
  return missing;
}

function nextStatus(
  current: ProviderStatus,
  action: 'interview' | 'approve' | 'reject' | 'request_more',
): ProviderStatus {
  if (action === 'interview' && current === 'pending_review') {
    return 'interview_scheduled';
  }
  if (action === 'approve' && current === 'interview_scheduled') {
    return 'approved';
  }
  if (action === 'reject' && (current === 'pending_review' || current === 'interview_scheduled')) {
    return 'rejected';
  }
  if (
    action === 'request_more' &&
    (current === 'pending_review' || current === 'interview_scheduled')
  ) {
    return 'draft';
  }
  throw new ValidationError('catalog.invalidDecision');
}
