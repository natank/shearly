import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { migrateCatalog } from '@shearly/services-provider-catalog/migrate';
import { migrateAvailability } from '@shearly/services-availability/migrate';
import { migratePayments } from '@shearly/services-payments/migrate';
import { migrateBooking } from '@shearly/services-booking/migrate';
import { createApp } from './app.js';
import { compose, type ComposeOverrides } from './compose.js';
import { runDueWorkOnce } from './due-work-poller.js';

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
    headers: { 'content-type': 'application/json', 'x-forwarded-for': uniqueIp() },
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

  return { providerId, serviceId: service.service.id, providerSession: session };
}

async function registerCustomer(app: ReturnType<typeof createApp>) {
  const email = `cust-${crypto.randomUUID()}@example.com`;
  const register = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': uniqueIp() },
    body: JSON.stringify({
      email,
      password: 'long-enough-password',
      role: 'customer',
      locale: 'en',
    }),
  });
  return cookie(register);
}

describe('due-work poller', () => {
  const stripe = fakeStripe();
  const services = url ? compose(undefined, async () => undefined, { stripeClient: stripe }) : null;
  const app = services ? createApp(services) : null;

  beforeAll(async () => {
    if (!url || !services) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
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

  it('a PENDING booking whose response_deadline has passed is claimed and transitions to EXPIRED with authorization released, without any request hitting the API', async () => {
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
        addressLine: 'poller street 1',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(9),
        paymentMethodId: 'pm_test',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };

    // Simulate elapsed time without waiting: the poller reads response_deadline
    // from the DB, so backdating it is equivalent to time having passed.
    await services.pool.query(
      `UPDATE booking.bookings SET response_deadline = now() - interval '1 minute' WHERE id = $1`,
      [body.id],
    );

    const result = await runDueWorkOnce(services);
    expect(result.expiredBookings).toBeGreaterThanOrEqual(1);

    const fetched = await app.request(`/bookings/${body.id}`, {
      headers: { cookie: customerSession },
    });
    expect(((await fetched.json()) as { state: string }).state).toBe('EXPIRED');
    expect(stripe.paymentIntents.cancel).toHaveBeenCalled();
  });

  it('two concurrent poller ticks racing the same due booking: exactly one claims it', async () => {
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
        addressLine: 'poller street 2',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(10),
        paymentMethodId: 'pm_test',
      }),
    });
    const body = (await res.json()) as { id: string };
    await services.pool.query(
      `UPDATE booking.bookings SET response_deadline = now() - interval '1 minute' WHERE id = $1`,
      [body.id],
    );

    const [a, b] = await Promise.all([runDueWorkOnce(services), runDueWorkOnce(services)]);
    expect(a.expiredBookings + b.expiredBookings).toBe(1);
  });

  it('a post-commit effect failure (Stripe down) still leaves the booking EXPIRED, recorded separately for OPS-002 rather than rolled back or silently dropped', async () => {
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
        addressLine: 'poller street 3',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(11),
        paymentMethodId: 'pm_test',
      }),
    });
    const body = (await res.json()) as { id: string };
    await services.pool.query(
      `UPDATE booking.bookings SET response_deadline = now() - interval '1 minute' WHERE id = $1`,
      [body.id],
    );

    // A claim-time failure (handle() throwing before COMMIT) is already
    // covered generically by libs/shared/poller's own claim-due-work.spec.ts.
    // What's specific to booking wiring is a *post-commit* effect failure:
    // the state transition has already committed by the time executeEffects
    // runs (see due-work-poller.ts's own doc comment on why), so a Stripe
    // failure here must not roll back EXPIRED — it's recorded separately
    // for OPS-002 (M5-P6), matching booking-effects.ts's documented PAY-002
    // behavior (effect failures never revert an already-committed state).
    vi.mocked(stripe.paymentIntents.cancel).mockRejectedValueOnce(new Error('stripe down'));

    const result = await runDueWorkOnce(services);
    expect(result.failedBookings).toBeGreaterThanOrEqual(1);

    const nowExpired = await app.request(`/bookings/${body.id}`, {
      headers: { cookie: customerSession },
    });
    expect(((await nowExpired.json()) as { state: string }).state).toBe('EXPIRED');

    const effectFailure = await services.pool.query<{ count: string }>(
      `SELECT count(*) FROM booking.state_transitions WHERE booking_id = $1 AND reason = 'effect_failed'`,
      [body.id],
    );
    expect(Number(effectFailure.rows[0].count)).toBeGreaterThanOrEqual(1);
  });

  it('a CONFIRMED booking whose auto_complete_at has passed is claimed and transitions to COMPLETED', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
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
        addressLine: 'poller street 4',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(12),
        paymentMethodId: 'pm_test',
      }),
    });
    const body = (await res.json()) as { id: string };

    const accept = await app.request(`/bookings/${body.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    expect(accept.status).toBe(200);

    const confirmed = await services.pool.query<{ auto_complete_at: Date | null }>(
      `SELECT auto_complete_at FROM booking.bookings WHERE id = $1`,
      [body.id],
    );
    expect(confirmed.rows[0].auto_complete_at).not.toBeNull();

    await services.pool.query(
      `UPDATE booking.bookings SET auto_complete_at = now() - interval '1 minute' WHERE id = $1`,
      [body.id],
    );

    const result = await runDueWorkOnce(services);
    expect(result.autoCompletedBookings).toBeGreaterThanOrEqual(1);

    const fetched = await app.request(`/bookings/${body.id}`, {
      headers: { cookie: customerSession },
    });
    expect(((await fetched.json()) as { state: string }).state).toBe('COMPLETED');
    expect(stripe.paymentIntents.capture).toHaveBeenCalled();
  });

  it('PAY-006: a completed provider whose payout cadence has elapsed is paid out on schedule, and next_payout_at advances', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
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
        addressLine: 'poller street 6',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(15),
        paymentMethodId: 'pm_test',
      }),
    });
    const body = (await res.json()) as { id: string };
    const accept = await app.request(`/bookings/${body.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    expect(accept.status).toBe(200);
    await services.pool.query(
      `UPDATE booking.bookings SET auto_complete_at = now() - interval '1 minute' WHERE id = $1`,
      [body.id],
    );
    // Completes the booking (writes the ledger's net entry) without also
    // claiming the payout in the same tick — `seedListedProvider`'s
    // stub-complete already set next_payout_at 7 days out, so this first
    // tick can only exercise auto-complete.
    await runDueWorkOnce(services);

    const provider = await services.catalog.getById(providerId);
    const accountId = provider?.account_id as string;
    await services.pool.query(
      `UPDATE payments.connect_accounts SET next_payout_at = now() - interval '1 minute' WHERE account_id = $1`,
      [accountId],
    );

    const result = await runDueWorkOnce(services);
    expect(result.scheduledPayouts).toBeGreaterThanOrEqual(1);

    const payoutRow = await services.pool.query<{ status: string; triggered_by: string }>(
      `SELECT status, triggered_by FROM payments.payouts WHERE provider_account_id = $1`,
      [accountId],
    );
    expect(payoutRow.rows[0]).toMatchObject({ status: 'succeeded', triggered_by: 'schedule' });

    const accountRow = await services.pool.query<{ next_payout_at: Date }>(
      `SELECT next_payout_at FROM payments.connect_accounts WHERE account_id = $1`,
      [accountId],
    );
    expect(new Date(accountRow.rows[0].next_payout_at).getTime()).toBeGreaterThan(Date.now());

    // A second tick before the newly-advanced cadence has elapsed must not
    // reclaim the row and pay out again.
    const secondTick = await runDueWorkOnce(services);
    expect(secondTick.scheduledPayouts).toBe(0);
  });

  it('OBS-004: does not fire the orphan-authorization alarm when nothing is claimable, and fires it when a stray row is', async () => {
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
        addressLine: 'poller street 5',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(13),
        paymentMethodId: 'pm_test',
      }),
    });
    const body = (await res.json()) as { id: string };

    const alarms = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await runDueWorkOnce(services);
      expect(
        alarms.mock.calls.some((call) =>
          (call[0] as string).startsWith('ALARM:orphanAuthorizationReconcilerAction '),
        ),
      ).toBe(false);
      alarms.mockClear();

      // Nothing in this environment ever sets reauthorize_by on an
      // AUTHORIZED row (M4-Q4 named hole) — backdating it here manufactures
      // exactly the anomaly the alarm exists to catch.
      await services.pool.query(
        `UPDATE payments.authorizations SET reauthorize_by = now() - interval '1 minute' WHERE booking_id = $1`,
        [body.id],
      );

      await runDueWorkOnce(services);
      const line = alarms.mock.calls
        .map((call) => call[0] as string)
        .find((call) => call.startsWith('ALARM:orphanAuthorizationReconcilerAction '));
      expect(line).toBeDefined();
      const alarmLine = line as string;
      expect(
        JSON.parse(alarmLine.slice('ALARM:orphanAuthorizationReconcilerAction '.length)),
      ).toMatchObject({
        bookingId: body.id,
      });
    } finally {
      alarms.mockRestore();
      // The backdated reauthorize_by above stays claimable by every
      // subsequent poller tick for the rest of this file's run (this test
      // shares the DB with the other `it`s in this describe block) unless
      // cleared here.
      await services.pool.query(
        `UPDATE payments.authorizations SET reauthorize_by = NULL WHERE booking_id = $1`,
        [body.id],
      );
    }
  });

  it('OBS-004: fires the booking-expiry-spike alarm once 5 expiries land within the 10-minute window, not before', async () => {
    if (!app || !services) {
      return;
    }
    const bookingIds: string[] = [];
    for (let i = 0; i < 5; i += 1) {
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
          addressLine: `poller spike street ${i}`,
          accessNotes: '',
          lat: 32.08,
          lng: 34.78,
          slotStart: nearFutureSlot(14 + i),
          paymentMethodId: 'pm_test',
        }),
      });
      const body = (await res.json()) as { id: string };
      bookingIds.push(body.id);
    }
    await services.pool.query(
      `UPDATE booking.bookings SET response_deadline = now() - interval '1 minute' WHERE id = ANY($1)`,
      [bookingIds],
    );

    const alarms = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      for (let i = 0; i < 5; i += 1) {
        await runDueWorkOnce(services);
      }
      const fired = alarms.mock.calls.some((call) =>
        (call[0] as string).startsWith('ALARM:bookingExpirySpike '),
      );
      expect(fired).toBe(true);
    } finally {
      alarms.mockRestore();
    }
  });
});
