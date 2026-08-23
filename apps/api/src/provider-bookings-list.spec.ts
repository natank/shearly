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

function uniqueIp(): string {
  const bytes = crypto.randomUUID().replace(/-/g, '');
  const a = parseInt(bytes.slice(0, 2), 16);
  const b = parseInt(bytes.slice(2, 4), 16);
  const c = parseInt(bytes.slice(4, 6), 16);
  return `10.${a}.${b}.${c}`;
}

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
      'x-forwarded-for': uniqueIp(),
    },
    body: JSON.stringify({
      email,
      password: 'long-enough-password',
      role: 'provider',
      locale: 'he',
    }),
  });
  const providerSession = cookie(register);
  await upload(app, providerSession, 'government_id', 'id.png');
  await upload(app, providerSession, 'credential', 'cred.png');
  for (let i = 0; i < 5; i += 1) {
    await upload(app, providerSession, 'portfolio', `p${i}.png`);
  }
  await app.request('/catalog/me/submit', {
    method: 'POST',
    headers: { cookie: providerSession },
  });

  const me = (await (
    await app.request('/me', { headers: { cookie: providerSession } })
  ).json()) as { account: { id: string } };
  const providerId = (await services.catalog.getByAccount(me.account.id))?.id as string;

  const adminSignIn = await app.request('/auth/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': uniqueIp() },
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
    headers: { cookie: providerSession, 'content-type': 'application/json' },
    body: JSON.stringify({ bio: 'cuts', baseLat: 32.08, baseLng: 34.78, radiusKm: 10 }),
  });
  const serviceRes = await app.request('/catalog/me/services', {
    method: 'POST',
    headers: { cookie: providerSession, 'content-type': 'application/json' },
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
    headers: { cookie: providerSession, 'content-type': 'application/json' },
    body: JSON.stringify({
      rules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1439 })),
    }),
  });
  await app.request('/payments/me/connect/stub-complete', {
    method: 'POST',
    headers: { cookie: providerSession },
  });
  await app.request('/catalog/me/go-live', {
    method: 'POST',
    headers: { cookie: providerSession, 'content-type': 'application/json' },
    body: JSON.stringify({ listed: true }),
  });

  return { providerId, serviceId: service.service.id, providerSession };
}

async function registerCustomer(app: ReturnType<typeof createApp>) {
  const email = `cust-${crypto.randomUUID()}@example.com`;
  const register = await app.request('/auth/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': uniqueIp(),
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

async function createBooking(
  app: ReturnType<typeof createApp>,
  customerSession: string,
  providerId: string,
  serviceId: string,
  hour = 9,
) {
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
      addressLine: 'qc-013 street',
      accessNotes: 'gate',
      lat: 32.08,
      lng: 34.78,
      slotStart: nearFutureSlot(hour),
      paymentMethodId: 'pm_test',
    }),
  });
  return (await res.json()) as { id: string; state: string };
}

// QCF-013: GET /provider/me/bookings is the read side that the new
// booking-action UI drives — it must respect the same NFR-SEC-005 DTO gate
// as the single-booking provider-view.
describe('GET /provider/me/bookings (QCF-013)', () => {
  const stripe = fakeStripe();
  const services = url ? compose(undefined, async () => undefined, { stripeClient: stripe }) : null;
  const app = services ? createApp(services) : null;

  beforeAll(async () => {
    if (!url || !services) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (QCF-013)');
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

  it('lists PENDING without address, CONFIRMED with address, sorted soonest-first', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const customer = await registerCustomer(app);

    const later = await createBooking(app, customer, providerId, serviceId, 15);
    const earlier = await createBooking(app, customer, providerId, serviceId, 9);
    await app.request(`/bookings/${earlier.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });

    const res = await app.request('/provider/me/bookings', {
      headers: { cookie: providerSession },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bookings: Array<{
        id: string;
        state: string;
        fullAddress?: string;
        accessNotes?: string;
      }>;
    };
    expect(body.bookings.map((b) => b.id)).toEqual([earlier.id, later.id]);

    const confirmedEntry = body.bookings.find((b) => b.id === earlier.id);
    expect(confirmedEntry?.state).toBe('CONFIRMED');
    expect(confirmedEntry?.fullAddress).toBe('qc-013 street');

    const pendingEntry = body.bookings.find((b) => b.id === later.id);
    expect(pendingEntry?.state).toBe('PENDING');
    expect(pendingEntry?.fullAddress).toBeUndefined();
    expect(JSON.stringify(pendingEntry)).not.toContain('qc-013 street');
  });

  it("provider A's list never includes provider B's bookings", async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId } = await seedListedProvider(app, services);
    const { providerSession: strangerSession } = await seedListedProvider(app, services);
    const customer = await registerCustomer(app);
    const booking = await createBooking(app, customer, providerId, serviceId, 10);

    const res = await app.request('/provider/me/bookings', {
      headers: { cookie: strangerSession },
    });
    const body = (await res.json()) as { bookings: Array<{ id: string }> };
    expect(body.bookings.some((b) => b.id === booking.id)).toBe(false);
  });
});
