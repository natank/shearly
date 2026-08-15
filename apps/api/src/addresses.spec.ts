import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { createApp } from './app.js';
import { compose } from './compose.js';

const url = process.env.DATABASE_URL;

function cookie(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

describe('customer addresses', () => {
  const services = url ? compose(undefined, async () => undefined) : null;
  const app = services ? createApp(services) : null;

  beforeAll(async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M3-P4)');
      }
      return;
    }
    await migrateIdentity(url);
    vi.stubGlobal('fetch', async (input: URL) => {
      if (String(input).includes('tel')) {
        return new Response(JSON.stringify({ lat: 32.0853, lng: 34.7818, label: 'Tel Aviv' }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 404 });
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await services?.pool.end();
  });

  it('lets a customer save an address and forbids other roles', async () => {
    if (!app) {
      return;
    }
    const customer = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.80' },
      body: JSON.stringify({
        email: `cust-${crypto.randomUUID()}@example.com`,
        password: 'long-enough-password',
        role: 'customer',
        locale: 'en',
      }),
    });
    const session = cookie(customer);
    const created = await app.request('/account/me/addresses', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Home', line: 'tel aviv', accessNotes: 'bldg' }),
    });
    expect(created.status).toBe(200);
    const saved = (await created.json()) as { address: { lat: number; label: string } };
    expect(saved.address.label).toBe('Home');
    expect(saved.address.lat).toBeCloseTo(32.0853);

    const unknown = await app.request('/account/me/addresses', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'X', line: 'nowhere' }),
    });
    expect(unknown.status).toBe(400);

    const other = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.81' },
      body: JSON.stringify({
        email: `oth-${crypto.randomUUID()}@example.com`,
        password: 'long-enough-password',
        role: 'customer',
        locale: 'en',
      }),
    });
    const listed = await app.request('/account/me/addresses', {
      headers: { cookie: cookie(other) },
    });
    expect(((await listed.json()) as { addresses: unknown[] }).addresses).toEqual([]);

    const provider = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.82' },
      body: JSON.stringify({
        email: `prv-${crypto.randomUUID()}@example.com`,
        password: 'long-enough-password',
        role: 'provider',
        locale: 'en',
      }),
    });
    const forbidden = await app.request('/account/me/addresses', {
      headers: { cookie: cookie(provider) },
    });
    expect(forbidden.status).toBe(403);
  });
});
