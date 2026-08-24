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
    setupIntents: { create: vi.fn(async () => ({ id: 'si_1' })) },
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
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
      locale: 'en',
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
  return { session: cookie(register), email };
}

async function adminSession(
  app: ReturnType<typeof createApp>,
  services: ReturnType<typeof compose>,
) {
  const res = await app.request('/auth/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': uniqueIp() },
    body: JSON.stringify({
      email: services.config.adminSeedEmail,
      password: services.config.adminSeedPassword,
    }),
  });
  return cookie(res);
}

describe('admin routes (M5-P6, OPS-002)', () => {
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

  it('rejects a non-admin caller with AUTHORIZATION', async () => {
    if (!app) {
      return;
    }
    const { session: customerSession } = await registerCustomer(app);
    const res = await app.request('/admin/bookings', { headers: { cookie: customerSession } });
    expect(res.status).toBe(403);
  });

  it('searching by customer email, provider, state, and date range returns the right bookings', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId } = await seedListedProvider(app, services);
    const { session: customerSession, email: customerEmail } = await registerCustomer(app);
    const admin = await adminSession(app, services);

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
        addressLine: 'admin search street',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(9),
        paymentMethodId: 'pm_test',
      }),
    });
    const created = (await res.json()) as { id: string };

    const byEmail = await app.request(
      `/admin/bookings?customerEmail=${encodeURIComponent(customerEmail)}`,
      { headers: { cookie: admin } },
    );
    expect(byEmail.status).toBe(200);
    const byEmailBody = (await byEmail.json()) as { bookings: { id: string }[] };
    expect(byEmailBody.bookings.map((b) => b.id)).toContain(created.id);

    const byProviderAndState = await app.request(
      `/admin/bookings?providerId=${providerId}&state=PENDING`,
      { headers: { cookie: admin } },
    );
    const byProviderAndStateBody = (await byProviderAndState.json()) as {
      bookings: { id: string; state: string }[];
    };
    expect(byProviderAndStateBody.bookings.map((b) => b.id)).toContain(created.id);
    expect(byProviderAndStateBody.bookings.every((b) => b.state === 'PENDING')).toBe(true);

    const wrongEmail = await app.request(
      `/admin/bookings?customerEmail=${encodeURIComponent(`nobody-${crypto.randomUUID()}@example.com`)}`,
      { headers: { cookie: admin } },
    );
    const wrongEmailBody = (await wrongEmail.json()) as { bookings: { id: string }[] };
    expect(wrongEmailBody.bookings.map((b) => b.id)).not.toContain(created.id);
  });

  it('a booking detail view shows state history and payment rows matching the DB directly', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const { session: customerSession } = await registerCustomer(app);
    const admin = await adminSession(app, services);

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
        addressLine: 'admin detail street',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(10),
        paymentMethodId: 'pm_test',
      }),
    });
    const created = (await res.json()) as { id: string };

    await app.request(`/bookings/${created.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });

    const detail = await app.request(`/admin/bookings/${created.id}`, {
      headers: { cookie: admin },
    });
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      booking: { id: string; state: string };
      stateTransitions: { fromState: string; toState: string; event: string }[];
      operations: { key: string; kind: string; state: string }[];
    };
    expect(body.booking.id).toBe(created.id);
    expect(body.booking.state).toBe('CONFIRMED');
    expect(body.stateTransitions).toEqual([
      expect.objectContaining({
        fromState: 'PENDING',
        toState: 'CONFIRMED',
        event: 'ProviderAccepts',
      }),
    ]);
    expect(body.operations.some((op) => op.kind === 'authorize' && op.state === 'succeeded')).toBe(
      true,
    );

    const dbTransitions = await services.pool.query<{ event: string }>(
      `SELECT event FROM booking.state_transitions WHERE booking_id = $1`,
      [created.id],
    );
    expect(dbTransitions.rows.map((r) => r.event)).toEqual(
      body.stateTransitions.map((t) => t.event),
    );
  });

  it('a failed capture appears in the exceptions view; retrying it once succeeds; retrying the same operation twice is idempotent (no double-capture)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const { session: customerSession } = await registerCustomer(app);
    const admin = await adminSession(app, services);

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
        addressLine: 'admin exceptions street',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(11),
        paymentMethodId: 'pm_test',
      }),
    });
    const created = (await res.json()) as { id: string };

    await app.request(`/bookings/${created.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });

    vi.mocked(stripe.paymentIntents.capture).mockRejectedValueOnce(new Error('capture_failed'));

    await expect(services.authorizations.capture(created.id, 20000, 'ILS')).rejects.toMatchObject({
      code: 'PAYMENT',
    });

    const exceptions = await app.request('/admin/exceptions', { headers: { cookie: admin } });
    expect(exceptions.status).toBe(200);
    const exceptionsBody = (await exceptions.json()) as {
      exceptions: { key: string; bookingId: string; kind: string }[];
    };
    const found = exceptionsBody.exceptions.find(
      (e) => e.bookingId === created.id && e.kind === 'capture',
    );
    expect(found).toBeDefined();

    const retry = await app.request(`/admin/exceptions/${found?.key}/retry`, {
      method: 'POST',
      headers: { cookie: admin },
    });
    expect(retry.status).toBe(200);
    expect(stripe.paymentIntents.capture).toHaveBeenCalledTimes(2);

    const stillListed = await app.request('/admin/exceptions', { headers: { cookie: admin } });
    const stillListedBody = (await stillListed.json()) as {
      exceptions: { bookingId: string }[];
    };
    expect(stillListedBody.exceptions.map((e) => e.bookingId)).not.toContain(created.id);

    // Idempotent: retrying the now-succeeded operation again must not
    // re-call Stripe (no double-capture).
    const secondRetry = await app.request(`/admin/exceptions/${found?.key}/retry`, {
      method: 'POST',
      headers: { cookie: admin },
    });
    expect(secondRetry.status).toBe(200);
    expect(stripe.paymentIntents.capture).toHaveBeenCalledTimes(2);
  });

  it('a manual refund without a reason is rejected; with one it succeeds and shows up in the booking detail view (OPS-003)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const { session: customerSession } = await registerCustomer(app);
    const admin = await adminSession(app, services);
    const refundCallsBefore = vi.mocked(stripe.refunds.create).mock.calls.length;

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
        addressLine: 'admin manual refund street',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(12),
        paymentMethodId: 'pm_test',
      }),
    });
    const created = (await res.json()) as { id: string };

    await app.request(`/bookings/${created.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    await services.authorizations.capture(created.id, 20000, 'ILS');

    const missingReason = await app.request(`/admin/bookings/${created.id}/refund`, {
      method: 'POST',
      headers: { cookie: admin, 'content-type': 'application/json' },
      body: JSON.stringify({ amountMinor: 5000 }),
    });
    expect(missingReason.status).toBe(400);
    expect(vi.mocked(stripe.refunds.create).mock.calls.length - refundCallsBefore).toBe(0);

    const refunded = await app.request(`/admin/bookings/${created.id}/refund`, {
      method: 'POST',
      headers: { cookie: admin, 'content-type': 'application/json' },
      body: JSON.stringify({ amountMinor: 5000, reason: 'goodwill adjustment' }),
    });
    expect(refunded.status).toBe(200);
    expect(vi.mocked(stripe.refunds.create).mock.calls.length - refundCallsBefore).toBe(1);

    const detail = await app.request(`/admin/bookings/${created.id}`, {
      headers: { cookie: admin },
    });
    const detailBody = (await detail.json()) as {
      operations: { kind: string; state: string }[];
    };
    expect(
      detailBody.operations.some((op) => op.kind === 'refund' && op.state === 'succeeded'),
    ).toBe(true);

    const action = await services.pool.query<{ kind: string; amount_minor: number }>(
      `SELECT kind, amount_minor FROM payments.manual_actions WHERE booking_id = $1`,
      [created.id],
    );
    expect(action.rows).toEqual([{ kind: 'refund', amount_minor: 5000 }]);
  });

  it('reversing a disputed NO_SHOW_CUSTOMER outcome refunds the captured amount and re-nets the financial result (OPS-003)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const { session: customerSession } = await registerCustomer(app);
    const admin = await adminSession(app, services);
    const captureCallsBefore = vi.mocked(stripe.paymentIntents.capture).mock.calls.length;
    const refundCallsBefore = vi.mocked(stripe.refunds.create).mock.calls.length;

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
        addressLine: 'admin no-show reversal street',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(13),
        paymentMethodId: 'pm_test',
      }),
    });
    const created = (await res.json()) as { id: string };

    await app.request(`/bookings/${created.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    await services.pool.query(
      `UPDATE booking.bookings SET slot_start = now() - interval '1 hour' WHERE id = $1`,
      [created.id],
    );
    const noShow = await app.request(`/bookings/${created.id}/no-show`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    expect((await noShow.json()) as { state: string }).toMatchObject({
      state: 'NO_SHOW_CUSTOMER',
    });
    expect(vi.mocked(stripe.paymentIntents.capture).mock.calls.length - captureCallsBefore).toBe(1);

    const missingReason = await app.request(`/admin/bookings/${created.id}/reverse-no-show`, {
      method: 'POST',
      headers: { cookie: admin, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missingReason.status).toBe(400);

    const reversed = await app.request(`/admin/bookings/${created.id}/reverse-no-show`, {
      method: 'POST',
      headers: { cookie: admin, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'dispute upheld' }),
    });
    expect(reversed.status).toBe(200);
    expect(vi.mocked(stripe.refunds.create).mock.calls.length - refundCallsBefore).toBe(1);

    const auth = await services.pool.query<{ status: string }>(
      `SELECT status FROM payments.authorizations WHERE booking_id = $1`,
      [created.id],
    );
    expect(auth.rows[0].status).toBe('REFUNDED');

    const action = await services.pool.query<{ kind: string; amount_minor: number }>(
      `SELECT kind, amount_minor FROM payments.manual_actions WHERE booking_id = $1`,
      [created.id],
    );
    expect(action.rows).toEqual([{ kind: 'no_show_reversal', amount_minor: 20000 }]);
  });

  it('a manual payout moves the pending balance to paid-out, is idempotent against a double-click, and reflects in the earnings view (OPS-005)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const { session: customerSession } = await registerCustomer(app);
    const admin = await adminSession(app, services);

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
        addressLine: 'admin payout street',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(14),
        paymentMethodId: 'pm_test',
      }),
    });
    const created = (await res.json()) as { id: string };

    await app.request(`/bookings/${created.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    await services.pool.query(
      `UPDATE booking.bookings SET slot_start = now() - interval '1 hour' WHERE id = $1`,
      [created.id],
    );
    await app.request(`/bookings/${created.id}/complete`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });

    const noKey = await app.request(`/admin/providers/${providerId}/payout`, {
      method: 'POST',
      headers: { cookie: admin },
    });
    expect(noKey.status).toBe(400);

    const idempotencyKey = crypto.randomUUID();
    const payout = await app.request(`/admin/providers/${providerId}/payout`, {
      method: 'POST',
      headers: { cookie: admin, 'Idempotency-Key': idempotencyKey },
    });
    expect(payout.status).toBe(200);
    const payoutBody = (await payout.json()) as { payout: { amountMinor: number; id: string } };
    expect(payoutBody.payout.amountMinor).toBe(16000); // 20000 - 20% commission

    const earnings = await app.request('/provider/me/earnings', {
      headers: { cookie: providerSession },
    });
    const earningsBody = (await earnings.json()) as { paidOutMinor: number; pendingMinor: number };
    expect(earningsBody.paidOutMinor).toBe(16000);
    expect(earningsBody.pendingMinor).toBe(0);

    // Idempotent against a double-click: same key returns the same payout,
    // not a second one.
    const repeat = await app.request(`/admin/providers/${providerId}/payout`, {
      method: 'POST',
      headers: { cookie: admin, 'Idempotency-Key': idempotencyKey },
    });
    const repeatBody = (await repeat.json()) as { payout: { id: string } };
    expect(repeatBody.payout.id).toBe(payoutBody.payout.id);

    const earningsAfterRepeat = await app.request('/provider/me/earnings', {
      headers: { cookie: providerSession },
    });
    expect(((await earningsAfterRepeat.json()) as { paidOutMinor: number }).paidOutMinor).toBe(
      16000,
    );
  });

  it('a provider crossing the configured cancellation threshold is flagged in the standing view; one below it is not (OPS-004)', async () => {
    if (!app || !services) {
      return;
    }
    const currentApp = app;
    const currentServices = services;
    const { providerId, serviceId } = await seedListedProvider(app, services);
    const { providerId: quietProviderId, serviceId: quietServiceId } = await seedListedProvider(
      app,
      services,
    );
    const { session: customerSession } = await registerCustomer(app);
    const admin = await adminSession(app, services);

    async function bookAndCancel(pid: string, sid: string, hour: number, times: number) {
      const created = await currentApp.request('/bookings', {
        method: 'POST',
        headers: {
          cookie: customerSession,
          'content-type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          providerId: pid,
          serviceId: sid,
          addressLine: 'admin standing street',
          accessNotes: '',
          lat: 32.08,
          lng: 34.78,
          slotStart: nearFutureSlot(hour),
          paymentMethodId: 'pm_test',
        }),
      });
      const booking = (await created.json()) as { id: string };
      for (let i = 0; i < times; i += 1) {
        await currentServices.pool.query(
          `INSERT INTO booking.standing_events (booking_id, provider_id, kind)
           VALUES ($1, $2, 'provider_cancel')`,
          [booking.id, pid],
        );
      }
    }

    const threshold = services.config.standingCancellationThreshold;
    await bookAndCancel(providerId, serviceId, 15, threshold);
    await bookAndCancel(quietProviderId, quietServiceId, 16, threshold - 1);

    const standing = await app.request('/admin/standing', { headers: { cookie: admin } });
    expect(standing.status).toBe(200);
    const standingBody = (await standing.json()) as {
      providers: { providerId: string; cancellationCount: number; flagged: boolean }[];
    };
    const row = standingBody.providers.find((p) => p.providerId === providerId);
    expect(row).toMatchObject({ cancellationCount: threshold, flagged: true });
    const quietRow = standingBody.providers.find((p) => p.providerId === quietProviderId);
    expect(quietRow).toMatchObject({ cancellationCount: threshold - 1, flagged: false });
  });

  it('suspending a provider removes them from discovery while their CONFIRMED booking stays untouched and actionable via OPS-002 (OPS-004)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const { session: customerSession } = await registerCustomer(app);
    const admin = await adminSession(app, services);

    const created = await app.request('/bookings', {
      method: 'POST',
      headers: {
        cookie: customerSession,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        providerId,
        serviceId,
        addressLine: 'admin suspend street',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(17),
        paymentMethodId: 'pm_test',
      }),
    });
    const booking = (await created.json()) as { id: string };
    await app.request(`/bookings/${booking.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });

    const before = await app.request('/discovery?lat=32.08&lng=34.78', {
      headers: { cookie: customerSession },
    });
    const beforeBody = (await before.json()) as { providers: { id: string }[] };
    expect(beforeBody.providers.map((p) => p.id)).toContain(providerId);

    const suspend = await app.request(`/admin/providers/${providerId}/suspend`, {
      method: 'POST',
      headers: { cookie: admin },
    });
    expect(suspend.status).toBe(200);

    const after = await app.request('/discovery?lat=32.08&lng=34.78', {
      headers: { cookie: customerSession },
    });
    const afterBody = (await after.json()) as { providers: { id: string }[] };
    expect(afterBody.providers.map((p) => p.id)).not.toContain(providerId);

    const bookingDetail = await app.request(`/admin/bookings/${booking.id}`, {
      headers: { cookie: admin },
    });
    const bookingDetailBody = (await bookingDetail.json()) as { booking: { state: string } };
    expect(bookingDetailBody.booking.state).toBe('CONFIRMED');

    const relist = await app.request(`/admin/providers/${providerId}/relist`, {
      method: 'POST',
      headers: { cookie: admin },
    });
    expect(relist.status).toBe(200);
    const afterRelist = await app.request('/discovery?lat=32.08&lng=34.78', {
      headers: { cookie: customerSession },
    });
    const afterRelistBody = (await afterRelist.json()) as { providers: { id: string }[] };
    expect(afterRelistBody.providers.map((p) => p.id)).toContain(providerId);
  });

  it('funnel counts match a scripted sequence of discovery→booking events exactly (OPS-006)', async () => {
    if (!app || !services) {
      return;
    }
    const currentApp = app;
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const { session: customerSession } = await registerCustomer(app);
    const admin = await adminSession(app, services);

    type FunnelBody = {
      discoverySearches: number;
      profileViews: number;
      slotViews: number;
      bookingsCreated: number;
      bookingsConfirmed: number;
      bookingsCompleted: number;
    };
    async function readFunnel(): Promise<FunnelBody> {
      const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + 60 * 1000).toISOString();
      const res = await currentApp.request(
        `/admin/funnel?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: { cookie: admin } },
      );
      expect(res.status).toBe(200);
      return (await res.json()) as FunnelBody;
    }

    const before = await readFunnel();

    // Script the exact funnel sequence: discovery -> profile view -> slot
    // view -> booking created -> confirmed -> completed. Delta against the
    // "before" snapshot rather than an absolute count, so concurrent tests
    // in this same describe block (which also hit discovery/catalog/
    // booking routes) can't make this test's counts wrong — the plan's own
    // "matches a scripted sequence exactly" criterion is about this one
    // sequence producing exactly a +1 at each stage, not about the funnel
    // being empty beforehand.
    await app.request('/discovery?lat=32.08&lng=34.78', { headers: { cookie: customerSession } });
    await app.request(`/catalog/public/${providerId}`, { headers: { cookie: customerSession } });
    await app.request(`/catalog/public/${providerId}/services/${serviceId}/slots`, {
      headers: { cookie: customerSession },
    });
    const created = await app.request('/bookings', {
      method: 'POST',
      headers: {
        cookie: customerSession,
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        providerId,
        serviceId,
        addressLine: 'admin funnel street',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(18),
        paymentMethodId: 'pm_test',
      }),
    });
    const booking = (await created.json()) as { id: string };
    await app.request(`/bookings/${booking.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    await services.pool.query(
      `UPDATE booking.bookings SET slot_start = now() - interval '1 hour' WHERE id = $1`,
      [booking.id],
    );
    await app.request(`/bookings/${booking.id}/complete`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });

    const after = await readFunnel();
    expect(after.discoverySearches - before.discoverySearches).toBe(1);
    expect(after.profileViews - before.profileViews).toBe(1);
    expect(after.slotViews - before.slotViews).toBe(1);
    expect(after.bookingsCreated - before.bookingsCreated).toBe(1);
    expect(after.bookingsConfirmed - before.bookingsConfirmed).toBe(1);
    expect(after.bookingsCompleted - before.bookingsCompleted).toBe(1);
  });
});
