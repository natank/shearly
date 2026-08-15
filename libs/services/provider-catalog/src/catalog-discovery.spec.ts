import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { CatalogService } from './catalog-service.js';
import { FsDocumentStore } from './document-store.js';
import { migrateCatalog } from './migrate.js';

const url = process.env.DATABASE_URL;
const telAviv = { lat: 32.0853, lng: 34.7818 };
const jerusalem = { lat: 31.7683, lng: 35.2137 };

describe('CatalogService listInRadius', () => {
  const pool = url ? new pg.Pool({ connectionString: url }) : null;
  let catalog: CatalogService | null = null;
  let dir = '';

  beforeAll(async () => {
    if (!url || !pool) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M3-P1)');
      }
      return;
    }
    await migrateCatalog(url);
    dir = await mkdtemp(join(tmpdir(), 'shearly-disc-'));
    catalog = new CatalogService(pool, new FsDocumentStore(dir));
  });

  afterAll(async () => {
    await pool?.end();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function seed(input: {
    listed: boolean;
    status: 'draft' | 'approved';
    lat?: number;
    lng?: number;
    radiusKm?: number;
  }) {
    if (!catalog || !pool) {
      throw new Error('catalog not ready');
    }
    const accountId = crypto.randomUUID();
    const provider = await catalog.ensureDraft(accountId);
    if (input.lat !== undefined && input.lng !== undefined) {
      await catalog.updateProfile(accountId, {
        displayName: 'Cut',
        baseLat: input.lat,
        baseLng: input.lng,
        radiusKm: input.radiusKm ?? 10,
      });
    }
    await pool.query(`UPDATE catalog.providers SET status = $2, listed = $3 WHERE id = $1`, [
      provider.id,
      input.status,
      input.listed,
    ]);
    return provider.id;
  }

  it('returns only listed approved providers whose radius covers the point', async () => {
    if (!catalog) {
      return;
    }
    const inside = await seed({
      listed: true,
      status: 'approved',
      lat: telAviv.lat,
      lng: telAviv.lng,
      radiusKm: 10,
    });
    const unlisted = await seed({
      listed: false,
      status: 'approved',
      lat: telAviv.lat,
      lng: telAviv.lng,
    });
    const draft = await seed({
      listed: true,
      status: 'draft',
      lat: telAviv.lat,
      lng: telAviv.lng,
    });
    const far = await seed({
      listed: true,
      status: 'approved',
      lat: jerusalem.lat,
      lng: jerusalem.lng,
      radiusKm: 10,
    });
    const noPoint = await seed({ listed: true, status: 'approved' });

    const hits = await catalog.listInRadius(telAviv);
    const ids = hits.map((row) => row.id);
    expect(ids).toContain(inside);
    expect(ids).not.toContain(unlisted);
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(far);
    expect(ids).not.toContain(noPoint);
    const match = hits.find((row) => row.id === inside);
    expect(match?.distance_km).toBeLessThan(1);
    expect(match?.display_name).toBe('Cut');
  });
});
