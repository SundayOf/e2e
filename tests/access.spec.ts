import { expect, test } from '@playwright/test';
import { ensureProject, openProject, projectName, signIn, signOut, testUser } from './helpers/scada';

test('Выход из системы', { tag: ['@access', '@base'] }, async ({ page }) => {
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  const protectedUrl = page.url();

  await signOut(page);

  await page.goto(protectedUrl);
  await expect(page.getByRole('textbox', { name: 'Логин' })).toBeVisible();
  await expect(page.locator('#prjName').getByText(projectName, { exact: true })).toHaveCount(0);
});

test('Отказ во входе неизвестному пользователю', { tag: ['@access', '@base'] }, async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Логин' }).fill('e2e_missing_user');
  await page.locator('input[type="password"]').fill('invalid-e2e-password');
  await page.getByText('Вход', { exact: true }).click();
  await expect(page).toHaveURL(/\/login\/$/);
  await expect(page.getByRole('textbox', { name: 'Логин' })).toBeVisible();
  await expect(page.locator('#prjName').getByText(projectName, { exact: true })).toHaveCount(0);
});

test('Закрытие доступа к проектам и пользователям после выхода', { tag: ['@access', '@base', '@s01'] }, async ({ page }) => {
  await signIn(page);
  const projectsLoaded = page.waitForResponse(response => new URL(response.url()).pathname === '/edit_projects/' && response.ok());
  await ensureProject(page, projectName);
  const projectsUrl = (await projectsLoaded).url();
  const usersLoaded = page.waitForResponse(response => new URL(response.url()).pathname === '/edit_users/' && response.ok());
  await page.locator('#panel_right [title="Пользователи"]').click();
  const usersUrl = (await usersLoaded).url();
  const resources = [
    { url: projectsUrl, marker: `fn="${projectName}"` },
    { url: usersUrl, marker: `fl="${testUser().toLowerCase()}"` },
  ];
  const headers = { 'X-Requested-With': 'XMLHttpRequest', 'Cache-Control': 'no-store' };
  for (const { url, marker } of resources) {
    const before = await page.request.get(url, { headers, maxRedirects: 0 });
    expect(before.status()).toBe(200);
    expect(await before.text()).toContain(marker);
  }

  await signOut(page);

  for (const { url, marker } of resources) {
    const after = await page.request.get(url, { headers, maxRedirects: 0 });
    expect([302, 303, 401, 403]).toContain(after.status());
    expect(await after.text()).not.toContain(marker);
  }

  await signIn(page);
  await ensureProject(page, projectName);
  await expect(page.locator('#table_option').getByRole('cell', { name: projectName, exact: true })).toBeVisible();
});
