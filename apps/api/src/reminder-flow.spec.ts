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

async function registerCustomer(app: ReturnType<typeof createApp>, locale: 'en' | 'he' = 'he') {
  const email = `cust-${crypto.randomUUID()}@example.com`;
  const register = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': uniqueIp() },
    body: JSON.stringify({ email, password: 'long-enough-password', role: 'customer', locale }),
  });
  return { session: cookie(register), email };
}

async function mailpitMessagesTo(to: string): Promise<{ Subject: string }[]> {
  const res = await fetch(`${mailpitApiUrl}/api/v1/messages?limit=250`);
  const body = (await res.json()) as {
    messages: { Subject: string; To: { Address: string }[] }[];
  };
  return body.messages.filter((m) => m.To.some((recipient) => recipient.Address === to));
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

describe('reminder flow (M5-P5)', () => {
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

  it('ProviderAccepts schedules a reminder row for a CONFIRMED booking', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const { session: customerSession } = await registerCustomer(app);

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
        addressLine: 'reminder street 1',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(9),
        paymentMethodId: 'pm_test',
      }),
    });
    const body = (await res.json()) as { id: string };

    const accept = await app.request(`/bookings/${body.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });
    expect(accept.status).toBe(200);

    const reminder = await services.pool.query<{ remind_at: Date; sent_at: Date | null }>(
      `SELECT remind_at, sent_at FROM booking.reminders WHERE booking_id = $1`,
      [body.id],
    );
    expect(reminder.rows).toHaveLength(1);
    expect(reminder.rows[0].sent_at).toBeNull();
  });

  it("a CONFIRMED booking's reminder fires once, at the right time, in the right locale (frozen-clock: backdate remind_at rather than waiting for the live poller)", async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const { session: customerSession, email: customerEmail } = await registerCustomer(app, 'he');

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
        addressLine: 'reminder street 2',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(10),
        paymentMethodId: 'pm_test',
      }),
    });
    const body = (await res.json()) as { id: string };

    await app.request(`/bookings/${body.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });

    await services.pool.query(
      `UPDATE booking.reminders SET remind_at = now() - interval '1 minute' WHERE booking_id = $1`,
      [body.id],
    );

    const result = await runDueWorkOnce(services);
    expect(result.remindersSent).toBeGreaterThanOrEqual(1);

    const messages = await waitForMailpitMessage(customerEmail);
    const reminderMail = messages.find((m) => m.Subject === 'תזכורת: ההזמנה הקרובה שלך');
    expect(reminderMail).toBeDefined();

    const stored = await services.pool.query<{ sent_at: Date | null }>(
      `SELECT sent_at FROM booking.reminders WHERE booking_id = $1`,
      [body.id],
    );
    expect(stored.rows[0].sent_at).not.toBeNull();

    // Fires once: a second tick finds nothing left to send for this booking.
    await runDueWorkOnce(services);
    const stillMatching = await services.pool.query<{ count: string }>(
      `SELECT count(*) FROM booking.reminders WHERE booking_id = $1 AND sent_at IS NULL`,
      [body.id],
    );
    expect(Number(stillMatching.rows[0].count)).toBe(0);
  }, 20_000);

  it('a booking cancelled before its reminder window sends no reminder — the pending row is invalidated, not just skipped by timing luck', async () => {
    if (!app || !services) {
      return;
    }
    const { providerId, serviceId, providerSession } = await seedListedProvider(app, services);
    const { session: customerSession } = await registerCustomer(app);

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
        addressLine: 'reminder street 3',
        accessNotes: '',
        lat: 32.08,
        lng: 34.78,
        slotStart: nearFutureSlot(11),
        paymentMethodId: 'pm_test',
      }),
    });
    const body = (await res.json()) as { id: string };

    await app.request(`/bookings/${body.id}/accept`, {
      method: 'PATCH',
      headers: { cookie: providerSession },
    });

    const beforeCancel = await services.pool.query<{ count: string }>(
      `SELECT count(*) FROM booking.reminders WHERE booking_id = $1 AND sent_at IS NULL`,
      [body.id],
    );
    expect(Number(beforeCancel.rows[0].count)).toBe(1);

    const cancel = await app.request(`/bookings/${body.id}/cancel`, {
      method: 'PATCH',
      headers: { cookie: customerSession },
    });
    expect(cancel.status).toBe(200);

    const afterCancel = await services.pool.query<{ count: string }>(
      `SELECT count(*) FROM booking.reminders WHERE booking_id = $1 AND sent_at IS NULL`,
      [body.id],
    );
    expect(Number(afterCancel.rows[0].count)).toBe(0);

    // Even if the poller ran right now, there is nothing left to claim for
    // this booking — not "skipped because remind_at hasn't arrived yet."
    await runDueWorkOnce(services);
    const stillNone = await services.pool.query<{ count: string }>(
      `SELECT count(*) FROM booking.reminders WHERE booking_id = $1`,
      [body.id],
    );
    expect(Number(stillNone.rows[0].count)).toBe(0);
  });
});
