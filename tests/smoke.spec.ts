import { expect, test } from '@playwright/test';

test('Открытие страницы входа', { tag: ['@access', '@base'] }, async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBe(true);
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
