import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { CatalogService, type CatalogMail } from './catalog-service.js';
import { FsDocumentStore } from './document-store.js';
import { migrateCatalog } from './migrate.js';

const url = process.env.DATABASE_URL;

describe('CatalogService vetting', () => {
  const pool = url ? new pg.Pool({ connectionString: url }) : null;
  let catalog: CatalogService | null = null;
  let dir = '';

  beforeAll(async () => {
    if (!url || !pool) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M2-P2)');
      }
      return;
    }
    await migrateCatalog(url);
    dir = await mkdtemp(join(tmpdir(), 'shearly-cat-'));
    catalog = new CatalogService(pool, new FsDocumentStore(dir));
  });

  afterAll(async () => {
    await pool?.end();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lists missing items until the packet is complete, then submits', async () => {
    if (!catalog) {
      return;
    }
    const accountId = crypto.randomUUID();
    await catalog.ensureDraft(accountId);
    const incomplete = await catalog.application(accountId);
    expect(incomplete.missing).toEqual(['government_id', 'credential', 'portfolio']);
    await expect(catalog.submit(accountId)).rejects.toMatchObject({
      translationKey: 'catalog.missing:government_id,credential,portfolio',
    });

    await catalog.addDocument(accountId, {
      kind: 'government_id',
      originalName: 'id.png',
      contentType: 'image/png',
      bytes: Buffer.from('id'),
    });
    await catalog.addDocument(accountId, {
      kind: 'credential',
      originalName: 'cred.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('cred'),
    });
    for (let i = 0; i < 5; i += 1) {
      await catalog.addDocument(accountId, {
        kind: 'portfolio',
        originalName: `p${i}.jpg`,
        contentType: 'image/jpeg',
        bytes: Buffer.from(`p${i}`),
      });
    }
    const submitted = await catalog.submit(accountId);
    expect(submitted.status).toBe('pending_review');
    const queue = await catalog.listQueue();
    expect(queue.some((row) => row.account_id === accountId)).toBe(true);

    const admin = crypto.randomUUID();
    await expect(catalog.decide(admin, submitted.id, 'approve')).rejects.toMatchObject({
      translationKey: 'catalog.invalidDecision',
    });
    const interviewed = await catalog.decide(admin, submitted.id, 'interview');
    expect(interviewed.status).toBe('interview_scheduled');
    expect((await catalog.listQueue()).some((row) => row.id === interviewed.id)).toBe(true);
    const approved = await catalog.decide(admin, interviewed.id, 'approve', 'ok');
    expect((await catalog.listQueue()).some((row) => row.id === approved.id)).toBe(false);
    expect(approved.status).toBe('approved');

    const idDoc = (await catalog.application(accountId)).documents.find(
      (doc) => doc.kind === 'government_id',
    );
    expect(idDoc).toBeTruthy();
    const file = await catalog.readDocument(admin, approved.id, idDoc?.id ?? '');
    expect(file.bytes.toString()).toBe('id');
    expect(await catalog.accessLogCount(idDoc?.id ?? '')).toBe(1);
  });

  it('caps radius and quotes net earnings', async () => {
    if (!catalog) {
      return;
    }
    const accountId = crypto.randomUUID();
    await expect(catalog.updateProfile(accountId, { radiusKm: 16 })).rejects.toMatchObject({
      translationKey: 'catalog.radiusCap',
    });
    await catalog.updateProfile(accountId, {
      bio: 'cuts',
      baseLat: 32.08,
      baseLng: 34.78,
      radiusKm: 10,
    });
    const service = await catalog.addService(accountId, {
      name: 'Cut',
      description: '60 min',
      durationMinutes: 60,
      priceMinor: 20000,
    });
    expect(await catalog.quoteService(accountId, service.id)).toMatchObject({
      net: 16000,
      travelIncluded: true,
    });
  });
});

describe('CatalogService notifications (M2-T02 regression)', () => {
  const pool = url ? new pg.Pool({ connectionString: url }) : null;
  let catalog: CatalogService | null = null;
  let dir = '';
  const sent: CatalogMail[] = [];

  beforeAll(async () => {
    if (!url || !pool) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M2-P2)');
      }
      return;
    }
    await migrateCatalog(url);
    dir = await mkdtemp(join(tmpdir(), 'shearly-cat-mail-'));
    catalog = new CatalogService(pool, new FsDocumentStore(dir), 15, 0.2, async (mail) => {
      sent.push(mail);
    });
  });

  afterAll(async () => {
    await pool?.end();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('mails the provider and admin on submit, and the provider on decision', async () => {
    if (!catalog) {
      return;
    }
    sent.length = 0;
    const accountId = crypto.randomUUID();
    await catalog.addDocument(accountId, {
      kind: 'government_id',
      originalName: 'id.png',
      contentType: 'image/png',
      bytes: Buffer.from('id'),
    });
    await catalog.addDocument(accountId, {
      kind: 'credential',
      originalName: 'cred.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('cred'),
    });
    for (let i = 0; i < 5; i += 1) {
      await catalog.addDocument(accountId, {
        kind: 'portfolio',
        originalName: `p${i}.jpg`,
        contentType: 'image/jpeg',
        bytes: Buffer.from(`p${i}`),
      });
    }

    const submitted = await catalog.submit(accountId, {
      providerEmail: 'provider@example.com',
      adminEmail: 'admin@shearly.local',
    });
    expect(submitted.status).toBe('pending_review');
    expect(sent).toHaveLength(2);
    expect(sent.map((mail) => mail.to)).toEqual(
      expect.arrayContaining(['provider@example.com', 'admin@shearly.local']),
    );

    sent.length = 0;
    const admin = crypto.randomUUID();
    const interviewed = await catalog.decide(admin, submitted.id, 'interview', undefined, {
      providerEmail: 'provider@example.com',
    });
    expect(interviewed.status).toBe('interview_scheduled');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'provider@example.com' });

    sent.length = 0;
    await catalog.decide(admin, interviewed.id, 'approve', 'ok');
    expect(sent).toHaveLength(0);
  });

  it('does not send mail when submit fails validation', async () => {
    if (!catalog) {
      return;
    }
    sent.length = 0;
    const accountId = crypto.randomUUID();
    await expect(
      catalog.submit(accountId, {
        providerEmail: 'provider@example.com',
        adminEmail: 'admin@shearly.local',
      }),
    ).rejects.toMatchObject({
      translationKey: 'catalog.missing:government_id,credential,portfolio',
    });
    expect(sent).toHaveLength(0);
  });
});
