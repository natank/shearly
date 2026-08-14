import { expect, test } from '@playwright/test';

const untranslatedKey = /common\.[A-Za-z]+/;

test('english shell is LTR and translated', async ({ page }) => {
  await page.goto('/en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shearly');
  await expect(page.locator('body')).not.toContainText(untranslatedKey);
});

test('hebrew shell is RTL and translated', async ({ page }) => {
  await page.goto('/he');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('שירלי');
  await expect(page.locator('body')).not.toContainText(untranslatedKey);
});
