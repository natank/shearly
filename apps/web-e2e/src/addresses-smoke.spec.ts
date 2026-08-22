import { expect, test } from '@playwright/test';

// identity's rate limiter is keyed by IP (design §6.7); give each test its
// own so aggregate registrations across the whole web-e2e suite never trip
// AUTH_RATE_LIMIT_MAX for a shared default IP.
function uniqueIp(): string {
  const bytes = crypto.randomUUID().replace(/-/g, '');
  return `10.${parseInt(bytes.slice(0, 2), 16)}.${parseInt(bytes.slice(2, 4), 16)}.${parseInt(bytes.slice(4, 6), 16)}`;
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() });
});

test('customer can save an address without a page error (M3-T09)', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));

  const email = `cus-addr-${Date.now()}@example.com`;
  await page.goto('/en/register');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill('long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/en\/account/);

  await page.locator('input[name="label"]').fill('Home');
  await page.locator('input[name="line"]').fill('tel aviv');
  await page.locator('input[name="notes"]').fill('gate 2');
  await page.getByRole('button', { name: 'Save address' }).click();

  await expect(page.getByText('Home · tel aviv')).toBeVisible();
  expect(errors).toHaveLength(0);

  await expect(page.locator('input[name="label"]')).toHaveValue('');
  await expect(page.locator('input[name="line"]')).toHaveValue('');
});
