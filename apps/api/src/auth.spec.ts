import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { migrateCatalog } from '@shearly/services-provider-catalog/migrate';
import { createApp } from './app.js';
import { compose } from './compose.js';

const url = process.env.DATABASE_URL;

function cookie(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
}

describe('auth HTTP', () => {
  const services = url ? compose(undefined, async () => undefined) : null;
  const app = services ? createApp(services) : null;

  beforeAll(async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M1-P2)');
      }
      return;
    }
    await migrateIdentity(url);
    await migrateCatalog(url);
  });

  afterAll(async () => {
    await services?.pool.end();
  });

  it('registers, reads /me, and signs out', async () => {
    if (!app) {
      return;
    }
    const email = `http-${crypto.randomUUID()}@example.com`;
    const register = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'long-enough-password',
        role: 'customer',
        locale: 'he',
      }),
    });
    expect(register.status).toBe(200);
    expect(await register.json()).toEqual({ ok: true, translationKey: 'auth.registerAccepted' });
    const session = cookie(register);
    expect(session).toContain('shearly_session=');

    const me = await app.request('/api/me', { headers: { cookie: session } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { account: { email: string; role: string } };
    expect(body.account.email).toBe(email);
    expect(body.account.role).toBe('customer');

    const out = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { cookie: session },
    });
    expect(out.status).toBe(200);
    const denied = await app.request('/api/me', { headers: { cookie: session } });
    expect(denied.status).toBe(401);
  });

  it('uses the same JSON for a duplicate register and hides email existence on sign-in', async () => {
    if (!app) {
      return;
    }
    const email = `enum-${crypto.randomUUID()}@example.com`;
    const first = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
      body: JSON.stringify({
        email,
        password: 'long-enough-password',
        role: 'provider',
        locale: 'en',
      }),
    });
    const duplicate = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.11' },
      body: JSON.stringify({
        email,
        password: 'long-enough-password',
        role: 'provider',
        locale: 'en',
      }),
    });
    expect(await first.json()).toEqual(await duplicate.json());
    expect(cookie(first)).toContain('shearly_session=');
    expect(cookie(duplicate)).not.toContain('shearly_session=');
    const me = await app.request('/me', { headers: { cookie: cookie(first) } });
    const account = (await me.json()) as { account: { id: string } };
    expect(await services?.catalog.getByAccount(account.account.id)).toMatchObject({
      status: 'draft',
    });

    const unknown = await app.request('/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.12' },
      body: JSON.stringify({
        email: `nope-${crypto.randomUUID()}@example.com`,
        password: 'long-enough-password',
      }),
    });
    const wrong = await app.request('/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.13' },
      body: JSON.stringify({ email, password: 'definitely-wrong' }),
    });
    expect(unknown.status).toBe(200);
    const unknownBody = await unknown.json();
    const wrongBody = await wrong.json();
    expect(unknownBody).toEqual(wrongBody);
    expect(wrongBody).toEqual({ ok: false, translationKey: 'auth.invalidCredentials' });
  });

  it('returns the same JSON for reset requests whether the email exists', async () => {
    if (!app) {
      return;
    }
    const email = `rst-http-${crypto.randomUUID()}@example.com`;
    await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
      body: JSON.stringify({
        email,
        password: 'long-enough-password',
        role: 'customer',
        locale: 'en',
      }),
    });
    const known = await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.11' },
      body: JSON.stringify({ email, locale: 'en' }),
    });
    const unknown = await app.request('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.12' },
      body: JSON.stringify({ email: `no-${crypto.randomUUID()}@example.com`, locale: 'en' }),
    });
    expect(known.status).toBe(200);
    const knownBody = await known.json();
    const unknownBody = await unknown.json();
    expect(knownBody).toEqual(unknownBody);
    expect(unknownBody).toEqual({ ok: true, translationKey: 'auth.resetRequested' });
  });

  it('writes and reads a guest draft cookie', async () => {
    if (!app) {
      return;
    }
    const saved = await app.request('/auth/guest-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'prov-1', slotId: 'slot-1' }),
    });
    expect(saved.status).toBe(200);
    const header = cookie(saved);
    expect(header).toContain('shearly_guest_draft=');
    const read = await app.request('/auth/guest-draft', { headers: { cookie: header } });
    expect(await read.json()).toEqual({ draft: { providerId: 'prov-1', slotId: 'slot-1' } });
    const tampered = await app.request('/auth/guest-draft', {
      headers: { cookie: `${header}tamper` },
    });
    expect(await tampered.json()).toEqual({ draft: null });
  });

  it('does not let session A read session B (NFR-SEC-008)', async () => {
    if (!app) {
      return;
    }
    const a = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.80' },
      body: JSON.stringify({
        email: `sec-a-${crypto.randomUUID()}@example.com`,
        password: 'long-enough-password',
        role: 'customer',
        locale: 'en',
      }),
    });
    const b = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.81' },
      body: JSON.stringify({
        email: `sec-b-${crypto.randomUUID()}@example.com`,
        password: 'long-enough-password',
        role: 'provider',
        locale: 'en',
      }),
    });
    const meA = (await (await app.request('/me', { headers: { cookie: cookie(a) } })).json()) as {
      account: { email: string };
    };
    const meB = (await (await app.request('/me', { headers: { cookie: cookie(b) } })).json()) as {
      account: { email: string };
    };
    expect(meA.account.email).not.toBe(meB.account.email);
  });
});
