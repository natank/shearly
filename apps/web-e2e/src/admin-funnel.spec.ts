import { expect, test } from '@playwright/test';
import { adminBaseURL } from '../playwright.config.js';

const api = 'http://127.0.0.1:4000';

// M5-P8b: drives the new apps/admin OPS-006 funnel screen through actual
// browser clicks against the real API — exact stage-count matching is
// already covered at the API level (admin-routes.spec.ts's own scripted-
// sequence test), this confirms the screen itself renders live numbers.
test.describe('admin OPS-006 funnel UI (M5-P8b)', () => {
  test.use({ baseURL: adminBaseURL });

  test('the funnel view renders stage counts that increase after a real discovery search', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    await page.goto('/en');
    await page.locator('input[name="email"]').fill('admin@shearly.local');
    await page.locator('input[name="password"]').fill('change-me-admin-10');
    const [meResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/api/me'), { timeout: 15_000 }),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ]);
    expect(meResponse.ok()).toBe(true);

    await page.goto('/en/funnel');
    await expect(page.getByText(/Discovery searches: \d+/)).toBeVisible({ timeout: 15_000 });

    const beforeText = await page.getByText(/Discovery searches: \d+/).textContent();
    const before = Number(beforeText?.match(/\d+/)?.[0] ?? 0);

    await request.get(`${api}/discovery?lat=32.0853&lng=34.7818`);

    await expect
      .poll(
        async () => {
          await page.reload();
          const text = await page.getByText(/Discovery searches: \d+/).textContent();
          return Number(text?.match(/\d+/)?.[0] ?? 0);
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(before);
  });
});
