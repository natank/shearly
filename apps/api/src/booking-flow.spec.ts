import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { migrateCatalog } from '@shearly/services-provider-catalog/migrate';
import { migrateAvailability } from '@shearly/services-availability/migrate';
import { migratePayments } from '@shearly/services-payments/migrate';
import { migrateBooking } from '@shearly/services-booking/migrate';
import { createApp } from './app.js';
import { compose, type ComposeOverrides } from './compose.js';

type FakeStripe = NonNullable<ComposeOverrides['stripeClient']>;

const url = process.env.DATABASE_URL;

function cookie(res: Response): string {
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

/** 2 days out: within the default 6-day auth_horizon, so the "authorize" (not "setup") path runs. */
function nearFutureSlot(hour: number): string {
  const date = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

function fakeStripe() {
  let piCounter = 0;
  return {
    paymentIntents: {
      create: vi.fn(async () => ({ id: `pi_${++piCounter}` })),
      capture: vi.fn(async () => ({ id: 'pi_captured' })),
      cancel: vi.fn(async () => ({ id: 'pi_cancelled' })),
    },
    setupIntents: {
      create: vi.fn(async () => ({ id: 'si_1' })),
    },
    refunds: {
      create: vi.fn(async () => ({ id: 're_1' })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as FakeStripe;
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

async function seedListedProvider(
  app: ReturnType<typeof createApp>,
  services: ReturnType<typeof compose>,
) {
  const email = `prov-${crypto.randomUUID()}@example.com`;
  const register = await app.request('/auth/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
    },
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
  await app.request('/catalog/me/submit', { method: 'POST', headers: { cookie: session } });

  const me = (await (await app.request('/me', { headers: { cookie: session } })).json()) as {
    account: { id: string };
  };
  const providerId = (await services.catalog.getByAccount(me.account.id))?.id as string;

  const adminSignIn = await app.request('/auth/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.90' },
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
  const serviceRes = await app.request('/catalog/me/services', {
    method: 'POST',
    headers: { cookie: session, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Cut',
      description: '60',
      durationMinutes: 60,
      priceMinor: 20000,
    }),
  });
  const service = (await serviceRes.json()) as { service: { id: string } };

  await app.request('/availability/me/weekly', {
    method: 'PUT',
    headers: { cookie: session, 'content-type': 'application/json' },
    body: JSON.stringify({
      rules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1439 })),
    }),
  });
  await app.request('/payments/me/connect/stub-complete', {
    method: 'POST',
    headers: { cookie: session },
  });
  await app.request('/catalog/me/go-live', {
    method: 'POST',
    headers: { cookie: session, 'content-type': 'application/json' },
    body: JSON.stringify({ listed: true }),
  });

  return { providerId, serviceId: service.service.id };
}

async function registerCustomer(app: ReturnType<typeof createApp>) {
  const email = `cust-${crypto.randomUUID()}@example.com`;
  const register = await app.request('/auth/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({
      email,
      password: 'long-enough-password',
      role: 'customer',
      locale: 'en',
    }),
  });
  return cookie(register);
}

describe('M4 booking + payments saga', () => {
  const stripe = fakeStripe();
  const services = url ? compose(undefined, async () => undefined, { stripeClient: stripe }) : null;
  const app = services ? createApp(services) : null;

  beforeAll(async () => {
    if (!url || !services) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P3)');
      }
      return;
    }
    await migrateIdentity(url);
    await migrateCatalog(url);
    await migrateAvailability(url);
    await migratePayments(url);
    await migrateBooking(url);
    await services.identity.ensureAdmin(
      services.config.adminSeedEmail,
      services.config.adminSeedPassword,
    );
  });

  afterAll(async () => {
    await services?.pool.end();
  });

  it('creates a PENDING booking with authorization, not capture (BOK-001, PAY-001)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId } = await seedListedProvider(app, services);
    const customerSession = await registerCustomer(app);

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: {
        cookie: customerSession,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        providerId,
        serviceId,
        addressLine: 'qc-m4 street 1',
        accessNotes: 'gate 2',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(9),
        paymentMethodId: 'pm_test',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; state: string; totalMinor: number };
    expect(body.state).toBe('PENDING');
    expect(body.totalMinor).toBe(20000);
    expect(stripe.paymentIntents.create).toHaveBeenCalled();
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();

    const fetched = await app.request(`/bookings/${body.id}`, {
      headers: { cookie: customerSession },
    });
    expect(fetched.status).toBe(200);
    expect(((await fetched.json()) as { state: string }).state).toBe('PENDING');
  });

  it('rejects unauthenticated booking creation', async () => {
    if (!app) {
      return;
    }
    const res = await app.request('/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('requires an Idempotency-Key header', async () => {
    if (!app) {
      return;
    }
    const customerSession = await registerCustomer(app);
    const res = await app.request('/bookings', {
      method: 'POST',
      headers: { cookie: customerSession, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('concurrent overlapping-but-different-start requests: exactly one wins (BOK-002, NFR-CI-004)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId } = await seedListedProvider(app, services);
    const customerA = await registerCustomer(app);
    const customerB = await registerCustomer(app);

    const bookOnce = (session: string, slotStart: string) =>
      app.request('/bookings', {
        method: 'POST',
        headers: {
          cookie: session,
          'content-type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          providerId,
          serviceId,
          addressLine: 'qc-m4 concurrency',
          accessNotes: '',
          lat: 32.08,
          lng: 34.78,
          slotStart,
          paymentMethodId: 'pm_test',
        }),
      });

    // Different starts (09:00 vs 09:30) that overlap once the 60-min service
    // duration is applied — this is the invariant BOK-002 protects, not
    // merely two identical-start requests.
    const baseSlot = new Date(nearFutureSlot(9));
    const overlappingSlot = new Date(baseSlot.getTime() + 30 * 60_000).toISOString();
    const [resA, resB] = await Promise.all([
      bookOnce(customerA, baseSlot.toISOString()),
      bookOnce(customerB, overlappingSlot),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const loser = resA.status === 409 ? resA : resB;
    const loserBody = (await loser.json()) as { error: string; alternatives: unknown };
    expect(loserBody.error).toBe('CONFLICT');
    expect(loserBody.alternatives).toBeDefined();

    // The losing authorization must have been cancelled, not left dangling.
    expect(stripe.paymentIntents.cancel).toHaveBeenCalled();
  });

  it('rejects a slot in the past', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId } = await seedListedProvider(app, services);
    const customerSession = await registerCustomer(app);
    const res = await app.request('/bookings', {
      method: 'POST',
      headers: {
        cookie: customerSession,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        providerId,
        serviceId,
        addressLine: 'qc-m4',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: '2020-01-01T09:00:00.000Z',
        paymentMethodId: 'pm_test',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('cross-tenant read is rejected (NFR-SEC-008)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId } = await seedListedProvider(app, services);
    const owner = await registerCustomer(app);
    const stranger = await registerCustomer(app);

    const created = await app.request('/bookings', {
      method: 'POST',
      headers: {
        cookie: owner,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        providerId,
        serviceId,
        addressLine: 'qc-m4 tenant',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(9),
        paymentMethodId: 'pm_test',
      }),
    });
    const body = (await created.json()) as { id: string };

    const res = await app.request(`/bookings/${body.id}`, { headers: { cookie: stranger } });
    expect(res.status).toBe(403);
  });
});
