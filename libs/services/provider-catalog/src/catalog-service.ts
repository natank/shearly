import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@shearly/shared-errors';
import { splitPrice } from '@shearly/domain-pricing';
import { insertOutboxEvent } from '@shearly/shared-events';
import type { DocumentStore } from './document-store.js';

export type CatalogMail = {
  to: string;
  subject: string;
  text: string;
};

export type SendMail = (mail: CatalogMail) => Promise<void>;

export type ProviderStatus =
  'draft' | 'pending_review' | 'interview_scheduled' | 'approved' | 'rejected';

export type DocKind = 'government_id' | 'credential' | 'portfolio';

export type ProviderRow = {
  id: string;
  account_id: string;
  status: ProviderStatus;
  listed: boolean;
  bio: string | null;
  display_name: string | null;
  base_lat: number | null;
  base_lng: number | null;
  radius_km: number | null;
  rating_sum: number;
  rating_count: number;
  completion_count: number;
};

export type ListedProvider = ProviderRow & { distance_km: number };

export type DocumentMeta = {
  id: string;
  kind: DocKind;
  original_name: string;
  content_type: string;
};

const PROVIDER_COLS = `id, account_id, status, listed, bio, display_name, base_lat, base_lng, radius_km, rating_sum, rating_count, completion_count`;

export type ServiceRow = {
  id: string;
  provider_id: string;
  name: string;
  description: string;
  duration_minutes: number;
  price_minor: number;
};

