import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import pg from 'pg';

const api = 'http://127.0.0.1:4000';

function cookie(res: { headers: () => { [key: string]: string } }): string {
  return (res.headers()['set-cookie'] ?? '').split(';')[0] ?? '';
}

function uniqueIp(): string {
  const bytes = crypto.randomUUID().replace(/-/g, '');
  return `10.${parseInt(bytes.slice(0, 2), 16)}.${parseInt(bytes.slice(2, 4), 16)}.${parseInt(bytes.slice(4, 6), 16)}`;
}

function nearFutureSlot(hour: number): string {
  const date = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

async function seedListedProvider(request: APIRequestContext, name: string, locale: 'en' | 'he') {
  const email = `e2e-dec-${Date.now()}-${Math.random()}@example.com`;
  const register = await request.post(`${api}/auth/register`, {
    data: { email, password: 'long-enough-password', role: 'provider', locale },
    headers: { 'x-forwarded-for': uniqueIp() },
  });
  const session = cookie(register);
  const headers = { cookie: session };

  async function upload(kind: string, fileName: string) {
    await request.post(`${api}/catalog/me/documents`, {
      headers,
      multipart: {
        kind,
        file: { name: fileName, mimeType: 'image/png', buffer: Buffer.from(fileName) },
      },
    });
  }

  await upload('government_id', 'id.png');
  await upload('credential', 'cred.png');
  for (let i = 0; i < 5; i += 1) {
    await upload('portfolio', `p${i}.png`);
  }
  await request.post(`${api}/catalog/me/submit`, { headers });
  const me = (await (await request.get(`${api}/me`, { headers })).json()) as {
    account: { id: string };
  };
  const adminSignIn = await request.post(`${api}/auth/sign-in`, {
    data: { email: 'admin@shearly.local', password: 'change-me-admin-10' },
    headers: { 'x-forwarded-for': uniqueIp() },
  });
  const admin = cookie(adminSignIn);
  const queue = (await (
    await request.get(`${api}/admin/vetting`, { headers: { cookie: admin } })
  ).json()) as { queue: { id: string; account_id: string }[] };
  const row = queue.queue.find((item) => item.account_id === me.account.id);
  if (!row) {
    throw new Error('provider missing from vetting queue');
  }
  await request.post(`${api}/admin/vetting/${row.id}/decision`, {
    headers: { cookie: admin, 'content-type': 'application/json' },
    data: { action: 'interview', rationale: 'e2e' },
  });
  await request.post(`${api}/admin/vetting/${row.id}/decision`, {
    headers: { cookie: admin, 'content-type': 'application/json' },
    data: { action: 'approve', rationale: 'e2e' },
  });
  await request.patch(`${api}/catalog/me/profile`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: { displayName: name, bio: 'e2e', baseLat: 32.0853, baseLng: 34.7818, radiusKm: 10 },
  });
  const serviceRes = await request.post(`${api}/catalog/me/services`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: { name: 'Cut', description: '', durationMinutes: 60, priceMinor: 20000 },
  });
  const service = (await serviceRes.json()) as { service: { id: string } };
  await request.put(`${api}/availability/me/weekly`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: {
      rules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        startMinute: 0,
        endMinute: 1439,
      })),
    },
  });
  await request.post(`${api}/payments/me/connect/stub-complete`, { headers });
  const live = await request.post(`${api}/catalog/me/go-live`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: { listed: true },
  });
  if (live.status() !== 200) {
    throw new Error(`go-live failed: ${live.status()} ${await live.text()}`);
  }
  return { providerId: row.id, serviceId: service.service.id, providerSession: session, email };
}

async function registerCustomer(request: APIRequestContext, locale: 'en' | 'he') {
  const email = `e2e-dec-cust-${Date.now()}-${Math.random()}@example.com`;
  const res = await request.post(`${api}/auth/register`, {
    data: { email, password: 'long-enough-password', role: 'customer', locale },
    headers: { 'x-forwarded-for': uniqueIp() },
  });
  return { session: cookie(res), email };
}

