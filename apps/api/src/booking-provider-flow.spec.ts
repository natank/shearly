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
      addressLine: 'qc-m4 street 1',
      accessNotes: 'gate 2',
      lat: 32.08,
      lng: 34.78,
      slotStart: nearFutureSlot(hour),
      paymentMethodId: 'pm_test',
    }),
  });
  return (await res.json()) as { id: string; state: string };
}

describe('M4 provider actions on bookings', () => {
  const stripe = fakeStripe();
  const services = url ? compose(undefined, async () => undefined, { stripeClient: stripe }) : null;
  const app = services ? createApp(services) : null;

  beforeAll(async () => {
    if (!url || !services) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI (M4-P4)');
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

  it('accept reveals full address; PENDING never did (BOK-003, NFR-SEC-005)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const customer = await registerCustomer(app);
    const booking = await createBooking(app, customer, providerId, serviceId, 9);

    const pendingView = await app.request(`/bookings/${booking.id}/provider-view`, {
      headers: { cookie: providerSession },
    });
    const pendingBody = (await pendingView.json()) as Record<string, unknown>;
    expect(pendingBody.fullAddress).toBeUndefined();
    expect(pendingBody.accessNotes).toBeUndefined();
    expect(JSON.stringify(pendingBody)).not.toContain('qc-m4 street 1');

    const accept = await app.request(`/bookings/${booking.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    expect(accept.status).toBe(200);
    expect((await accept.json()) as { state: string }).toMatchObject({ state: 'CONFIRMED' });

    const confirmedView = await app.request(`/bookings/${booking.id}/provider-view`, {
      headers: { cookie: providerSession },
    });
    const confirmedBody = (await confirmedView.json()) as {
      fullAddress: string;
      accessNotes: string;
    };
    expect(confirmedBody.fullAddress).toBe('qc-m4 street 1');
    expect(confirmedBody.accessNotes).toBe('gate 2');
  });

  it('decline releases the authorization and frees the slot (BOK-003)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const customer = await registerCustomer(app);
    const booking = await createBooking(app, customer, providerId, serviceId, 10);

    const decline = await app.request(`/bookings/${booking.id}/decline`, {
      method: 'PATCH',
      headers: { cookie: providerSession, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'too far' }),
    });
    expect(decline.status).toBe(200);
    expect((await decline.json()) as { state: string }).toMatchObject({ state: 'DECLINED' });
    expect(stripe.paymentIntents.cancel).toHaveBeenCalled();

    // The same slot is bookable again by a different customer.
    const secondCustomer = await registerCustomer(app);
    const rebooked = await createBooking(app, secondCustomer, providerId, serviceId, 10);
    expect(rebooked.state).toBe('PENDING');
  });

  it('complete captures and splits gross/commission/net (BOK-007, PAY-002)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const customer = await registerCustomer(app);
    const booking = await createBooking(app, customer, providerId, serviceId, 11);

    await app.request(`/bookings/${booking.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });

    // Complete before slot_start must be rejected (guard in transition()).
    const tooEarly = await app.request(`/bookings/${booking.id}/complete`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    expect(tooEarly.status).toBe(409);

    // Advance the booking's slot_start into the past directly (no live clock
    // control in M4 — see M4 plan's frozen-clock note) so complete succeeds.
    await services.pool.query(
      `UPDATE booking.bookings SET slot_start = now() - interval '1 hour' WHERE id = $1`,
      [booking.id],
    );

    const complete = await app.request(`/bookings/${booking.id}/complete`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    expect(complete.status).toBe(200);
    expect((await complete.json()) as { state: string }).toMatchObject({ state: 'COMPLETED' });

    const ledger = await services.ledger.entriesForBooking(booking.id);
    expect(ledger).toEqual([
      { kind: 'gross', amountMinor: 20000 },
      { kind: 'commission', amountMinor: 4000 },
      { kind: 'net', amountMinor: 16000 },
    ]);
    expect(stripe.paymentIntents.capture).toHaveBeenCalled();
  });

  it("provider cannot action another provider's booking", async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId } = await seedListedProvider(app, services);
    const { providerSession: strangerSession } = await seedListedProvider(app, services);
    const customer = await registerCustomer(app);
    const booking = await createBooking(app, customer, providerId, serviceId, 12);

    const res = await app.request(`/bookings/${booking.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: strangerSession },
    });
    expect(res.status).toBe(403);
  });

  it('customer no-show captures in full; provider no-show refunds in full (BOK-008)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);

    const custNoShowCustomer = await registerCustomer(app);
    const custNoShowBooking = await createBooking(
      app,
      custNoShowCustomer,
      providerId,
      serviceId,
      13,
    );
    await app.request(`/bookings/${custNoShowBooking.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    await services.pool.query(
      `UPDATE booking.bookings SET slot_start = now() - interval '1 hour' WHERE id = $1`,
      [custNoShowBooking.id],
    );
    const noShow = await app.request(`/bookings/${custNoShowBooking.id}/no-show`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    expect(noShow.status).toBe(200);
    expect((await noShow.json()) as { state: string }).toMatchObject({
      state: 'NO_SHOW_CUSTOMER',
    });
    expect(stripe.paymentIntents.capture).toHaveBeenCalled();
  });
});
