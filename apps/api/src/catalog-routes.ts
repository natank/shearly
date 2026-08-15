import { Hono } from 'hono';
import type { AppConfig } from '@shearly/shared-config';
import type { IdentityService } from '@shearly/services-identity';
import type { CatalogService, DocKind } from '@shearly/services-provider-catalog';
import { ValidationError } from '@shearly/shared-errors';
import { requireAdmin, requireProvider } from './session.js';

const kinds = new Set<DocKind>(['government_id', 'credential', 'portfolio']);

export function createCatalogRoutes(
  identity: IdentityService,
  catalog: CatalogService,
  config: AppConfig,
) {
  const routes = new Hono();

  routes.get('/catalog/me/application', async (c) => {
    const account = await requireProvider(c, identity, config);
    const application = await catalog.application(account.id);
    return c.json({
      status: application.provider.status,
      listed: application.provider.listed,
      missing: application.missing,
      documents: application.documents,
    });
  });

  routes.post('/catalog/me/documents', async (c) => {
    const account = await requireProvider(c, identity, config);
    const body = await c.req.parseBody();
    const kind = String(body.kind ?? '');
    const file = body.file;
    if (!kinds.has(kind as DocKind) || !(file instanceof File)) {
      throw new ValidationError('errors.validation');
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const meta = await catalog.addDocument(account.id, {
      kind: kind as DocKind,
      originalName: file.name,
      contentType: file.type || 'application/octet-stream',
      bytes,
    });
    return c.json({ document: meta });
  });

  routes.post('/catalog/me/submit', async (c) => {
    const account = await requireProvider(c, identity, config);
    const provider = await catalog.submit(account.id);
    return c.json({ status: provider.status });
  });

  routes.get('/admin/vetting', async (c) => {
    await requireAdmin(c, identity, config);
    return c.json({ queue: await catalog.listQueue() });
  });

  routes.get('/admin/vetting/:providerId', async (c) => {
    await requireAdmin(c, identity, config);
    const provider = await catalog.getById(c.req.param('providerId'));
    if (!provider) {
      return c.json({ error: 'NOT_FOUND', translationKey: 'catalog.providerNotFound' }, 404);
    }
    const application = await catalog.application(provider.account_id);
    return c.json({
      provider,
      documents: application.documents,
      missing: application.missing,
    });
  });

  routes.get('/admin/vetting/:providerId/documents/:docId', async (c) => {
    const admin = await requireAdmin(c, identity, config);
    const file = await catalog.readDocument(
      admin.id,
      c.req.param('providerId'),
      c.req.param('docId'),
    );
    return new Response(file.bytes, {
      headers: {
        'content-type': file.contentType,
        'content-disposition': `inline; filename="${file.originalName}"`,
      },
    });
  });

  routes.post('/admin/vetting/:providerId/decision', async (c) => {
    const admin = await requireAdmin(c, identity, config);
    const body = (await c.req.json().catch(() => null)) as {
      action?: 'interview' | 'approve' | 'reject' | 'request_more';
      rationale?: string;
    } | null;
    if (!body?.action) {
      throw new ValidationError('errors.validation');
    }
    const provider = await catalog.decide(
      admin.id,
      c.req.param('providerId'),
      body.action,
      body.rationale,
    );
    return c.json({ status: provider.status });
  });

  return routes;
}
