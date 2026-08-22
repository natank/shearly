import { Hono, type Context } from 'hono';
import type { AppConfig } from '@shearly/shared-config';
import type { IdentityService } from '@shearly/services-identity';
import type { CatalogService, DocKind } from '@shearly/services-provider-catalog';
import type { AvailabilityService } from '@shearly/services-availability';
import type { ConnectService } from '@shearly/services-payments';
import { NotFoundError, ValidationError } from '@shearly/shared-errors';
import { evaluateGoLive } from './go-live.js';
import { requireAdmin, requireProvider } from './session.js';

const kinds = new Set<DocKind>(['government_id', 'credential', 'portfolio']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value || !UUID_RE.test(value)) {
    throw new NotFoundError('catalog.providerNotFound');
  }
  return value;
}

export function createCatalogRoutes(
  identity: IdentityService,
  catalog: CatalogService,
  config: AppConfig,
  extras?: { availability: AvailabilityService; payments: ConnectService },
) {
  const routes = new Hono();

  routes.get('/catalog/me/application', async (c) => {
    const account = await requireProvider(c, identity, config);
    const application = await catalog.application(account.id);
    const { provider } = application;
    return c.json({
      status: provider.status,
      listed: provider.listed,
      missing: application.missing,
      documents: application.documents,
      profile: {
        bio: provider.bio ?? '',
        displayName: provider.display_name ?? '',
        baseLat: provider.base_lat,
        baseLng: provider.base_lng,
        radiusKm: provider.radius_km,
      },
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

  routes.patch('/catalog/me/profile', async (c) => {
    const account = await requireProvider(c, identity, config);
    const body = (await c.req.json().catch(() => null)) as {
      bio?: string;
      displayName?: string;
      baseLat?: number;
      baseLng?: number;
      radiusKm?: number;
    } | null;
    if (!body) {
      throw new ValidationError('errors.validation');
    }
    const provider = await catalog.updateProfile(account.id, body);
    return c.json({ provider });
  });

  routes.get('/catalog/me/services', async (c) => {
    const account = await requireProvider(c, identity, config);
    return c.json({ services: await catalog.listServices(account.id) });
  });

  routes.post('/catalog/me/services', async (c) => {
    const account = await requireProvider(c, identity, config);
    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      description?: string;
      durationMinutes?: number;
      priceMinor?: number;
    } | null;
    if (!body?.name || body.durationMinutes === undefined || body.priceMinor === undefined) {
      throw new ValidationError('errors.validation');
    }
    const service = await catalog.addService(account.id, {
      name: body.name,
      description: body.description ?? '',
      durationMinutes: body.durationMinutes,
      priceMinor: body.priceMinor,
    });
    const quote = await catalog.quoteService(account.id, service.id);
    return c.json({ service, quote });
  });

  routes.get('/catalog/me/services/:id/quote', async (c) => {
    const account = await requireProvider(c, identity, config);
    const serviceId = requireUuidParam(c, 'id');
    return c.json({ quote: await catalog.quoteService(account.id, serviceId) });
  });

  routes.post('/catalog/me/submit', async (c) => {
    const account = await requireProvider(c, identity, config);
    const provider = await catalog.submit(account.id, {
      providerEmail: account.email,
      adminEmail: config.adminSeedEmail,
    });
    return c.json({ status: provider.status });
  });

  routes.get('/catalog/me/go-live', async (c) => {
    const account = await requireProvider(c, identity, config);
    const provider = await catalog.ensureDraft(account.id);
    const status = evaluateGoLive({
      approved: provider.status === 'approved',
      connectComplete: extras ? await extras.payments.isComplete(account.id) : false,
      serviceCount: await catalog.serviceCount(account.id),
      hasAvailability: extras ? await extras.availability.hasAvailability(account.id) : false,
    });
    if (!status.ready && provider.listed) {
      await catalog.setListed(account.id, false);
    }
    return c.json({ ...status, listed: status.ready && provider.listed });
  });

  routes.post('/catalog/me/go-live', async (c) => {
    const account = await requireProvider(c, identity, config);
    const body = (await c.req.json().catch(() => null)) as { listed?: boolean } | null;
    if (body?.listed === undefined) {
      throw new ValidationError('errors.validation');
    }
    const provider = await catalog.ensureDraft(account.id);
    const status = evaluateGoLive({
      approved: provider.status === 'approved',
      connectComplete: extras ? await extras.payments.isComplete(account.id) : false,
      serviceCount: await catalog.serviceCount(account.id),
      hasAvailability: extras ? await extras.availability.hasAvailability(account.id) : false,
    });
    if (body.listed && !status.ready) {
      throw new ValidationError(`catalog.goLiveMissing:${status.missing.join(',')}`);
    }
    const updated = await catalog.setListed(account.id, body.listed);
    return c.json({ listed: updated.listed, ...status });
  });

  routes.post('/payments/me/connect/start', async (c) => {
    const account = await requireProvider(c, identity, config);
    if (!extras) {
      throw new ValidationError('errors.validation');
    }
    return c.json(await extras.payments.startOnboarding(account.id, config.stripeSecretKey));
  });

  routes.post('/payments/me/connect/stub-complete', async (c) => {
    const account = await requireProvider(c, identity, config);
    if (!extras) {
      throw new ValidationError('errors.validation');
    }
    await extras.payments.completeStub(account.id);
    return c.json({ status: 'complete' });
  });

  routes.get('/payments/me/connect', async (c) => {
    const account = await requireProvider(c, identity, config);
    if (!extras) {
      throw new ValidationError('errors.validation');
    }
    return c.json(await extras.payments.getStatus(account.id));
  });

  routes.get('/catalog/public/:providerId', async (c) => {
    const providerId = requireUuidParam(c, 'providerId');
    const provider = await catalog.requirePublic(providerId);
    const application = await catalog.application(provider.account_id);
    const services = await catalog.listServicesForProvider(provider.id);
    const reviews = await catalog.listReviews(provider.id);
    const photos = await catalog.listPortfolioMeta(provider.id);
    const average = provider.rating_count > 0 ? provider.rating_sum / provider.rating_count : null;
    let nextSlots: { start: string; end: string }[] = [];
    if (extras && services[0]) {
      const now = new Date();
      const slots = await extras.availability.slots(provider.account_id, {
        durationMinutes: services[0].duration_minutes,
        from: now,
        to: new Date(now.getTime() + extras.availability.discoveryDays() * 86_400_000),
        now,
      });
      nextSlots = slots.slice(0, 8).map((slot) => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
      }));
    }
    return c.json({
      provider: {
        id: provider.id,
        displayName: provider.display_name ?? '',
        bio: provider.bio ?? '',
        radiusKm: provider.radius_km,
        listed: provider.listed,
        status: provider.status,
      },
      vetting: {
        governmentId: application.documents.some((doc) => doc.kind === 'government_id'),
        credential: application.documents.some((doc) => doc.kind === 'credential'),
        portfolio: application.documents.filter((doc) => doc.kind === 'portfolio').length >= 5,
        interview: provider.status === 'approved',
      },
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        durationMinutes: service.duration_minutes,
        priceMinor: service.price_minor,
        travelIncluded: true,
      })),
      rating: {
        average,
        count: provider.rating_count,
        newProvider: provider.rating_count < config.newProviderReviewThreshold,
      },
      reviews: reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        body: review.body,
        createdAt: review.created_at,
      })),
      portfolio: photos.map((photo) => ({
        id: photo.id,
        url: `/api/catalog/public/${provider.id}/portfolio/${photo.id}`,
      })),
      nextSlots,
    });
  });

  routes.get('/catalog/public/:providerId/services/:serviceId/slots', async (c) => {
    const providerId = requireUuidParam(c, 'providerId');
    const serviceId = requireUuidParam(c, 'serviceId');
    const provider = await catalog.requirePublic(providerId);
    const services = await catalog.listServicesForProvider(provider.id);
    const service = services.find((row) => row.id === serviceId);
    if (!service || !extras) {
      return c.json({ error: 'NOT_FOUND', translationKey: 'catalog.serviceNotFound' }, 404);
    }
    const from = c.req.query('from') ? new Date(String(c.req.query('from'))) : new Date();
    const to = c.req.query('to')
      ? new Date(String(c.req.query('to')))
      : new Date(from.getTime() + extras.availability.discoveryDays() * 86_400_000);
    const slots = await extras.availability.slots(provider.account_id, {
      durationMinutes: service.duration_minutes,
      from,
      to,
      now: new Date(),
    });
    return c.json({
      slots: slots.map((slot) => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
      })),
    });
  });

  routes.get('/catalog/public/:providerId/portfolio/:docId', async (c) => {
    const providerId = requireUuidParam(c, 'providerId');
    const docId = requireUuidParam(c, 'docId');
    const file = await catalog.readPublicPortfolio(providerId, docId);
    return new Response(file.bytes, {
      headers: {
        'content-type': file.contentType,
        'content-disposition': `inline; filename="${file.originalName}"`,
      },
    });
  });

  routes.get('/admin/vetting', async (c) => {
    await requireAdmin(c, identity, config);
    return c.json({ queue: await catalog.listQueue() });
  });

  routes.get('/admin/vetting/:providerId', async (c) => {
    await requireAdmin(c, identity, config);
    const providerId = requireUuidParam(c, 'providerId');
    const provider = await catalog.getById(providerId);
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
    const providerId = requireUuidParam(c, 'providerId');
    const docId = requireUuidParam(c, 'docId');
    const file = await catalog.readDocument(admin.id, providerId, docId);
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
    const providerId = requireUuidParam(c, 'providerId');
    const target = await catalog.getById(providerId);
    const targetAccount = target ? await identity.accountById(target.account_id) : null;
    const provider = await catalog.decide(
      admin.id,
      providerId,
      body.action,
      body.rationale,
      targetAccount ? { providerEmail: targetAccount.email } : undefined,
    );
    return c.json({ status: provider.status });
  });

  return routes;
}
