import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { migrateCatalog } from '@shearly/services-provider-catalog/migrate';
import { migrateAvailability } from '@shearly/services-availability/migrate';
import { migratePayments } from '@shearly/services-payments/migrate';
import { createApp } from './app.js';
import { compose } from './compose.js';

const url = process.env.DATABASE_URL;

describe('public catalog', () => {
  const services = url ? compose(undefined, async () => undefined) : null;
  const app = services ? createApp(services) : null;

  beforeAll(async () => {
    if (!url || !services) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M3-P3)');
      }
      return;
    }
    await migrateIdentity(url);
    await migrateCatalog(url);
    await migrateAvailability(url);
    await migratePayments(url);
  });

  afterAll(async () => {
    await services?.pool.end();
  });

  async function seed(listed: boolean) {
    if (!services) {
      throw new Error('services');
    }
    const registered = await services.identity.register({
      email: `pub-${crypto.randomUUID()}@example.com`,
      password: 'long-enough-password',
      role: 'provider',
      locale: 'en',
      ip: `203.0.113.${Math.floor(Math.random() * 200)}`,
    });
    const accountId = registered.accountId as string;
    const provider = await services.catalog.ensureDraft(accountId);
    await services.catalog.updateProfile(accountId, {
      displayName: 'Public Cut',
      bio: 'mobile',
      baseLat: 32.0853,
      baseLng: 34.7818,
      radiusKm: 10,
    });
    const service = await services.catalog.addService(accountId, {
      name: 'Cut',
      description: '',
      durationMinutes: 60,
      priceMinor: 20000,
    });
    const photo = await services.catalog.addDocument(accountId, {
      kind: 'portfolio',
      originalName: 'p.png',
      contentType: 'image/png',
      bytes: Buffer.from('photo-bytes'),
    });
    await services.catalog.addDocument(accountId, {
      kind: 'government_id',
      originalName: 'id.png',
      contentType: 'image/png',
      bytes: Buffer.from('id-bytes'),
    });
    await services.availability.replaceWeekly(accountId, [
      { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
    ]);
    await services.pool.query(
      `UPDATE catalog.providers SET status = 'approved', listed = $2 WHERE id = $1`,
      [provider.id, listed],
    );
    return { providerId: provider.id, serviceId: service.id, photoId: photo.id, accountId };
  }

  it('404s unlisted providers and hides identity documents', async () => {
    if (!app || !services) {
      return;
    }
    const hidden = await seed(false);
    const missing = await app.request(`/catalog/public/${hidden.providerId}`);
    expect(missing.status).toBe(404);

    const live = await seed(true);
    await services.catalog.addReview(live.providerId, { rating: 5, body: 'great' });
    const profile = await app.request(`/catalog/public/${live.providerId}`);
    expect(profile.status).toBe(200);
    const body = (await profile.json()) as {
      services: { priceMinor: number; travelIncluded: boolean }[];
      rating: { newProvider: boolean; count: number };
      reviews: { rating: number }[];
      portfolio: { id: string }[];
      nextSlots: unknown[];
    };
    expect(body.services[0]).toMatchObject({ priceMinor: 20000, travelIncluded: true });
    expect(body.rating.count).toBe(1);
    expect(body.rating.newProvider).toBe(true);
    expect(body.reviews[0]?.rating).toBe(5);
    expect(body.portfolio[0]?.id).toBe(live.photoId);

    const photo = await app.request(`/catalog/public/${live.providerId}/portfolio/${live.photoId}`);
    expect(photo.status).toBe(200);
    expect(await photo.text()).toBe('photo-bytes');

    const docs = await services.catalog.application(live.accountId);
    const idDoc = docs.documents.find((doc) => doc.kind === 'government_id');
    expect(idDoc).toBeTruthy();
    const forbidden = await app.request(
      `/catalog/public/${live.providerId}/portfolio/${idDoc?.id}`,
    );
    expect(forbidden.status).toBe(404);

    const slots = await app.request(
      `/catalog/public/${live.providerId}/services/${live.serviceId}/slots`,
    );
    expect(slots.status).toBe(200);
    expect(Array.isArray(((await slots.json()) as { slots: unknown[] }).slots)).toBe(true);
  });
});
