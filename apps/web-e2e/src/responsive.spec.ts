import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const api = 'http://127.0.0.1:4000';

function cookie(res: { headers: () => { [key: string]: string } }): string {
  return (res.headers()['set-cookie'] ?? '').split(';')[0] ?? '';
}

function uniqueIp(): string {
  const bytes = crypto.randomUUID().replace(/-/g, '');
  return `10.${parseInt(bytes.slice(0, 2), 16)}.${parseInt(bytes.slice(2, 4), 16)}.${parseInt(bytes.slice(4, 6), 16)}`;
}

async function seedListedProvider(request: APIRequestContext, name: string) {
  const email = `e2e-responsive-${Date.now()}-${Math.random()}@example.com`;
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

/** NFR-UX-004: no horizontal scroll anywhere on the core flow at the
 * narrowest supported viewport (360px, the requirement's own floor). A
 * document wider than its own viewport is the standard, reliable signal
 * for a layout that broke at this width — checked directly against the
 * DOM rather than an eyeballed screenshot. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
}

test.describe('responsive at 360px (M5-P9b, NFR-UX-004)', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('discovery search has no horizontal overflow at 360px', async ({ page, request }) => {
    const name = `E2E Responsive ${Date.now()}`;
    await seedListedProvider(request, name);
    await page.goto('/en?lat=32.0853&lng=34.7818');
    await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalOverflow(page);
  });

  test('provider profile has no horizontal overflow at 360px', async ({ page, request }) => {
    const name = `E2E Responsive Profile ${Date.now()}`;
    const { providerId } = await seedListedProvider(request, name);
    await page.goto(`/en/providers/${providerId}`);
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalOverflow(page);
  });

  test('booking confirm screen has no horizontal overflow at 360px', async ({ page, request }) => {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() });
    const name = `E2E Responsive Confirm ${Date.now()}`;
    const { providerId, serviceId } = await seedListedProvider(request, name);
    const email = `e2e-responsive-cust-${Date.now()}@example.com`;
    await page.request.post(`${api}/auth/register`, {
      data: { email, password: 'long-enough-password', role: 'customer', locale: 'en' },
      headers: { 'x-forwarded-for': uniqueIp() },
    });
    const slotStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    slotStart.setUTCHours(9, 0, 0, 0);
    await page.goto(
      `/en/book/${providerId}/${serviceId}?slotStart=${encodeURIComponent(slotStart.toISOString())}`,
    );
    await expect(page.getByRole('heading', { name: 'Confirm your booking' })).toBeVisible({
      timeout: 15_000,
    });
    await expectNoHorizontalOverflow(page);
  });

  test('sign-in and register have no horizontal overflow at 360px', async ({ page }) => {
    await page.goto('/en/sign-in');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalOverflow(page);

    await page.goto('/en/register');
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible({
      timeout: 15_000,
    });
    await expectNoHorizontalOverflow(page);
  });
});