async function createBooking(
  request: APIRequestContext,
  customerSession: string,
  providerId: string,
  serviceId: string,
  slotStartIso: string,
  addressLine: string,
) {
  const res = await request.post(`${api}/bookings`, {
    headers: { cookie: customerSession, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      providerId,
      serviceId,
      addressLine,
      accessNotes: 'gate code',
      lat: 32.0853,
      lng: 34.7818,
      slotStart: slotStartIso,
      paymentMethodId: 'pm_test',
    },
  });
  if (res.status() !== 201) {
    throw new Error(`booking create failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as { id: string };
}

const SIGN_IN_LABEL = { en: 'Sign in', he: 'התחברות' };
const EMAIL_LABEL = { en: 'Email', he: 'אימייל' };
const PASSWORD_LABEL = { en: 'Password', he: 'סיסמה' };
const DECLINE_BUTTON = { en: 'Decline', he: 'דחייה' };

async function signInAs(
  context: BrowserContext,
  email: string,
  locale: 'en' | 'he',
): Promise<import('@playwright/test').Page> {
  const page = await context.newPage();
  await page.goto(`/${locale}/sign-in`);
  await page.getByLabel(EMAIL_LABEL[locale]).fill(email);
  await page.getByLabel(PASSWORD_LABEL[locale]).fill('long-enough-password');
  await page.getByRole('button', { name: SIGN_IN_LABEL[locale] }).click();
  await page.waitForURL(new RegExp(`/${locale}/(account|provider)`), { timeout: 15_000 });
  return page;
}

// M5-P9c: M4-P9's own transaction-loop E2E already covers book/accept/
// complete/review (/he) and cancel (/en, via raw API + assertion, not the
// UI) — this extends both-locale coverage to the three outcomes that test
// never touched at all: decline, expiry, and cancel driven through the UI
// (still API-triggered here, since no customer-facing cancel button
// exists in the UI to click — same "not the UI, but UI-verified" shape
// M4-P9 itself already established for cancel).
test.describe('decline/expiry/cancel, both locales (M5-P9c)', () => {
  test('provider declines a PENDING booking through the UI, /en', async ({ browser, request }) => {
    test.setTimeout(60_000);
    const name = `E2E Decline EN ${Date.now()}`;
    const {
      providerId,
      serviceId,
      email: providerEmail,
    } = await seedListedProvider(request, name, 'en');
    const { session: customerSession } = await registerCustomer(request, 'en');
    const booking = await createBooking(
      request,
      customerSession,
      providerId,
      serviceId,
      nearFutureSlot(9),
      'm5-p9c decline en street',
    );

    const context = await browser.newContext();
    try {
      const page = await signInAs(context, providerEmail, 'en');
      const row = page.getByRole('listitem').filter({ hasText: 'PENDING' }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole('button', { name: DECLINE_BUTTON.en }).click();
      await expect(page.getByText('DECLINED')).toBeVisible({ timeout: 15_000 });
    } finally {
      await context.close();
    }

    const customerBooking = await request.get(`${api}/bookings/${booking.id}/cancel-consequence`, {
      headers: { cookie: customerSession },
    });
    // The booking is no longer PENDING/CONFIRMED, so its own cancel-
    // consequence route (which only makes sense pre-cancellation) 409s —
    // a cheap, already-existing way to confirm the state actually changed
    // server-side too, not just in the provider's own optimistic UI.
    expect(customerBooking.status()).toBeGreaterThanOrEqual(400);
  });

  test('provider declines a PENDING booking through the UI, /he', async ({ browser, request }) => {
    test.setTimeout(60_000);
    const name = `E2E Decline HE ${Date.now()}`;
    const {
      providerId,
      serviceId,
      email: providerEmail,
    } = await seedListedProvider(request, name, 'he');
    const { session: customerSession } = await registerCustomer(request, 'he');
    await createBooking(
      request,
      customerSession,
      providerId,
      serviceId,
      nearFutureSlot(10),
      'm5-p9c decline he street',
    );

    const context = await browser.newContext();
    try {
      const page = await signInAs(context, providerEmail, 'he');
      const row = page.getByRole('listitem').filter({ hasText: 'PENDING' }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole('button', { name: DECLINE_BUTTON.he }).click();
      await expect(page.getByText('DECLINED')).toBeVisible({ timeout: 15_000 });
    } finally {
      await context.close();
    }
  });

  test('a PENDING booking past its response deadline expires and the customer sees EXPIRED, /he', async ({
    page,
    request,
  }) => {
    // The due-work poller's first tick fires POLL_INTERVAL_MS (15s default)
    // after apps/api's own process startup, not from "now" — and the E2E
    // webServer reuses an already-running process across the whole suite,
    // so this test's actual wait until the next tick is unpredictable
    // (anywhere up to a full interval). Budget several cycles rather than
    // one, and poll by reloading rather than a single static wait.
    test.setTimeout(120_000);
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() });
    const name = `E2E Expiry HE ${Date.now()}`;
    const { providerId, serviceId } = await seedListedProvider(request, name, 'he');
    const { session: customerSession, email: customerEmail } = await registerCustomer(
      request,
      'he',
    );
    const booking = await createBooking(
      request,
      customerSession,
      providerId,
      serviceId,
      nearFutureSlot(11),
      'm5-p9c expiry he street',
    );

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      // No live poller trigger available over HTTP — backdate the response
      // deadline directly (same established pattern this suite already
      // uses for slot_start) and let the real due-work poller, already
      // running as part of the apps/api webServer, pick it up on its own
      // next tick rather than simulating the transition ourselves.
      await pool.query(
        `UPDATE booking.bookings SET response_deadline = now() - interval '1 hour' WHERE id = $1`,
        [booking.id],
      );
    } finally {
      await pool.end();
    }

    await page.goto('/he/sign-in');
    await page.getByLabel(EMAIL_LABEL.he).fill(customerEmail);
    await page.getByLabel(PASSWORD_LABEL.he).fill('long-enough-password');
    await page.getByRole('button', { name: SIGN_IN_LABEL.he }).click();
    await page.waitForURL(/\/he\/account/, { timeout: 15_000 });

    await expect
      .poll(
        async () => {
          await page.reload();
          const count = await page.getByText('EXPIRED').count();
          return count > 0;
        },
        { timeout: 90_000, intervals: [3_000] },
      )
      .toBe(true);
  });

  test('customer cancels a CONFIRMED booking outside the refund window; provider sees the cancellation, /en', async ({
    browser,
    request,
  }) => {
    test.setTimeout(60_000);
    const name = `E2E Cancel EN ${Date.now()}`;
    const {
      providerId,
      serviceId,
      providerSession,
      email: providerEmail,
    } = await seedListedProvider(request, name, 'en');
    const { session: customerSession } = await registerCustomer(request, 'en');
    const booking = await createBooking(
      request,
      customerSession,
      providerId,
      serviceId,
      nearFutureSlot(12),
      'm5-p9c cancel en street',
    );
    await request.patch(`${api}/bookings/${booking.id}/accept`, {
      headers: { cookie: providerSession },
    });

    const cancel = await request.patch(`${api}/bookings/${booking.id}/cancel`, {
      headers: { cookie: customerSession },
    });
    expect(cancel.status()).toBe(200);
    expect((await cancel.json()) as { state: string }).toMatchObject({
      state: 'CANCELLED_BY_CUSTOMER',
    });

    const context = await browser.newContext();
    try {
      const page = await signInAs(context, providerEmail, 'en');
      await expect(page.getByText('CANCELLED_BY_CUSTOMER')).toBeVisible({ timeout: 15_000 });
    } finally {
      await context.close();
    }
  });
});
