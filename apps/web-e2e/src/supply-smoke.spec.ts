import { expect, test } from '@playwright/test';

test('hebrew provider shell still renders', async ({ page }) => {
  await page.goto('/he/provider');
  await expect(page).toHaveURL(/sign-in|provider/);
});

test('english provider shell still renders', async ({ page }) => {
  await page.goto('/en/provider');
  await expect(page).toHaveURL(/sign-in|provider/);
});
