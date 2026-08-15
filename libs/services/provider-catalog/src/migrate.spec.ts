import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { CatalogService } from './catalog-service.js';
import { FsDocumentStore } from './document-store.js';
import { PROVIDER_CATALOG_SERVICE_NAME } from './index.js';
import { migrateCatalog } from './migrate.js';

const url = process.env.DATABASE_URL;

describe('catalog migrate', () => {
  const pool = url ? new pg.Pool({ connectionString: url }) : null;

  afterAll(async () => {
    await pool?.end();
  });

  it('exports the service name', () => {
    expect(PROVIDER_CATALOG_SERVICE_NAME).toBe('provider-catalog');
  });

  it('applies the catalog schema and upserts a draft', async () => {
    if (!url || !pool) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M2-P1)');
      }
      return;
    }
    await migrateCatalog(url);
    await migrateCatalog(url);
    const catalog = new CatalogService(pool, new FsDocumentStore('/tmp/shearly-docs-test'));
    const accountId = crypto.randomUUID();
    const first = await catalog.ensureDraft(accountId);
    const second = await catalog.ensureDraft(accountId);
    expect(first.status).toBe('draft');
    expect(second.id).toBe(first.id);
  });
});
