import { expect, test, type APIRequestContext } from '@playwright/test';

const api = 'http://127.0.0.1:4000';

function cookie(res: { headers: () => { [key: string]: string } }): string {
  return (res.headers()['set-cookie'] ?? '').split(';')[0] ?? '';
}

async function seedListedProvider(request: APIRequestContext, name: string) {
  const email = `e2e-${Date.now()}@example.com`;
  const register = await request.post(`${api}/auth/register`, {
    data: {
      email,
      password: 'long-enough-password',
      role: 'provider',
      locale: 'he',
    },
    headers: { 'x-forwarded-for': '203.0.113.90' },
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
  const provider = (await (
    await request.get(`${api}/catalog/me/application`, { headers })
  ).json()) as { status: string };
  const adminSignIn = await request.post(`${api}/auth/sign-in`, {
    data: { email: 'admin@shearly.local', password: 'change-me-admin-10' },
    headers: { 'x-forwarded-for': '203.0.113.91' },
  });
  const admin = cookie(adminSignIn);
  const queue = (await (
    await request.get(`${api}/admin/vetting`, { headers: { cookie: admin } })
  ).json()) as {
    queue: { id: string; account_id: string }[];
  };
  const row = queue.queue.find((item) => item.account_id === me.account.id);
  if (!row) {
    throw new Error(`provider missing from queue: ${provider.status}`);
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
  await request.post(`${api}/catalog/me/services`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: { name: 'Cut', description: '', durationMinutes: 60, priceMinor: 20000 },
  });
  await request.put(`${api}/availability/me/weekly`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: {
      rules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        startMinute: 540,
        endMinute: 1020,
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
  return row.id;
}

test('hebrew visitor finds an in-radius provider and slots', async ({ page, request }) => {
  const name = `E2E ${Date.now()}`;
  const id = await seedListedProvider(request, name);
  await page.goto(`/he?lat=32.0853&lng=34.7818`);
  await expect(page.getByRole('heading', { name: 'חיפוש סטייליסט' })).toBeVisible();
  await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'לפרופיל' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/he/providers/${id}`));
  await expect(page.getByText('200')).toBeVisible();
  await expect(page.getByText('כולל נסיעה')).toBeVisible();
});

test('english visitor sees an explicit out-of-area state', async ({ page }) => {
  await page.goto('/en?lat=0&lng=0');
  await expect(page.getByText(/Not yet in your area/)).toBeVisible({ timeout: 15_000 });
});
