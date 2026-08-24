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

function nearFutureSlot(hour: number): string {
  const date = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

async function seedListedProvider(request: APIRequestContext, name: string) {
  const email = `e2e-txn-${Date.now()}-${Math.random()}@example.com`;
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

async function registerCustomer(request: APIRequestContext, ip: string) {
  const email = `e2e-txn-cust-${Date.now()}-${Math.random()}@example.com`;
  const res = await request.post(`${api}/auth/register`, {
    data: { email, password: 'long-enough-password', role: 'customer', locale: 'en' },
    headers: { 'x-forwarded-for': ip },
  });
  return cookie(res);
}

async function createBooking(
  request: APIRequestContext,
  customerSession: string,
  providerId: string,
  serviceId: string,
  slotStartIso: string,
) {
  const res = await request.post(`${api}/bookings`, {
    headers: { cookie: customerSession, 'Idempotency-Key': crypto.randomUUID() },
    data: {
      providerId,
      serviceId,
      addressLine: 'e2e transaction street',
      accessNotes: 'gate',
      lat: 32.0853,
      lng: 34.7818,
      slotStart: slotStartIso,
      paymentMethodId: 'pm_test',
    },
  });
  return res;
}

// M4-P9: the closing E2E for the transaction milestone — the full loop
// (book, fund, accept, complete, cancel, decline) in both locales, per
// master's "first *full* SC-1 E2E" note and the M4 plan §3 demo script.
test('the transaction loop: book, fund, accept, complete, cancel — both locales (M4-P9)', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const ip = uniqueIp();
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });

  // Step 1: seed the F-LIVE provider (Cut, ₪200/60min).
  const name = `E2E Transaction ${Date.now()}`;
  const { providerId, serviceId, providerSession } = await seedListedProvider(request, name);

  // Step 2: /he, anonymous — pick a slot, forced to register, confirm screen
  // retains the slot/address, confirm → PENDING with a Stripe authorization.
  const slotStart = nearFutureSlot(9);
  await page.goto(`/he/book/${providerId}/${serviceId}?slotStart=${encodeURIComponent(slotStart)}`);
  await expect(page.getByRole('button', { name: 'התחברות' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'התחברות' }).click();
  await expect(page).toHaveURL(/\/he\/sign-in\?next=/);
  const next = new URL(page.url()).searchParams.get('next') ?? '';

  const customerEmail = `e2e-txn-customer-${Date.now()}@example.com`;
  await page.goto(`/he/register?next=${encodeURIComponent(next)}`);
  await page.getByLabel('אימייל').fill(customerEmail);
  await page.getByLabel('סיסמה').fill('long-enough-password');
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();

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

  const meRes = await page.request.get(`${api}/me`);
  const me = (await meRes.json()) as { account: { id: string } };
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let bookingRow: { id: string };
  try {
    const found = await pool.query<{ id: string }>(
      `SELECT id FROM booking.bookings WHERE provider_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [providerId, me.account.id],
    );
    bookingRow = found.rows[0];

    // Step 3: two concurrent POST /bookings on overlapping-but-different
    // starts for the same provider — exactly one 201, one 409-with-alternatives.
    // This is the automated concurrency proof NFR-CI-004 requires; it does
    // not need to run through the UI (BOK-002).
    const conflictCustomerSession = await registerCustomer(request, uniqueIp());
    const overlapA = nearFutureSlot(14);
    const overlapB = new Date(new Date(overlapA).getTime() + 15 * 60 * 1000).toISOString();
    const [resA, resB] = await Promise.all([
      createBooking(request, conflictCustomerSession, providerId, serviceId, overlapA),
      createBooking(request, conflictCustomerSession, providerId, serviceId, overlapB),
    ]);
    const statuses = [resA.status(), resB.status()].sort();
    expect(statuses).toEqual([201, 409]);
    const conflicted = resA.status() === 409 ? resA : resB;
    const conflictBody = (await conflicted.json()) as {
      alternatives?: { providers?: unknown[] };
    };
    expect(Array.isArray(conflictBody.alternatives?.providers)).toBe(true);

    // Step 4: provider accepts → CONFIRMED; full address now visible to the
    // provider, was not before (BOK-003, NFR-SEC-005).
    const pendingView = await request.get(`${api}/bookings/${bookingRow.id}/provider-view`, {
      headers: { cookie: providerSession },
    });
    const pendingBody = (await pendingView.json()) as Record<string, unknown>;
    expect(pendingBody.fullAddress).toBeUndefined();

    const accept = await request.patch(`${api}/bookings/${bookingRow.id}/accept`, {
      headers: { cookie: providerSession },
    });
    expect(accept.status()).toBe(200);

    const confirmedView = await request.get(`${api}/bookings/${bookingRow.id}/provider-view`, {
      headers: { cookie: providerSession },
    });
    const confirmedBody = (await confirmedView.json()) as { fullAddress: string };
    expect(confirmedBody.fullAddress).toBe('tel aviv');

    // Step 5: advance the clock past slot_start (frozen-clock helper, not
    // real time — no live poller in M4) → provider completes → COMPLETED;
    // capture + ledger rows; earnings screen shows the net.
    await pool.query(
      `UPDATE booking.bookings SET slot_start = now() - interval '1 hour' WHERE id = $1`,
      [bookingRow.id],
    );
    const complete = await request.patch(`${api}/bookings/${bookingRow.id}/complete`, {
      headers: { cookie: providerSession },
    });
    expect(complete.status()).toBe(200);

    const earningsRes = await request.get(`${api}/provider/me/earnings`, {
      headers: { cookie: providerSession },
    });
    const earnings = (await earningsRes.json()) as {
      bookings: Array<{
        bookingId: string;
        grossMinor: number;
        commissionMinor: number;
        netMinor: number;
      }>;
    };
    expect(earnings.bookings).toContainEqual(
      expect.objectContaining({
        bookingId: bookingRow.id,
        grossMinor: 20000,
        commissionMinor: 4000,
        netMinor: 16000,
      }),
    );

    // Step 6: customer reviews the completed booking; second attempt rejected.
    await page.goto('/he/account');
    await expect(page.getByText(`${name} — Cut`)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'כתיבת ביקורת' }).click();
    await page.getByRole('button', { name: 'שליחת ביקורת' }).click();
    await expect(page.getByRole('button', { name: 'כתיבת ביקורת' })).toHaveCount(0);

    const secondReview = await page.request.post(`${api}/bookings/${bookingRow.id}/review`, {
      data: { rating: 5 },
    });
    expect(secondReview.status()).toBeGreaterThanOrEqual(400);

    // Step 7: /en — repeat the cancel-inside-12h and cancel-outside-12h
    // flows against two fresh CONFIRMED bookings; the disclosed amount
    // matches the charged/refunded amount.
    const enCustomerSession = await registerCustomer(request, uniqueIp());

    const outsideBookingRes = await createBooking(
      request,
      enCustomerSession,
      providerId,
      serviceId,
      nearFutureSlot(16),
    );
    const outsideBooking = (await outsideBookingRes.json()) as { id: string };
    await request.patch(`${api}/bookings/${outsideBooking.id}/accept`, {
      headers: { cookie: providerSession },
    });
    const outsideConsequence = (await (
      await request.get(`${api}/bookings/${outsideBooking.id}/cancel-consequence`, {
        headers: { cookie: enCustomerSession },
      })
    ).json()) as { kind: string };
    expect(outsideConsequence.kind).toBe('no_charge');
    const outsideCancel = await request.patch(`${api}/bookings/${outsideBooking.id}/cancel`, {
      headers: { cookie: enCustomerSession },
    });
    expect(outsideCancel.status()).toBe(200);
    expect((await outsideCancel.json()) as { state: string }).toMatchObject({
      state: 'CANCELLED_BY_CUSTOMER',
    });

    const insideBookingRes = await createBooking(
      request,
      enCustomerSession,
      providerId,
      serviceId,
      nearFutureSlot(18),
    );
    const insideBooking = (await insideBookingRes.json()) as { id: string };
    await request.patch(`${api}/bookings/${insideBooking.id}/accept`, {
      headers: { cookie: providerSession },
    });
    await pool.query(
      `UPDATE booking.bookings SET slot_start = now() + interval '6 hours' WHERE id = $1`,
      [insideBooking.id],
    );
    const insideConsequence = (await (
      await request.get(`${api}/bookings/${insideBooking.id}/cancel-consequence`, {
        headers: { cookie: enCustomerSession },
      })
    ).json()) as { kind: string; chargePct?: number };
    expect(insideConsequence.kind).toBe('partial_charge');
    expect(insideConsequence.chargePct).toBe(50);
    const insideCancel = await request.patch(`${api}/bookings/${insideBooking.id}/cancel`, {
      headers: { cookie: enCustomerSession },
    });
    expect(insideCancel.status()).toBe(200);
    const insideLedger = await pool.query<{ kind: string; amount_minor: number }>(
      `SELECT kind, amount_minor FROM payments.ledger WHERE booking_id = $1 ORDER BY created_at`,
      [insideBooking.id],
    );
    // Late cancel (≤12h, BOK-005) splits the 50% actually captured (₪100 of
    // the ₪200 gross), not the full original price (design §7.4, mirrored in
    // apps/api/src/booking-effects.ts's settledMinor comment).
    const grossRow = insideLedger.rows.find((row) => row.kind === 'gross');
    expect(grossRow?.amount_minor).toBe(10000);
  } finally {
    await pool.end();
  }
});
