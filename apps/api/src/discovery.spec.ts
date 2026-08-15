import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { migrateCatalog } from '@shearly/services-provider-catalog/migrate';
import { migrateAvailability } from '@shearly/services-availability/migrate';
import { migratePayments } from '@shearly/services-payments/migrate';
import { createApp } from './app.js';
import { compose } from './compose.js';

const url = process.env.DATABASE_URL;
const telAviv = { lat: 32.0853, lng: 34.7818 };
const nowhere = { lat: 0, lng: 0 };

describe('discovery HTTP', () => {
  const services = url ? compose(undefined, async () => undefined) : null;
  const app = services ? createApp(services) : null;

  beforeAll(async () => {
    if (!url || !services) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M3-P2)');
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

  async function seedListed(input: {
    lat: number;
    lng: number;
    name: string;
    service?: string;
    priceMinor?: number;
  }) {
    if (!services) {
      throw new Error('services');
    }
    const registered = await services.identity.register({
      email: `disc-${crypto.randomUUID()}@example.com`,
      password: 'long-enough-password',
      role: 'provider',
      locale: 'en',
      ip: `203.0.113.${Math.floor(Math.random() * 200)}`,
    });
    const accountId = registered.accountId;
    if (!accountId) {
      throw new Error('register');
    }
    const provider = await services.catalog.ensureDraft(accountId);
    await services.catalog.updateProfile(accountId, {
      displayName: input.name,
      baseLat: input.lat,
      baseLng: input.lng,
      radiusKm: 10,
    });
    await services.catalog.addService(accountId, {
      name: input.service ?? 'Cut',
      description: '',
      durationMinutes: 60,
      priceMinor: input.priceMinor ?? 20000,
    });
    await services.availability.replaceWeekly(
      accountId,
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        startMinute: 9 * 60,
        endMinute: 17 * 60,
      })),
    );
    await services.pool.query(
      `UPDATE catalog.providers SET status = 'approved', listed = true WHERE id = $1`,
      [provider.id],
    );
    return provider.id;
  }

  it('requires a location and reports out of area', async () => {
    if (!app) {
      return;
    }
    const missing = await app.request('/discovery');
    expect(await missing.json()).toEqual({ state: 'need_location' });
    await seedListed({ ...telAviv, name: 'TLV Cut' });
    const far = await app.request(`/discovery?lat=${nowhere.lat}&lng=${nowhere.lng}`);
    expect(await far.json()).toMatchObject({ state: 'out_of_area' });
    const near = await app.request(`/discovery?lat=${telAviv.lat}&lng=${telAviv.lng}`);
    const body = (await near.json()) as { state: string; providers: { displayName: string }[] };
    expect(body.state).toBe('ok');
    expect(body.providers.some((row) => row.displayName === 'TLV Cut')).toBe(true);
  });

  it('names filters when they match nothing', async () => {
    if (!app) {
      return;
    }
    await seedListed({ ...telAviv, name: 'Color only', service: 'Color', priceMinor: 30000 });
    const empty = await app.request(
      `/discovery?lat=${telAviv.lat}&lng=${telAviv.lng}&service=Massage`,
    );
    expect(await empty.json()).toMatchObject({
      state: 'no_matches',
      filters: { service: 'Massage' },
    });
  });

  it('reverses order when RANKING_IMPL=stub', async () => {
    if (!url) {
      return;
    }
    const stub = compose({ ...process.env, RANKING_IMPL: 'stub' }, async () => undefined);
    const stubApp = createApp(stub);
    const near = await seedListed({
      lat: telAviv.lat,
      lng: telAviv.lng,
      name: 'Closer',
    });
    const slightlyFar = await seedListed({
      lat: telAviv.lat + 0.02,
      lng: telAviv.lng,
      name: 'Farther',
    });
    const det = compose({ ...process.env, RANKING_IMPL: 'deterministic' }, async () => undefined);
    const detApp = createApp(det);
    const defaultOrder = (await (
      await detApp.request(`/discovery?lat=${telAviv.lat}&lng=${telAviv.lng}`)
    ).json()) as { providers: { id: string }[] };
    const stubOrder = (await (
      await stubApp.request(`/discovery?lat=${telAviv.lat}&lng=${telAviv.lng}`)
    ).json()) as { providers: { id: string }[] };
    const detIds = defaultOrder.providers
      .map((row) => row.id)
      .filter((id) => id === near || id === slightlyFar);
    const stubIds = stubOrder.providers
      .map((row) => row.id)
      .filter((id) => id === near || id === slightlyFar);
    expect(detIds.length).toBe(2);
    expect(stubIds).toEqual([...detIds].reverse());
    await stub.pool.end();
    await det.pool.end();
  });
});
