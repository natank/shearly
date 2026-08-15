import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { migrateCatalog } from '@shearly/services-provider-catalog/migrate';
import { createApp } from './app.js';
import { compose } from './compose.js';

const url = process.env.DATABASE_URL;

function cookie(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function registerProvider(app: ReturnType<typeof createApp>, email: string) {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200)}`,
    },
    body: JSON.stringify({
      email,
      password: 'long-enough-password',
      role: 'provider',
      locale: 'en',
    }),
  });
  return cookie(res);
}

describe('catalog HTTP', () => {
  const services = url ? compose(undefined, async () => undefined) : null;
  const app = services ? createApp(services) : null;

  beforeAll(async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M2-P2)');
      }
      return;
    }
    await migrateIdentity(url);
    await migrateCatalog(url);
  });

  afterAll(async () => {
    await services?.pool.end();
  });

  it('rejects incomplete submit and forbids a customer from the queue', async () => {
    if (!app || !services) {
      return;
    }
    const session = await registerProvider(app, `vet-${crypto.randomUUID()}@example.com`);
    const incomplete = await app.request('/catalog/me/submit', {
      method: 'POST',
      headers: { cookie: session },
    });
    expect(incomplete.status).toBe(400);
    const customer = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.90' },
      body: JSON.stringify({
        email: `cus-${crypto.randomUUID()}@example.com`,
        password: 'long-enough-password',
        role: 'customer',
        locale: 'en',
      }),
    });
    const queue = await app.request('/admin/vetting', { headers: { cookie: cookie(customer) } });
    expect(queue.status).toBe(403);
  });

  it('returns saved profile fields after PATCH', async () => {
    if (!app) {
      return;
    }
    const session = await registerProvider(app, `prof-${crypto.randomUUID()}@example.com`);
    const saved = await app.request('/catalog/me/profile', {
      method: 'PATCH',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({
        bio: 'Tel Aviv cuts',
        baseLat: 32.08,
        baseLng: 34.78,
        radiusKm: 10,
      }),
    });
    expect(saved.status).toBe(200);
    const again = await app.request('/catalog/me/application', { headers: { cookie: session } });
    const body = (await again.json()) as {
      profile: { bio: string; baseLat: number; baseLng: number; radiusKm: number };
    };
    expect(body.profile.bio).toBe('Tel Aviv cuts');
    expect(body.profile.baseLat).toBeCloseTo(32.08);
    expect(body.profile.baseLng).toBeCloseTo(34.78);
    expect(body.profile.radiusKm).toBe(10);
  });
});
