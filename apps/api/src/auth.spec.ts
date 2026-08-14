import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { createApp } from './app.js';
import { compose } from './compose.js';

const url = process.env.DATABASE_URL;

function cookie(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
}

describe('auth HTTP', () => {
  const services = url ? compose() : null;
  const app = services ? createApp(services) : null;

  beforeAll(async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M1-P2)');
      }
      return;
    }
    await migrateIdentity(url);
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
});
