import { expect, test } from '@playwright/test';

test('hebrew customer register lands on the customer surface', async ({ page }) => {
  const email = `cus-${Date.now()}@example.com`;
  await page.goto('/he/register');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill('long-enough-password');
  await page.getByRole('button', { name: 'יצירת חשבון' }).click();
  await expect(page).toHaveURL(/\/he\/account/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('החשבון שלך');
  await page.getByRole('button', { name: 'התנתקות' }).click();
  await expect(page).toHaveURL(/\/he\/?$/);
  await page.getByRole('link', { name: 'התחברות' }).click();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill('long-enough-password');
  await page.getByRole('button', { name: 'התחברות' }).click();
  await expect(page).toHaveURL(/\/he\/account/);
});

test('english provider register lands on the provider surface', async ({ page }) => {
  const email = `prv-${Date.now()}@example.com`;
  await page.goto('/en/register');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill('long-enough-password');
  await page.locator('input[name="role"][value="provider"]').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/en\/provider/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Provider home');
});

test('invalid sign-in stays generic', async ({ page }) => {
  await page.goto('/en/sign-in');
  await page.locator('input[name="email"]').fill('nobody@example.com');
  await page.locator('input[name="password"]').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('does not exist');
});
