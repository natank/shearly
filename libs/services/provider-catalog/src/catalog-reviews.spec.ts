import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { CatalogService } from './catalog-service.js';
import { FsDocumentStore } from './document-store.js';
import { migrateCatalog } from './migrate.js';

const url = process.env.DATABASE_URL;

describe('CatalogService addReview (RAT-001)', () => {
  const pool = url ? new pg.Pool({ connectionString: url }) : null;
  let catalog: CatalogService | null = null;
  let dir = '';

  beforeAll(async () => {
    if (!url || !pool) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P7)');
      }
      return;
    }
    await migrateCatalog(url);
    dir = await mkdtemp(join(tmpdir(), 'shearly-review-'));
    catalog = new CatalogService(pool, new FsDocumentStore(dir));
  });

  afterAll(async () => {
    await pool?.end();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function seedApprovedProvider(): Promise<string> {
    return (await seedApprovedProviderWithAccount()).providerId;
  }

  async function seedApprovedProviderWithAccount(): Promise<{
    accountId: string;
    providerId: string;
  }> {
    if (!catalog || !pool) {
      throw new Error('catalog not ready');
    }
    const accountId = crypto.randomUUID();
    const provider = await catalog.ensureDraft(accountId);
    await pool.query(
      `UPDATE catalog.providers SET status = 'approved', listed = true WHERE id = $1`,
      [provider.id],
    );
    return { accountId, providerId: provider.id };
  }

  it('ties a review to a booking_id and updates the stored aggregate', async () => {
    if (!catalog) {
      return;
    }
    const providerId = await seedApprovedProvider();
    const bookingId = crypto.randomUUID();

    const review = await catalog.addReview(providerId, {
      rating: 5,
      body: 'great',
      bookingId,
    });
    expect(review.rating).toBe(5);

    const provider = await catalog.getById(providerId);
    expect(provider?.rating_count).toBe(1);
    expect(provider?.rating_sum).toBe(5);
  });

  it('rejects a second review for the same booking_id (ConflictError)', async () => {
    if (!catalog) {
      return;
    }
    const providerId = await seedApprovedProvider();
    const bookingId = crypto.randomUUID();

    await catalog.addReview(providerId, { rating: 4, bookingId });
    await expect(catalog.addReview(providerId, { rating: 2, bookingId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    // The aggregate reflects only the first, accepted review.
    const provider = await catalog.getById(providerId);
    expect(provider?.rating_count).toBe(1);
  });

  it('allows reviews without a booking_id (M3 seed/display rows, M3-Q5)', async () => {
    if (!catalog) {
      return;
    }
    const providerId = await seedApprovedProvider();

    await catalog.addReview(providerId, { rating: 3 });
    await catalog.addReview(providerId, { rating: 4 });

    const provider = await catalog.getById(providerId);
    expect(provider?.rating_count).toBe(2);
  });

  it('rejects an out-of-range rating', async () => {
    if (!catalog) {
      return;
    }
    const providerId = await seedApprovedProvider();
    await expect(catalog.addReview(providerId, { rating: 6 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});

describe('CatalogService replyToReview / listOwnReviews (RAT-003)', () => {
  const pool = url ? new pg.Pool({ connectionString: url }) : null;
  let catalog: CatalogService | null = null;
  let dir = '';

  beforeAll(async () => {
    if (!url || !pool) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    await migrateCatalog(url);
    dir = await mkdtemp(join(tmpdir(), 'shearly-review-reply-'));
    catalog = new CatalogService(pool, new FsDocumentStore(dir));
  });

  afterAll(async () => {
    await pool?.end();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function seedApprovedProviderWithAccount(): Promise<{
    accountId: string;
    providerId: string;
  }> {
    if (!catalog || !pool) {
      throw new Error('catalog not ready');
    }
    const accountId = crypto.randomUUID();
    const provider = await catalog.ensureDraft(accountId);
    await pool.query(
      `UPDATE catalog.providers SET status = 'approved', listed = true WHERE id = $1`,
      [provider.id],
    );
    return { accountId, providerId: provider.id };
  }

  it('the owning provider can reply once, and the reply is visible via listOwnReviews and listReviews', async () => {
    if (!catalog) {
      return;
    }
    const { accountId, providerId } = await seedApprovedProviderWithAccount();
    const review = await catalog.addReview(providerId, { rating: 5, body: 'great cut' });

    await catalog.replyToReview(accountId, review.id, 'Thank you!');

    const own = await catalog.listOwnReviews(accountId);
    expect(own.find((row) => row.id === review.id)).toMatchObject({
      reply: 'Thank you!',
    });
    expect(own.find((row) => row.id === review.id)?.reply_created_at).toBeTruthy();

    const publicList = await catalog.listReviews(providerId);
    expect(publicList.find((row) => row.id === review.id)).toMatchObject({
      reply: 'Thank you!',
    });
  });

  it('rejects a reply from a provider who does not own the review', async () => {
    if (!catalog) {
      return;
    }
    const { providerId } = await seedApprovedProviderWithAccount();
    const { accountId: otherAccountId } = await seedApprovedProviderWithAccount();
    const review = await catalog.addReview(providerId, { rating: 4 });

    await expect(
      catalog.replyToReview(otherAccountId, review.id, 'not mine to reply to'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an empty reply', async () => {
    if (!catalog) {
      return;
    }
    const { accountId, providerId } = await seedApprovedProviderWithAccount();
    const review = await catalog.addReview(providerId, { rating: 4 });

    await expect(catalog.replyToReview(accountId, review.id, '   ')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('listOwnReviews works for a provider that is not (or no longer) listed — unlike the public listReviews', async () => {
    if (!catalog || !pool) {
      return;
    }
    const { accountId, providerId } = await seedApprovedProviderWithAccount();
    await catalog.addReview(providerId, { rating: 3 });
    await pool.query(`UPDATE catalog.providers SET listed = false WHERE id = $1`, [providerId]);

    await expect(catalog.listOwnReviews(accountId)).resolves.toHaveLength(1);
    await expect(catalog.listReviews(providerId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