export class CatalogService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly store: DocumentStore,
    private readonly radiusCapKm = 15,
    private readonly commissionRate = 0.2,
    private readonly sendMail: SendMail = async () => undefined,
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

  async requirePublic(providerId: string): Promise<ProviderRow> {
    const provider = await this.getById(providerId);
    if (!provider || !provider.listed || provider.status !== 'approved') {
      throw new NotFoundError('catalog.providerNotFound');
    }
    return provider;
  }

  async addReview(
    providerId: string,
    input: { rating: number; body?: string; bookingId?: string },
  ): Promise<{ id: string; rating: number; body: string | null; created_at: Date }> {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new ValidationError('errors.validation');
    }
    await this.requirePublic(providerId);
    const client = await this.pool.connect();
    let inserted;
    try {
      await client.query('BEGIN');
      inserted = await client.query<{
        id: string;
        rating: number;
        body: string | null;
        created_at: Date;
      }>(
        `INSERT INTO catalog.reviews (provider_id, rating, body, booking_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, rating, body, created_at`,
        [providerId, input.rating, input.body ?? null, input.bookingId ?? null],
      );
      await client.query(
        `UPDATE catalog.providers SET
           rating_sum = rating_sum + $2,
           rating_count = rating_count + 1,
           updated_at = now()
         WHERE id = $1`,
        [providerId, input.rating],
      );
      await insertOutboxEvent(client, 'catalog', 'ReviewSubmitted', {
        reviewId: inserted.rows[0].id,
        bookingId: input.bookingId ?? '',
        providerId,
        rating: input.rating,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        throw new ConflictError('rating.alreadyReviewed');
      }
      throw error;
    } finally {
      client.release();
    }
    return inserted.rows[0];
  }

  async listReviews(providerId: string) {
    await this.requirePublic(providerId);
    const result = await this.pool.query<{
      id: string;
      rating: number;
      body: string | null;
      created_at: Date;
    }>(
      `SELECT id, rating, body, created_at FROM catalog.reviews
       WHERE provider_id = $1 ORDER BY created_at DESC`,
      [providerId],
    );
    return result.rows;
  }

  async readPublicPortfolio(providerId: string, documentId: string) {
    await this.requirePublic(providerId);
    const doc = await this.pool.query<{
      id: string;
      kind: DocKind;
      original_name: string;
      content_type: string;
      storage_key: string;
    }>(
      `SELECT id, kind, original_name, content_type, storage_key
       FROM catalog.vetting_documents
       WHERE id = $1 AND provider_id = $2 AND kind = 'portfolio'`,
      [documentId, providerId],
    );
    const row = doc.rows[0];
    if (!row) {
      throw new NotFoundError('catalog.documentNotFound');
    }
    const bytes = await this.store.get(row.storage_key);
    return { bytes, contentType: row.content_type, originalName: row.original_name };
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

  async submit(
    accountId: string,
    notify?: { providerEmail: string; adminEmail: string },
  ): Promise<ProviderRow> {
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
    if (notify) {
      await this.sendMail({
        to: notify.providerEmail,
        subject: 'Shearly: your vetting packet was submitted',
        text: 'Your packet is now pending review. We will email you with a decision.',
      });
      await this.sendMail({
        to: notify.adminEmail,
        subject: 'Shearly: a provider packet needs review',
        text: `Provider ${provider.id} submitted a vetting packet and is now pending review.`,
      });
    }
    return updated.rows[0];
  }

  async listQueue(): Promise<ProviderRow[]> {
    const result = await this.pool.query<ProviderRow>(
      `SELECT ${PROVIDER_COLS} FROM catalog.providers
       WHERE status IN ('pending_review', 'interview_scheduled')
       ORDER BY created_at ASC`,
    );
    return result.rows;
  }

  /** OPS-004: every approved provider (listed or already suspended/delisted) — the standing view's population. */
  async listApproved(): Promise<ProviderRow[]> {
    const result = await this.pool.query<ProviderRow>(
      `SELECT ${PROVIDER_COLS} FROM catalog.providers
       WHERE status = 'approved'
       ORDER BY created_at ASC`,
    );
    return result.rows;
  }

  async decide(
    actorAccountId: string,
    providerId: string,
    action: 'interview' | 'approve' | 'reject' | 'request_more',
    rationale?: string,
    notify?: { providerEmail: string },
  ): Promise<ProviderRow> {
    const provider = await this.getById(providerId);
    if (!provider) {
      throw new NotFoundError('catalog.providerNotFound');
    }
    const next = nextStatus(provider.status, action);
    const client = await this.pool.connect();
    let updated;
    try {
      await client.query('BEGIN');
      updated = await client.query<ProviderRow>(
        `UPDATE catalog.providers
         SET status = $2, decision_rationale = $3, decided_by = $4, decided_at = now(), updated_at = now()
         WHERE id = $1
         RETURNING ${PROVIDER_COLS}`,
        [providerId, next, rationale ?? null, actorAccountId],
      );
      if (action === 'approve') {
        await insertOutboxEvent(client, 'catalog', 'ProviderApproved', {
          providerId,
          accountId: updated.rows[0].account_id,
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (notify) {
      await this.sendMail({
        to: notify.providerEmail,
        subject: 'Shearly: your vetting decision is ready',
        text: `Your vetting status is now "${next}"${rationale ? `. Note: ${rationale}` : '.'}`,
      });
    }
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

  async updateProfile(
    accountId: string,
    input: {
      bio?: string;
      displayName?: string;
      baseLat?: number;
      baseLng?: number;
      radiusKm?: number;
    },
  ): Promise<ProviderRow> {
    const provider = await this.requireOwn(accountId);
    if (input.radiusKm !== undefined && input.radiusKm > this.radiusCapKm) {
      throw new ValidationError('catalog.radiusCap');
    }
    const updated = await this.pool.query<ProviderRow>(
      `UPDATE catalog.providers SET
         bio = COALESCE($2, bio),
         display_name = COALESCE($3, display_name),
         base_lat = COALESCE($4, base_lat),
         base_lng = COALESCE($5, base_lng),
         radius_km = COALESCE($6, radius_km),
         location = CASE
           WHEN $4 IS NOT NULL AND $5 IS NOT NULL
             THEN ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography
           ELSE location
         END,
         updated_at = now()
       WHERE id = $1
       RETURNING ${PROVIDER_COLS}`,
      [
        provider.id,
        input.bio ?? null,
        input.displayName ?? null,
        input.baseLat ?? null,
        input.baseLng ?? null,
        input.radiusKm ?? null,
      ],
    );
    return updated.rows[0];
  }

  async listInRadius(input: { lat: number; lng: number }): Promise<ListedProvider[]> {
    const result = await this.pool.query<ListedProvider>(
      `SELECT ${PROVIDER_COLS},
              ST_Distance(
                location,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
              ) / 1000 AS distance_km
       FROM catalog.providers
       WHERE listed = true
         AND status = 'approved'
         AND location IS NOT NULL
         AND radius_km IS NOT NULL
         AND ST_DWithin(
           location,
           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
           radius_km * 1000
         )
       ORDER BY distance_km ASC, id ASC`,
      [input.lat, input.lng],
    );
    return result.rows.map((row) => ({ ...row, distance_km: Number(row.distance_km) }));
  }

  async addService(
    accountId: string,
    input: { name: string; description: string; durationMinutes: number; priceMinor: number },
  ): Promise<ServiceRow> {
    const provider = await this.requireOwn(accountId);
    if (input.durationMinutes <= 0 || input.priceMinor < 0 || !input.name.trim()) {
      throw new ValidationError('errors.validation');
    }
    const inserted = await this.pool.query<ServiceRow>(
      `INSERT INTO catalog.services (provider_id, name, description, duration_minutes, price_minor)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, provider_id, name, description, duration_minutes, price_minor`,
      [provider.id, input.name.trim(), input.description, input.durationMinutes, input.priceMinor],
    );
    return inserted.rows[0];
  }

  async listServices(accountId: string): Promise<ServiceRow[]> {
    const provider = await this.requireOwn(accountId);
    return this.listServicesForProvider(provider.id);
  }

  async listServicesForProvider(providerId: string): Promise<ServiceRow[]> {
    const result = await this.pool.query<ServiceRow>(
      `SELECT id, provider_id, name, description, duration_minutes, price_minor
       FROM catalog.services WHERE provider_id = $1 ORDER BY created_at ASC`,
      [providerId],
    );
    return result.rows;
  }

  async getServiceById(serviceId: string): Promise<ServiceRow | null> {
    const result = await this.pool.query<ServiceRow>(
      `SELECT id, provider_id, name, description, duration_minutes, price_minor
       FROM catalog.services WHERE id = $1`,
      [serviceId],
    );
    return result.rows[0] ?? null;
  }

  async listPortfolioMeta(providerId: string): Promise<DocumentMeta[]> {
    const result = await this.pool.query<DocumentMeta>(
      `SELECT id, kind, original_name, content_type FROM catalog.vetting_documents
       WHERE provider_id = $1 AND kind = 'portfolio' ORDER BY created_at ASC`,
      [providerId],
    );
    return result.rows;
  }

  async quoteService(accountId: string, serviceId: string) {
    const provider = await this.requireOwn(accountId);
    const result = await this.pool.query<ServiceRow>(
      `SELECT id, provider_id, name, description, duration_minutes, price_minor
       FROM catalog.services WHERE id = $1 AND provider_id = $2`,
      [serviceId, provider.id],
    );
    const service = result.rows[0];
    if (!service) {
      throw new NotFoundError('catalog.serviceNotFound');
    }
    return splitPrice(service.price_minor, this.commissionRate);
  }

  async setListed(accountId: string, listed: boolean): Promise<ProviderRow> {
    const provider = await this.requireOwn(accountId);
    const updated = await this.pool.query<ProviderRow>(
      `UPDATE catalog.providers SET listed = $2, updated_at = now() WHERE id = $1
       RETURNING ${PROVIDER_COLS}`,
      [provider.id, listed],
    );
    return updated.rows[0];
  }

  /**
   * OPS-004: admin suspend/delist (listed = false) or re-list (listed =
   * true), addressed by provider id rather than the acting account's own
   * — setListed() above is provider self-service and enforces ownership,
   * which an admin acting on someone else's listing must not be gated by.
   * Route-level requireAdmin() is what authorizes this, not this method.
   */
  async adminSetListed(providerId: string, listed: boolean): Promise<ProviderRow> {
    const updated = await this.pool.query<ProviderRow>(
      `UPDATE catalog.providers SET listed = $2, updated_at = now() WHERE id = $1
       RETURNING ${PROVIDER_COLS}`,
      [providerId, listed],
    );
    if (!updated.rows[0]) {
      throw new NotFoundError('catalog.providerNotFound');
    }
    return updated.rows[0];
  }

  async serviceCount(accountId: string): Promise<number> {
    const provider = await this.getByAccount(accountId);
    if (!provider) {
      return 0;
    }
    const result = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM catalog.services WHERE provider_id = $1`,
      [provider.id],
    );
    return Number(result.rows[0]?.n ?? 0);
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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
