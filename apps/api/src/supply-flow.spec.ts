import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { migrateCatalog } from '@shearly/services-provider-catalog/migrate';
import { migrateAvailability } from '@shearly/services-availability/migrate';
import { migratePayments } from '@shearly/services-payments/migrate';
import { createApp } from './app.js';
import { compose } from './compose.js';

const url = process.env.DATABASE_URL;

function cookie(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function upload(
  app: ReturnType<typeof createApp>,
  session: string,
  kind: string,
  name: string,
) {
  const form = new FormData();
  form.set('kind', kind);
  form.set('file', new File([`bytes-${name}`], name, { type: 'image/png' }));
  return app.request('/catalog/me/documents', {
    method: 'POST',
    headers: { cookie: session },
    body: form,
  });
}

describe('M2 supply loop', () => {
  const services = url ? compose(undefined, async () => undefined) : null;
  const app = services ? createApp(services) : null;

  beforeAll(async () => {
    if (!url || !services) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M2-P7)');
      }
      return;
    }
    await migrateIdentity(url);
    await migrateCatalog(url);
    await migrateAvailability(url);
    await migratePayments(url);
    await services.identity.ensureAdmin(
      services.config.adminSeedEmail,
      services.config.adminSeedPassword,
    );
  });

  afterAll(async () => {
    await services?.pool.end();
  });

  it('vets a provider, sets a menu and hours, then go-live', async () => {
    if (!app || !services) {
      return;
    }
    const email = `sup-${crypto.randomUUID()}@example.com`;
    const register = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.40' },
      body: JSON.stringify({
        email,
        password: 'long-enough-password',
        role: 'provider',
        locale: 'he',
      }),
    });
    const session = cookie(register);
    await upload(app, session, 'government_id', 'id.png');
    await upload(app, session, 'credential', 'cred.png');
    for (let i = 0; i < 5; i += 1) {
      await upload(app, session, 'portfolio', `p${i}.png`);
    }
    const submitted = await app.request('/catalog/me/submit', {
      method: 'POST',
      headers: { cookie: session },
    });
    expect(await submitted.json()).toEqual({ status: 'pending_review' });

    const me = (await (await app.request('/me', { headers: { cookie: session } })).json()) as {
      account: { id: string };
    };
    const providerId = (await services.catalog.getByAccount(me.account.id))?.id;
    expect(providerId).toBeTruthy();
    const adminSignIn = await app.request('/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.41' },
      body: JSON.stringify({
        email: services.config.adminSeedEmail,
        password: services.config.adminSeedPassword,
      }),
    });
    const admin = cookie(adminSignIn);
    await app.request(`/admin/vetting/${providerId}/decision`, {
      method: 'POST',
      headers: { cookie: admin, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'interview', rationale: 'call' }),
    });
    await app.request(`/admin/vetting/${providerId}/decision`, {
      method: 'POST',
      headers: { cookie: admin, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve', rationale: 'ok' }),
    });

    await app.request('/catalog/me/profile', {
      method: 'PATCH',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ bio: 'cuts', baseLat: 32.08, baseLng: 34.78, radiusKm: 10 }),
    });
    const service = await app.request('/catalog/me/services', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Cut',
        description: '60',
        durationMinutes: 60,
        priceMinor: 20000,
      }),
    });
    expect(((await service.json()) as { quote: { net: number } }).quote.net).toBe(16000);
    await app.request('/availability/me/weekly', {
      method: 'PUT',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ rules: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] }),
    });
    await app.request('/availability/me/exceptions', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-08-18', kind: 'block' }),
    });
    const before = (await (
      await app.request('/catalog/me/go-live', { headers: { cookie: session } })
    ).json()) as { missing: string[] };
    expect(before.missing).toContain('connect');
    await app.request('/payments/me/connect/stub-complete', {
      method: 'POST',
      headers: { cookie: session },
    });
    const live = await app.request('/catalog/me/go-live', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/json' },
      body: JSON.stringify({ listed: true }),
    });
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ listed: true, ready: true });
  });

  it('mails provider + admin on submit, and provider on decision (M2-T02 regression)', async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const mailServices = url ? compose(undefined, async (mail) => void sent.push(mail)) : null;
    const mailApp = mailServices ? createApp(mailServices) : null;
    if (!mailApp || !mailServices) {
      return;
    }
    try {
      await mailServices.identity.ensureAdmin(
        mailServices.config.adminSeedEmail,
        mailServices.config.adminSeedPassword,
      );
      const email = `mail-${crypto.randomUUID()}@example.com`;
      const register = await mailApp.request('/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.60' },
        body: JSON.stringify({
          email,
          password: 'long-enough-password',
          role: 'provider',
          locale: 'he',
        }),
      });
      const session = cookie(register);
      await upload(mailApp, session, 'government_id', 'id.png');
      await upload(mailApp, session, 'credential', 'cred.png');
      for (let i = 0; i < 5; i += 1) {
        await upload(mailApp, session, 'portfolio', `p${i}.png`);
      }

      const submitted = await mailApp.request('/catalog/me/submit', {
        method: 'POST',
        headers: { cookie: session },
      });
      expect(await submitted.json()).toEqual({ status: 'pending_review' });
      expect(sent).toHaveLength(2);
      expect(sent.map((mail) => mail.to)).toEqual(
        expect.arrayContaining([email, mailServices.config.adminSeedEmail]),
      );

      sent.length = 0;
      const me = (await (
        await mailApp.request('/me', { headers: { cookie: session } })
      ).json()) as { account: { id: string } };
      const providerId = (await mailServices.catalog.getByAccount(me.account.id))?.id;
      const adminSignIn = await mailApp.request('/auth/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.61' },
        body: JSON.stringify({
          email: mailServices.config.adminSeedEmail,
          password: mailServices.config.adminSeedPassword,
        }),
      });
      const admin = cookie(adminSignIn);
      await mailApp.request(`/admin/vetting/${providerId}/decision`, {
        method: 'POST',
        headers: { cookie: admin, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'interview', rationale: 'call' }),
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: email });
    } finally {
      await mailServices.pool.end();
    }
  });
});
