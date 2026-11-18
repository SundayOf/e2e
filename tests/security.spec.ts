import { expect, test } from './helpers/test';
import { allowTagGroupWrite, expectTagAcl, getTestGroup, openTestUsers, setTestGroup, testUserRow } from './helpers/access';
import { replayUiPost } from './helpers/security';
import { deleteVirtualDeviceIfPresent, ensureVirtualDevice, ensureVirtualTag, openDeviceTags, openDeviceTree, openProject, projectName, renameVirtualDevice, setTagValue, signIn, signInAsTest, signOut } from './helpers/scada';

test('Запрет записи чужого тега подменой номера', { tag: ['@access', '@security', '@tags', '@sec03', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(90_000);
  const device = 'Контроль доступа';
  const allowed = 'Разрешённый уровень', denied = 'Закрытый уровень';
  let role: 'admin' | 'operator' | 'none' = 'none';
  let initialGroup: boolean | undefined;
  onCleanup(async () => {
    if (role === 'operator') {
      await signOut(page);
      role = 'none';
    }
    if (role === 'none') await signInAsTest(page);
    try {
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
  });
  await signInAsTest(page);
  role = 'admin';
  initialGroup = await getTestGroup(page);
  await setTestGroup(page, true);
  await openProject(page, projectName);
  await deleteVirtualDeviceIfPresent(page, device);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  const allowedRow = await ensureVirtualTag(page, { id: 2, name: allowed, type: 'Float' });
  const deniedRow = await ensureVirtualTag(page, { id: 3, name: denied, type: 'Float' });
  for (const row of [allowedRow, deniedRow]) await expectTagAcl(page, row, 'user', false);
  await expectTagAcl(page, deniedRow, 'group', false);
  await allowTagGroupWrite(page, allowedRow);
  const allowedId = await allowedRow.locator('td[id^="v"]').getAttribute('os_tag_id');
  const deniedId = await deniedRow.locator('td[id^="v"]').getAttribute('os_tag_id');
  expect(allowedId).toBeTruthy();
  expect(deniedId).toBeTruthy();
  expect(deniedId).not.toBe(allowedId);
  await signOut(page);
  role = 'none';
  await signIn(page);
  role = 'operator';
  await openProject(page, projectName);
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  await expect(allowedRow.locator('td[id^="v"]')).toHaveText('0');
  await expect(deniedRow.locator('td[id^="v"]')).toHaveText('0');
  const captured = page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === `/set_value_tag/${allowedId}/`, { timeout: 10_000 });
  await setTagValue(page, allowed, 2);
  const source = await captured;
  const target = new URL(source.url());
  target.pathname = `/set_value_tag/${deniedId}/`;
  const rejected = await replayUiPost(page, source, target.href);
  await setTagValue(page, allowed, 3);
  await test.info().attach('Подмена ID: ответ сервера', { body: String(rejected.status()), contentType: 'text/plain' });
  await signOut(page);
  role = 'none';
  await signInAsTest(page);
  role = 'admin';
  await openProject(page, projectName);
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  await expect(allowedRow.locator('td[id^="v"]')).toHaveText('3');
  await expect(deniedRow.locator('td[id^="v"]')).toHaveText('0');
});

test('Запрет изменения устройства без права', { tag: ['@access', '@security', '@rights', '@project', '@sec04', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(90_000);
  const original = 'Защищённый датчик', edited = 'Проверенный датчик';
  let role: 'admin' | 'operator' | 'none' = 'none';
  let initialGroup: boolean | undefined;
  onCleanup(async () => {
    if (role === 'operator') {
      await signOut(page);
      role = 'none';
    }
    if (role === 'none') await signInAsTest(page);
    try {
      const form = page.locator('#form_edit_user');
      if (await form.isVisible()) await form.locator('#form_cancel').click();
      const deviceForm = page.locator('#form_edit_device_hub');
      if (await deviceForm.isVisible()) await deviceForm.locator('#form_cancel').click();
      await openProject(page, projectName);
      for (const name of [original, edited]) await deleteVirtualDeviceIfPresent(page, name);
      await openDeviceTree(page);
      for (const name of [original, edited]) {
        await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(0);
      }
    } finally {
      if (initialGroup !== undefined) {
        await setTestGroup(page, initialGroup);
        expect(await getTestGroup(page)).toBe(initialGroup);
      }
    }
  });
  await signInAsTest(page);
  role = 'admin';
  initialGroup = await getTestGroup(page);
  await openTestUsers(page);
  await testUserRow(page).locator('td.edit').click();
  const form = page.locator('#form_edit_user');
  await expect(form.locator('#enable_edit_config')).not.toBeChecked();
  await expect(form.locator('#enable_edit_devices')).not.toBeChecked();
  await form.locator('#form_cancel').click();
  await openProject(page, projectName);
  for (const name of [original, edited]) await deleteVirtualDeviceIfPresent(page, name);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, original);
  const source = await renameVirtualDevice(page, original, edited);
  const payload = JSON.parse(source.postData() || '{}');
  expect(payload.title).toBe(edited);
  expect(payload).not.toHaveProperty('session_tab');
  await renameVirtualDevice(page, edited, original);
  await setTestGroup(page, false);
  expect(await getTestGroup(page)).toBe(false);
  await signOut(page);
  role = 'none';
  await signIn(page);
  role = 'operator';
  await openProject(page, projectName);
  await expect(page.locator('#panel_right [title="Дерево проекта"]')).toBeHidden();
  const rejected = await replayUiPost(page, source, source.url());
  await test.info().attach('Изменение устройства без права', { body: String(rejected.status()), contentType: 'text/plain' });
  await signOut(page);
  role = 'none';
  await signInAsTest(page);
  role = 'admin';
  await openProject(page, projectName);
  await openDeviceTree(page);
  await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${original}$`) })).toBeVisible();
  await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${edited}$`) })).toHaveCount(0);
  expect((await replayUiPost(page, source, source.url())).ok()).toBe(true);
  await openDeviceTree(page);
  await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${edited}$`) })).toBeVisible();
  await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${original}$`) })).toHaveCount(0);
});
