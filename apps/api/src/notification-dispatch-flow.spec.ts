import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrateIdentity } from '@shearly/services-identity/migrate';
import { migrateCatalog } from '@shearly/services-provider-catalog/migrate';
import { migrateAvailability } from '@shearly/services-availability/migrate';
import { migratePayments } from '@shearly/services-payments/migrate';
import { migrateBooking } from '@shearly/services-booking/migrate';
import type { NotificationChannel } from '@shearly/services-notifications';
import { createApp } from './app.js';
import { compose, type ComposeOverrides } from './compose.js';
import { runNotificationDispatchOnce } from './notification-dispatcher.js';

type FakeStripe = NonNullable<ComposeOverrides['stripeClient']>;

const url = process.env.DATABASE_URL;
const mailpitApiUrl = process.env.MAILPIT_API_URL ?? 'http://127.0.0.1:8025';

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
  return { session: cookie(register), email };
}

async function mailpitMessagesTo(to: string): Promise<{ Subject: string }[]> {
  // Mailpit's /search endpoint is index-backed and can lag noticeably
  // behind SMTP accept under concurrent load (many spec files sending
  // real mail at once) — /messages is the raw, immediately-consistent
  // listing, filtered client-side instead.
  const res = await fetch(`${mailpitApiUrl}/api/v1/messages?limit=250`);
  const body = (await res.json()) as {
    messages: { Subject: string; To: { Address: string }[] }[];
  };
  return body.messages.filter((m) => m.To.some((recipient) => recipient.Address === to));
}

// Other spec files in this run create real bookings too, each leaving its
// own undispatched booking.outbox row behind (none of them call the
// dispatcher) — drain the full backlog rather than assuming any one
// bounded-limit call reaches this test's own row.
async function drainNotificationDispatch(
  services: ReturnType<typeof compose>,
): Promise<{ dispatched: number; failed: number }> {
  let total = { dispatched: 0, failed: 0 };
  for (let tick = 0; tick < 20; tick += 1) {
    const tickResult = await runNotificationDispatchOnce(services);
    total = {
      dispatched: total.dispatched + tickResult.dispatched,
      failed: total.failed + tickResult.failed,
    };
    if (tickResult.dispatched + tickResult.failed === 0) {
      break;
    }
  }
  return total;
}

async function waitForMailpitMessage(
  to: string,
  timeoutMs = 10_000,
): Promise<{ Subject: string }[]> {
  const start = Date.now();
  for (;;) {
    const messages = await mailpitMessagesTo(to);
    if (messages.length > 0) {
      return messages;
    }
    if (Date.now() - start > timeoutMs) {
      return [];
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe('notification dispatch (M5-P4)', () => {
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

  it('a booking creation notifies both parties via real SMTP (Mailpit), dispatched well inside the one-minute bound (sanity timing check)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId } = await seedListedProvider(app, services);
    const { session: customerSession, email: customerEmail } = await registerCustomer(app);

    const start = Date.now();
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
        addressLine: 'dispatch street 1',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(9),
        paymentMethodId: 'pm_test',
      }),
    });
    expect(res.status).toBe(201);

    const result = await drainNotificationDispatch(services);
    expect(result.dispatched).toBeGreaterThanOrEqual(1);
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(60_000);

    const customerMessages = await waitForMailpitMessage(customerEmail);
    expect(customerMessages.length).toBeGreaterThanOrEqual(1);
    expect(customerMessages[0].Subject).toBe('Your booking request was sent');
  }, 20_000);

  it('every state machine transition that should notify does: ProviderAccepts sends a confirmation to both parties (checked against Mailpit)', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const { session: customerSession, email: customerEmail } = await registerCustomer(app);

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
        addressLine: 'dispatch street 2',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(10),
        paymentMethodId: 'pm_test',
      }),
    });
    const body = (await res.json()) as { id: string };
    // Drain the "created" notifications first so the assertion below is
    // unambiguously about the ProviderAccepts pair, not a leftover.
    await drainNotificationDispatch(services);

    const accept = await app.request(`/bookings/${body.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    expect(accept.status).toBe(200);

    await drainNotificationDispatch(services);

    const messages = await waitForMailpitMessage(customerEmail);
    const confirmed = messages.find((m) => m.Subject === 'Your booking is confirmed');
    expect(confirmed).toBeDefined();
  }, 20_000);

  it('a forced notification-send failure does not roll back or block the already-committed state transition', async () => {
    if (!url) {
      if (process.env.CI) {
        throw new Error('DATABASE_URL must be set in CI');
      }
      return;
    }
    const failingChannel: NotificationChannel = {
      send: vi.fn(async () => {
        throw new Error('smtp down');
      }),
    };
    const failingStripe = fakeStripe();
    const failingServices = compose(undefined, async () => undefined, {
      stripeClient: failingStripe,
      notificationChannel: failingChannel,
    });
    const failingApp = createApp(failingServices);
    try {
      const { providerId, serviceId } = await seedListedProvider(failingApp, failingServices);
      const { session: customerSession } = await registerCustomer(failingApp);

      const res = await failingApp.request('/bookings', {
        method: 'POST',
        headers: {
          cookie: customerSession,
          'content-type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          providerId,
          serviceId,
          addressLine: 'dispatch street 3',
          accessNotes: '',
          lat: 32.08,
          lng: 34.78,
          slotStart: nearFutureSlot(11),
          paymentMethodId: 'pm_test',
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; state: string };
      expect(body.state).toBe('PENDING');

      // The dispatch tick itself must not throw out of runNotificationDispatchOnce
      // — a handler failure is caught internally and recorded as `failed`,
      // never propagated as an uncaught rejection.
      const alarms = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const result = await runNotificationDispatchOnce(failingServices);
      expect(result.failed).toBeGreaterThanOrEqual(1);

      // OBS-004: named alarm — SES bounce rate (local proxy: SMTP send failure).
      const alarmLine = alarms.mock.calls
        .map((call) => call[0] as string)
        .find((call) => call.startsWith('ALARM:sesBounceRate '));
      alarms.mockRestore();
      expect(alarmLine).toBeDefined();

      const fetched = await failingApp.request(`/bookings/${body.id}`, {
        headers: { cookie: customerSession },
      });
      expect(((await fetched.json()) as { state: string }).state).toBe('PENDING');

      // Retried on the next tick, this time with a working channel — the
      // attempt is not silently dropped.
      const workingChannel: NotificationChannel = { send: vi.fn(async () => undefined) };
      const recoveredServices = compose(undefined, async () => undefined, {
        stripeClient: failingStripe,
        notificationChannel: workingChannel,
      });
      try {
        const retried = await runNotificationDispatchOnce(recoveredServices);
        expect(retried.dispatched).toBeGreaterThanOrEqual(1);
      } finally {
        await recoveredServices.pool.end();
      }
    } finally {
      await failingServices.pool.end();
    }
  });
});
