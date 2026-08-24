import { expect, test, type APIRequestContext } from '@playwright/test';
import pg from 'pg';

const api = 'http://127.0.0.1:4000';

function cookie(res: { headers: () => { [key: string]: string } }): string {
  return (res.headers()['set-cookie'] ?? '').split(';')[0] ?? '';
}

function uniqueIp(): string {
  const bytes = crypto.randomUUID().replace(/-/g, '');
  return `10.${parseInt(bytes.slice(0, 2), 16)}.${parseInt(bytes.slice(2, 4), 16)}.${parseInt(bytes.slice(4, 6), 16)}`;
}

async function seedListedProvider(request: APIRequestContext, name: string) {
  const email = `e2e-book-${Date.now()}-${Math.random()}@example.com`;
  const register = await request.post(`${api}/auth/register`, {
    data: { email, password: 'long-enough-password', role: 'provider', locale: 'he' },
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
  return { providerId: row.id, serviceId: service.service.id, providerSession: session };
}

test('anonymous visitor picks a slot, authenticates mid-flow, and lands back on the same confirm screen (CUS-001)', async ({
  page,
  request,
}) => {
  // The customer's register step below goes through the real browser (no
  // spoofable IP via `request.post`) — give this test's browser context its
  // own IP so it never shares identity's rate-limit bucket with other specs.
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() });

  const name = `E2E Book ${Date.now()}`;
  const { providerId, serviceId } = await seedListedProvider(request, name);

  const slotStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  slotStart.setUTCHours(9, 0, 0, 0);

  await page.goto(
    `/he/book/${providerId}/${serviceId}?slotStart=${encodeURIComponent(slotStart.toISOString())}`,
  );

  // Not authenticated yet: the confirm screen asks to sign in, not before.
  await expect(page.getByRole('button', { name: 'התחברות' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'התחברות' }).click();
  await expect(page).toHaveURL(/\/he\/sign-in\?next=/);
  const next = new URL(page.url()).searchParams.get('next') ?? '';

  const email = `e2e-customer-${Date.now()}@example.com`;
  await page.goto(`/he/register?next=${encodeURIComponent(next)}`);
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה').fill('long-enough-password');
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();

  // Back on the same confirm screen — the slot is still the one originally picked.
  await expect(page).toHaveURL(new RegExp(`/he/book/${providerId}/${serviceId}`));
  await expect(page.getByRole('heading', { name: 'אישור ההזמנה' })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByLabel('תווית (למשל: בית)').fill('בית');
  await page.getByLabel('כתובת', { exact: true }).fill('tel aviv');
  await page.getByRole('button', { name: 'שמירת כתובת' }).click();

  await expect(page.getByRole('button', { name: 'אישור ותשלום' })).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'אישור ותשלום' }).click();

  await expect(page.getByRole('heading', { name: 'ההזמנה נשלחה' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('PENDING')).toBeVisible();
});

// QCF-012: on the very first booking (no saved addresses yet), the guest
// draft's address was restored into component state but never surfaced in
// the UI — the screen showed only an empty "add a new address" form, as
// though the address had to be re-entered. Confirms the restored address
// is now visibly shown once the visitor lands back on the confirm screen.
test('the guest-draft address is visibly shown on return, not silently restored (QCF-012)', async ({
  page,
  request,
}) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() });

  const name = `E2E Draft Address ${Date.now()}`;
  const { providerId, serviceId } = await seedListedProvider(request, name);

  const slotStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  slotStart.setUTCHours(10, 0, 0, 0);

  await page.goto(
    `/he/book/${providerId}/${serviceId}?slotStart=${encodeURIComponent(slotStart.toISOString())}`,
  );

  // As a guest, before authenticating: fill the plain address input.
  await page.getByLabel('כתובת').fill('draft street 42');
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/he\/register\?next=/);

  const email = `e2e-draft-addr-${Date.now()}@example.com`;
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה').fill('long-enough-password');
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();

  // Back on the confirm screen, now authenticated: the restored address is
  // visibly shown, not just usable — this is the account's first booking,
  // so the address book is empty and the address doesn't appear as a saved
  // radio option; it must appear as its own visible line instead.
  await expect(page).toHaveURL(new RegExp(`/he/book/${providerId}/${serviceId}`));
  await expect(page.getByText('draft street 42')).toBeVisible({ timeout: 15_000 });
});

test('a completed booking shows in account history and can be reviewed once (CUS-006, RAT-001)', async ({
  page,
  request,
}) => {
  const ip = uniqueIp();
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });

  const name = `E2E History ${Date.now()}`;
  const { providerId, serviceId, providerSession } = await seedListedProvider(request, name);

  // Register the customer through the browser's own request context so the
  // resulting session cookie is already in page's cookie jar — no manual
  // cookie copying needed for the page.goto('/en/account') below.
  const customerEmail = `e2e-history-${Date.now()}@example.com`;
  await page.request.post(`${api}/auth/register`, {
    data: {
      email: customerEmail,
      password: 'long-enough-password',
      role: 'customer',
      locale: 'en',
    },
    headers: { 'x-forwarded-for': ip },
  });

  const slotStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  slotStart.setUTCHours(9, 0, 0, 0);
  const created = await page.request.post(`${api}/bookings`, {
    headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    data: {
      providerId,
      serviceId,
      addressLine: 'e2e history street',
      accessNotes: '',
      lat: 32.0853,
      lng: 34.7818,
      slotStart: slotStart.toISOString(),
      paymentMethodId: 'pm_test',
    },
  });
  const booking = (await created.json()) as { id: string };

  // Provider accepts, then the booking is completed. No live poller in M4
  // (see M4 plan §7) — nudge slot_start into the past directly, the same
  // frozen-clock trick apps/api's own booking-provider-flow.spec.ts uses.
  await request.patch(`${api}/bookings/${booking.id}/accept`, {
    headers: { cookie: providerSession },
  });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `UPDATE booking.bookings SET slot_start = now() - interval '1 hour' WHERE id = $1`,
      [booking.id],
    );
  } finally {
    await pool.end();
  }
  const completeRes = await request.patch(`${api}/bookings/${booking.id}/complete`, {
    headers: { cookie: providerSession },
  });
  expect(completeRes.status()).toBe(200);

  await page.goto('/en/account');
  await expect(page.getByText(`${name} — Cut`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('COMPLETED')).toBeVisible();

  await page.getByRole('button', { name: 'Leave a review' }).click();
  await page.getByRole('button', { name: 'Submit review' }).click();
  await expect(page.getByRole('button', { name: 'Leave a review' })).toHaveCount(0);
});
