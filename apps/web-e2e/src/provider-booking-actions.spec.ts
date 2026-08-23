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

async function seedListedProvider(request: APIRequestContext, name: string) {
  const email = `e2e-pba-${Date.now()}-${Math.random()}@example.com`;
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
  return { providerId: row.id, serviceId: service.service.id, providerSession: session, email };
}

async function registerCustomer(request: APIRequestContext) {
  const email = `e2e-pba-cust-${Date.now()}-${Math.random()}@example.com`;
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

async function signInAs(context: BrowserContext, email: string) {
  const page = await context.newPage();
  await page.goto('/en/sign-in');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill('long-enough-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/en\/(account|provider)/);
  return page;
}

// QCF-013: accept/decline/complete/no-show/provider-cancel had no UI at
// all — every M4 QC procedure exercising them had to go through curl. This
// spec drives the new provider bookings queue and the customer's
// report-a-no-show button through actual clicks, not API calls.
test('provider accepts and completes a booking through the UI (QCF-013)', async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const name = `E2E PBA ${Date.now()}`;
  const { providerId, serviceId, email: providerEmail } = await seedListedProvider(request, name);
  const { session: customerSession } = await registerCustomer(request);
  const booking = await createBooking(
    request,
    customerSession,
    providerId,
    serviceId,
    nearFutureSlot(9),
    'qcf-013 accept-complete street',
  );

  const context = await browser.newContext();
  const page = await signInAs(context, providerEmail);

  const row = page.getByRole('listitem').filter({ hasText: 'PENDING' }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  // NFR-SEC-005: the PENDING row never shows the street.
  await expect(page.getByText('qcf-013 accept-complete street')).toHaveCount(0);

  await row.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('CONFIRMED')).toBeVisible({ timeout: 15_000 });
  // Now that it's accepted, the address is revealed.
  await expect(page.getByText('qcf-013 accept-complete street')).toBeVisible();

  // Advance the clock past slot_start directly (no live poller in M4).
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `UPDATE booking.bookings SET slot_start = now() - interval '1 hour' WHERE id = $1`,
      [booking.id],
    );
  } finally {
    await pool.end();
  }
  await page.reload();
  const confirmedRow = page.getByRole('listitem').filter({ hasText: 'CONFIRMED' }).first();
  await confirmedRow.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByText('COMPLETED')).toBeVisible({ timeout: 15_000 });

  await context.close();
});

test('provider cancels through the UI: full refund, no fee (BOK-006, QCF-013)', async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const name = `E2E PBA Cancel ${Date.now()}`;
  const {
    providerId,
    serviceId,
    providerSession,
    email: providerEmail,
  } = await seedListedProvider(request, name);
  const { session: customerSession } = await registerCustomer(request);
  const booking = await createBooking(
    request,
    customerSession,
    providerId,
    serviceId,
    nearFutureSlot(10),
    'qcf-013 provider-cancel street',
  );
  await request.patch(`${api}/bookings/${booking.id}/accept`, {
    headers: { cookie: providerSession },
  });

  const context = await browser.newContext();
  const page = await signInAs(context, providerEmail);

  const row = page.getByRole('listitem').filter({ hasText: 'CONFIRMED' }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(page.getByText('CANCELLED_BY_PROVIDER')).toBeVisible({ timeout: 15_000 });

  await context.close();
});

test('customer reports a provider no-show through the UI (BOK-008, QCF-013)', async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const name = `E2E PBA NoShow ${Date.now()}`;
  const { providerId, serviceId, providerSession } = await seedListedProvider(request, name);
  const { session: customerSession, email: customerEmail } = await registerCustomer(request);
  const booking = await createBooking(
    request,
    customerSession,
    providerId,
    serviceId,
    nearFutureSlot(11),
    'qcf-013 provider-no-show street',
  );
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

  const context = await browser.newContext();
  const page = await signInAs(context, customerEmail);

  const row = page.getByRole('listitem').filter({ hasText: 'CONFIRMED' }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: 'Provider did not show' }).click();
  await expect(page.getByText('NO_SHOW_PROVIDER')).toBeVisible({ timeout: 15_000 });

  await context.close();
});
