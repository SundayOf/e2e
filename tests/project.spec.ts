import { expect, test } from '@playwright/test';
import { ensureProject, openProject, projectName, signIn } from './helpers/scada';

test('Создание и открытие проекта', { tag: ['@project', '@base'] }, async ({ page }) => {
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  await expect(page.locator('[title="Дерево проекта"]')).toBeVisible();
});

test('Открытие руководства', { tag: ['@guide', '@base'] }, async ({ page }) => {
  await signIn(page);
  const helpPagePromise = page.waitForEvent('popup');
  await page.locator('#panel_right a[href="/help/ru/index.html"]').click();
  const helpPage = await helpPagePromise;
  await expect(helpPage).toHaveURL(/\/help\/ru\/index\.html$/);
  await expect(helpPage.getByRole('heading', { name: 'Руководство по работе с системой диспетчеризации OrangeScada' })).toBeVisible();
});
