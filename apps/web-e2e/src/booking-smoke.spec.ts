import { expect, test, type APIRequestContext } from '@playwright/test';

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
  return { providerId: row.id, serviceId: service.service.id };
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

  await page.getByPlaceholder('תווית (למשל: בית)').fill('בית');
  await page.getByPlaceholder('כתובת').fill('tel aviv');
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
