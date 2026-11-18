import { expect, test } from './helpers/test';
import type { APIRequestContext } from '@playwright/test';
import { allowTagGroupWrite, expectTagAcl, getTestGroup, setTestGroup } from './helpers/access';
import { deleteVirtualDeviceIfPresent, ensureVirtualDevice, ensureVirtualTag, openDeviceTags, openDeviceTree, openProject, projectName, setTagValue, signIn, signInAsTest, signOut } from './helpers/scada';
import { replayUiPost } from './helpers/security';

test('Запрет записи тега из завершённого сеанса', { tag: ['@security', '@access', '@session', '@tags', '@sec06', '@base'] }, async ({ page, playwright, onCleanup }) => {
  test.setTimeout(90_000);
  const device = 'Контроль сессии';
  const tag = 'Уровень бака';
  const session: { role: 'admin' | 'operator' | 'none' } = { role: 'none' };
  let initialGroup: boolean | undefined;
  let staleClient: APIRequestContext | undefined;
  onCleanup(async () => {
    try {
      if (session.role === 'operator') {
        await signOut(page);
        session.role = 'none';
      }
      if (session.role === 'none') await signInAsTest(page);
      try {
        const valueForm = page.locator('#form_edit');
        if (await valueForm.isVisible()) await valueForm.locator('#form_cancel').click();
        await openProject(page, projectName);
        await deleteVirtualDeviceIfPresent(page, device);
        await openDeviceTree(page);
        await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
      } finally {
        if (initialGroup !== undefined) {
          await setTestGroup(page, initialGroup);
          expect(await getTestGroup(page)).toBe(initialGroup);
        }
      }
    } finally {
      await staleClient?.dispose();
    }
  });
  await test.step('Создать тег с правом записи для группы', async () => {
    await signInAsTest(page);
    session.role = 'admin';
    initialGroup = await getTestGroup(page);
    await setTestGroup(page, true);
    await openProject(page, projectName);
    await deleteVirtualDeviceIfPresent(page, device);
    await openDeviceTree(page);
    await ensureVirtualDevice(page, device);
    await openDeviceTags(page, device);
    const row = await ensureVirtualTag(page, { id: 2, name: tag, type: 'Float' });
    await expectTagAcl(page, row, 'user', false);
    await allowTagGroupWrite(page, row);
    await signOut(page);
    session.role = 'none';
    await signIn(page);
    session.role = 'operator';
    await openProject(page, projectName);
    await openDeviceTree(page);
    await openDeviceTags(page, device);
  });
  const cell = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name: tag, exact: true }) }).locator('td[id^="v"]');
  await expect(cell).toHaveText('0');
  const id = await cell.getAttribute('os_tag_id');
  expect(id).toBeTruthy();
  const captured = page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === `/set_value_tag/${id}/`, { timeout: 10_000 });
  await setTagValue(page, tag, 2);
  const source = await captured;
  const cookie = await source.headerValue('cookie');
  if (!cookie) throw new Error('Не удалось зафиксировать Cookie действующей сессии');
  // Отдельный клиент удерживает исходную Cookie, даже когда браузер очистит её при выходе.
  staleClient = await playwright.request.newContext({ ignoreHTTPSErrors: true, extraHTTPHeaders: { Cookie: cookie }, timeout: 10_000 });
  const oldSession = { request: staleClient };
  await test.step('Проверить запись с текущим сеансом', async () => {
    await setTagValue(page, tag, 1);
    expect((await replayUiPost(oldSession, source, source.url())).ok()).toBe(true);
    await expect(cell).toHaveText('2');
    await setTagValue(page, tag, 1);
    await expect(cell).toHaveText('1');
  });
  await test.step('Повторить тот же запрос после выхода', async () => {
    await signOut(page);
    session.role = 'none';
    const response = await replayUiPost(oldSession, source, source.url());
    await test.info().attach('Ответ записи после выхода', { body: String(response.status()), contentType: 'text/plain' });
  });
  await test.step('Войти заново, проверить значение и запись', async () => {
    await signIn(page);
    session.role = 'operator';
    await openProject(page, projectName);
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(cell).toHaveText('1');
    await setTagValue(page, tag, 3);
    await signOut(page);
    session.role = 'none';
    await signInAsTest(page);
    session.role = 'admin';
    await openProject(page, projectName);
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(cell).toHaveText('3');
  });
});
