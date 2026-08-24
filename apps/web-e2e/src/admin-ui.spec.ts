import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminBaseURL } from '../playwright.config.js';

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

async function seedListedProvider(request: APIRequestContext, name: string) {
  const email = `e2e-admin-${Date.now()}-${Math.random()}@example.com`;
  const register = await request.post(`${api}/auth/register`, {
    data: { email, password: 'long-enough-password', role: 'provider', locale: 'en' },
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
  return { providerId: row.id, serviceId: service.service.id };
}

async function registerCustomer(request: APIRequestContext) {
  const email = `e2e-admin-cust-${Date.now()}-${Math.random()}@example.com`;
  const res = await request.post(`${api}/auth/register`, {
    data: { email, password: 'long-enough-password', role: 'customer', locale: 'en' },
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

// M5-P6b: drives the new apps/admin OPS-002 screens (search, detail,
// exceptions + retry) through actual browser clicks against the real API,
// not just the API-level assertions M5-P6 already covers.
test.describe('admin OPS-002 UI (M5-P6b)', () => {
  test.use({ baseURL: adminBaseURL });

  async function signInAsAdmin(page: import('@playwright/test').Page) {
    await page.goto('/en');
    await page.locator('input[name="email"]').fill('admin@shearly.local');
    await page.locator('input[name="password"]').fill('change-me-admin-10');
    // SignInForm's onSubmit never navigates for the adminOnly form (see
    // libs/ui/feature-account/src/auth-forms.tsx), it just awaits sign-in +
    // /api/me and updates local state. waitForURL would resolve immediately
    // (we're already on /en) without ever waiting for the cookie to be set,
    // letting a subsequent goto() race ahead of it, so wait on the /api/me
    // response the form itself issues once sign-in succeeds instead.
    const [meResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/api/me'), { timeout: 15_000 }),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ]);
    if (!meResponse.ok()) {
      throw new Error(`admin sign-in /api/me failed: ${meResponse.status()}`);
    }
  }

  test('searching by address-bearing booking shows it, and opening the row reveals its state history', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const name = `E2E Admin ${Date.now()}`;
    const { providerId, serviceId } = await seedListedProvider(request, name);
    const { session: customerSession } = await registerCustomer(request);
    const addressLine = `admin-ui search street ${Date.now()}`;
    await createBooking(
      request,
      customerSession,
      providerId,
      serviceId,
      nearFutureSlot(9),
      addressLine,
    );

    await signInAsAdmin(page);
    await page.goto('/en/bookings');
    await page.locator('input[name="providerId"]').fill(providerId);
    await page.getByRole('button', { name: 'Search' }).click();

    const row = page.getByRole('listitem').filter({ hasText: 'PENDING' }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.click();
    await expect(page.getByText(addressLine)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'State history' })).toBeVisible();
  });

  test("a failed capture's retry button succeeds and the row disappears from the exceptions view", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const name = `E2E Admin Exceptions ${Date.now()}`;
    const { providerId, serviceId } = await seedListedProvider(request, name);
    const { session: customerSession } = await registerCustomer(request);
    const booking = await createBooking(
      request,
      customerSession,
      providerId,
      serviceId,
      nearFutureSlot(10),
      'admin-ui exceptions street',
    );

    const adminSignIn = await request.post(`${api}/auth/sign-in`, {
      data: { email: 'admin@shearly.local', password: 'change-me-admin-10' },
      headers: { 'x-forwarded-for': uniqueIp() },
    });
    const adminCookie = cookie(adminSignIn);

    // No live Stripe capture failure to trigger deterministically over
    // HTTP alone — the fixture directly marks the booking's authorize
    // operation as a failed capture, matching the shape
    // AuthorizationService.capture()'s own failure branch records
    // (amountMinor/currency alongside the message), so the exceptions
    // view and retry button have something real to act on.
    const pg = await import('pg');
    const pool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await pool.query(
        `INSERT INTO payments.operations (key, kind, booking_id, state, result)
         VALUES ($1, 'capture', $2, 'failed', $3::jsonb)`,
        [
          `capture:${booking.id}`,
          booking.id,
          JSON.stringify({ message: 'capture_failed', amountMinor: 20000, currency: 'ILS' }),
        ],
      );
    } finally {
      await pool.end();
    }

    await signInAsAdmin(page);
    await page.goto('/en/exceptions');

    const row = page.getByRole('listitem').filter({ hasText: booking.id });
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: 'Retry' }).click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });

    const exceptions = await request.get(`${api}/admin/exceptions`, {
      headers: { cookie: adminCookie },
    });
    const body = (await exceptions.json()) as { exceptions: { bookingId: string }[] };
    expect(body.exceptions.map((e) => e.bookingId)).not.toContain(booking.id);
  });
});
