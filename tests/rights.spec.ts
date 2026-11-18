import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import {
  deleteVirtualDeviceIfPresent, ensureVirtualDevice, ensureVirtualTag,
  openDeviceTags, openDeviceTree, openProject, projectName, setTagValue, signIn, signInAsTest, signOut,
} from './helpers/scada';
import { openViewList } from './helpers/view';
import { allowTagGroupWrite, expectTagAcl, openTestUsers as openUsers, setTestGroup as setGroup, testUserRow as userRow } from './helpers/access';

async function closeRightsForms(page: Page) {
  if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
  if (await page.locator('#my_confirm').isVisible()) await page.locator('#btn_cancel_confirm').click();
  if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
  for (const id of ['form_edit2', 'form_edit_user_on_groups', 'form_edit_user', 'form_edit_group_users', 'form_edit_accept_on_users', 'form_edit_accept_on_groups', 'form_edit_tag', 'form_edit_device_hub']) {
    const form = page.locator(`#${id}`);
    if (await form.isVisible()) await form.locator('.header > .close_form').click();
  }
}

async function createOwnDevice(page: Page, name: string) {
  await openDeviceTree(page);
  const device = page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${name}$`) });
  await expect(device, 'Занятое устройство не изменяем').toHaveCount(0);
  const created = page.waitForResponse(r => new URL(r.url()).pathname === '/save_device//' && r.request().method() === 'POST');
  await ensureVirtualDevice(page, name);
  const result = await (await created).json();
  expect(result.node_id).toMatch(/^[a-f\d]{32}$/i);
  expect(result.error).toBeFalsy();
  await expect(device).toHaveAttribute('node_id', result.node_id);
  return result.node_id as string;
}

async function removeOwnDevice(page: Page, name: string, id: string) {
  if (!id) return;
  await openDeviceTree(page);
  const device = page.locator(`.devices_tree_title[node_id="${id}"]`);
  if (await device.count()) {
    await expect(device).toHaveText(name);
    await deleteVirtualDeviceIfPresent(page, name);
  }
  await openDeviceTree(page);
  await expect(device).toHaveCount(0);
}

async function writeAndReadTag(page: Page, deviceName: string, tagName: string, value: number) {
  await openProject(page, projectName);
  await openDeviceTree(page);
  await openDeviceTags(page, deviceName);
  const cell = page.locator('#table_option tr').filter({ hasText: tagName }).locator('td[id^="v"]');
  await expect(cell).toHaveText('1');
  await cell.click();
  await page.locator('#form_edit #value_tag').fill(String(value));
  const write = page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/set_value_tag/'));
  await page.locator('#form_edit #btn_set_form_value_tag').click();
  expect((await write).status()).toBe(200);
  await openDeviceTree(page);
  await openDeviceTags(page, deviceName);
  return cell;
}

test.beforeEach(async ({ page }) => {
  await signInAsTest(page);
  await openUsers(page);
});

test('Сохранение членства в группе', { tag: ['@access', '@rights', '@base'] }, async ({ page, onCleanup }, info) => {
  const initiallyEnabled = (await userRow(page).locator('td.group').textContent())?.trim() === '1';
  onCleanup(async () => {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('Rights before cleanup.png'), timeout: 3000 }).catch(() => {});
    await closeRightsForms(page);
    await openUsers(page);
    await setGroup(page, initiallyEnabled);
    await openUsers(page);
    await expect(userRow(page).locator('td.group')).toHaveText(initiallyEnabled ? '1' : '');
  });
  await setGroup(page, !initiallyEnabled);
  await openUsers(page);
  await expect(userRow(page).locator('td.group')).toHaveText(initiallyEnabled ? '' : '1');
});

test('Сохранение выбранных прав', { tag: ['@access', '@rights', '@base'] }, async ({ page, onCleanup }, info) => {
  const initiallyEnabled = (await userRow(page).locator('td.group').textContent())?.trim() === '1';
  onCleanup(async () => {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('Rights before cleanup.png'), timeout: 3000 }).catch(() => {});
    await closeRightsForms(page);
    await openUsers(page);
    if ((await userRow(page).locator('td.group').textContent())?.trim() !== (initiallyEnabled ? '1' : '')) {
      await setGroup(page, initiallyEnabled);
    }
    await openUsers(page);
    await expect(userRow(page).locator('td.group')).toHaveText(initiallyEnabled ? '1' : '');
  });
  await setGroup(page, !initiallyEnabled);
  await setGroup(page, initiallyEnabled);
  const immediate = await userRow(page).locator('td').evaluateAll(cells => cells.slice(8, 20).map(cell => cell.className));
  await openUsers(page);
  const reloaded = await userRow(page).locator('td').evaluateAll(cells => cells.slice(8, 20).map(cell => cell.className));
  expect(reloaded).toEqual(immediate);
});

test('Запись тега по праву группы', { tag: ['@access', '@rights', '@g03', '@base'] }, async ({ page, onCleanup }, info) => {
  test.setTimeout(60_000);
  const deviceName = 'GroupAccessDevice';
  const tagName = 'GroupValue';
  const initialGroup = (await userRow(page).locator('td.group').textContent())?.trim() === '1';
  let deviceId = '';
  let role: 'test' | 'autotest' | 'none' = 'test';
  onCleanup(async () => {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('Rights before cleanup.png'), timeout: 3000 }).catch(() => {});
    await closeRightsForms(page);
    if (role === 'autotest') {
      await signOut(page);
      role = 'none';
    }
    if (role === 'none') await signInAsTest(page);
    if (await page.locator('#form_edit_accept_on_groups').isVisible()) await page.locator('#form_edit_accept_on_groups #form_cancel').click();
    await openProject(page, projectName);
    await removeOwnDevice(page, deviceName, deviceId);
    await openUsers(page);
    await setGroup(page, initialGroup);
    await openUsers(page);
    await expect(userRow(page).locator('td.group')).toHaveText(initialGroup ? '1' : '');
  });
  await setGroup(page, true);
  await openProject(page, projectName);
  deviceId = await createOwnDevice(page, deviceName);
  await openDeviceTags(page, deviceName);
  const tag = await ensureVirtualTag(page, { id: 2, name: tagName, type: 'Float' });
  await expectTagAcl(page, tag, 'user', false);
  await allowTagGroupWrite(page, tag);
  await setTagValue(page, tagName, 1);

  await signOut(page);
  role = 'none';
  await signIn(page);
  role = 'autotest';
  const autoCell = await writeAndReadTag(page, deviceName, tagName, 2);
  await expect(autoCell).toHaveText('2');

  await signOut(page);
  role = 'none';
  await signInAsTest(page);
  role = 'test';
  await openProject(page, projectName);
  await openDeviceTree(page);
  await openDeviceTags(page, deviceName);
  const adminCell = page.locator('#table_option tr').filter({ hasText: tagName }).locator('td[id^="v"]');
  await expect(adminCell).toHaveText('2');
});

test('Запрет записи тега без права', { tag: ['@access', '@rights', '@s02', '@base'] }, async ({ page, onCleanup }, info) => {
  test.setTimeout(60_000);
  const deviceName = 'RestrictedAccessDevice';
  const tagName = 'RestrictedValue';
  const initialGroup = (await userRow(page).locator('td.group').textContent())?.trim() === '1';
  let deviceId = '';
  let role: 'test' | 'autotest' | 'none' = 'test';
  onCleanup(async () => {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('Rights before cleanup.png'), timeout: 3000 }).catch(() => {});
    await closeRightsForms(page);
    if (role === 'autotest') {
      await signOut(page);
      role = 'none';
    }
    if (role === 'none') await signInAsTest(page);
    if (await page.locator('#form_edit_accept_on_users').isVisible()) await page.locator('#form_edit_accept_on_users #form_cancel').click();
    if (await page.locator('#form_edit_accept_on_groups').isVisible()) await page.locator('#form_edit_accept_on_groups #form_cancel').click();
    await openProject(page, projectName);
    await removeOwnDevice(page, deviceName, deviceId);
    await openUsers(page);
    await setGroup(page, initialGroup);
    await openUsers(page);
    await expect(userRow(page).locator('td.group')).toHaveText(initialGroup ? '1' : '');
  });
  await setGroup(page, true);
  await openProject(page, projectName);
  deviceId = await createOwnDevice(page, deviceName);
  await openDeviceTags(page, deviceName);
  const tag = await ensureVirtualTag(page, { id: 1, name: tagName, type: 'Float' });
  const tagId = await tag.locator('td[id^="v"]').getAttribute('os_tag_id');
  const projectId = new URL(page.url()).searchParams.get('project_id');
  if (!tagId || !projectId) throw new Error('Temporary tag or project ID is missing');

  await expectTagAcl(page, tag, 'user', false);
  await expectTagAcl(page, tag, 'group', false);
  await setTagValue(page, tagName, 1);

  await signOut(page);
  role = 'none';
  await signIn(page);
  role = 'autotest';
  await openProject(page, projectName);
  await expect(page.locator('#panel_right [title="Дерево проекта"]')).toBeVisible();
  await openDeviceTree(page);
  await openDeviceTags(page, deviceName);
  const cell = page.locator('#table_option tr').filter({ hasText: tagName }).locator('td[id^="v"]');
  await expect(cell).toBeVisible();
  await cell.click();
  const editor = page.locator('#form_edit');
  const editorVisible = await editor.isVisible();
  await test.info().attach('Редактор значения без права', { body: editorVisible ? 'открылся' : 'не открылся', contentType: 'text/plain' });
  if (editorVisible) {
    await editor.locator('#value_tag').fill('2');
    await editor.locator('#btn_set_form_value_tag').click();
  }
  const sessionTab = await page.evaluate(() => (window as unknown as { session_tab: string }).session_tab);
  expect(sessionTab).toMatch(/^[0-9A-F]{32}$/);
  const response = await page.request.post(`/set_value_tag/${tagId}/?project_id=${projectId}`, {
    data: JSON.stringify({ value: '2', session_tab: sessionTab }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    maxRedirects: 0,
  });
  expect([200, 403]).toContain(response.status());
  await test.info().attach('HTTP-статус записи без права', { body: String(response.status()), contentType: 'text/plain' });

  await signOut(page);
  role = 'none';
  await signInAsTest(page);
  role = 'test';
  await openProject(page, projectName);
  await openDeviceTree(page);
  await openDeviceTags(page, deviceName);
  await expect(page.locator('#table_option tr').filter({ hasText: tagName }).locator('td[id^="v"]')).toHaveText('1');
});

test('Доступ к картам по праву группы', { tag: ['@access', '@rights', '@map', '@g09', '@base'] }, async ({ page, onCleanup }, info) => {
  test.setTimeout(90_000);
  const initialGroup = (await userRow(page).locator('td.group').textContent())?.trim() === '1';
  let role: 'test' | 'autotest' | 'none' = 'test';
  onCleanup(async () => {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('Rights before cleanup.png'), timeout: 3000 }).catch(() => {});
    await closeRightsForms(page);
    if (role === 'autotest') {
      await signOut(page);
      role = 'none';
    }
    if (role === 'none') await signInAsTest(page);
    if (await page.locator('#form_edit_user').isVisible()) await page.locator('#form_edit_user #form_cancel').click();
    if (await page.locator('#form_edit_group_users').isVisible()) await page.locator('#form_edit_group_users #form_cancel').click();
    await openUsers(page);
    await setGroup(page, initialGroup);
    await openUsers(page);
    await expect(userRow(page).locator('td.group')).toHaveText(initialGroup ? '1' : '');
  });
  await userRow(page).locator('td.edit').click();
  const userForm = page.locator('#form_edit_user');
  await expect(userForm.locator('#enable_edit_maps')).not.toBeChecked();
  await userForm.locator('#form_cancel').click();
  await page.locator('#panel_right [title="Группы"]').click();
  await page.locator('#table_option tr[fn="test_group"] td.edit').click();
  const groupForm = page.locator('#form_edit_group_users');
  await expect(groupForm.locator('#enable_edit_maps')).toBeChecked();
  await groupForm.locator('#form_cancel').click();
  await openUsers(page);
  await setGroup(page, true);

  await signOut(page);
  role = 'none';
  await signIn(page);
  role = 'autotest';
  await openProject(page, projectName);
  await expect(page.locator('#panel_right [title="Карты"]')).toBeVisible();
  await openViewList(page, 'Карты');

  await signOut(page);
  role = 'none';
  await signInAsTest(page);
  role = 'test';
  await openUsers(page);
  await setGroup(page, false);
  await openUsers(page);
  await expect(userRow(page).locator('td.group')).toHaveText('');

  await signOut(page);
  role = 'none';
  await signIn(page);
  role = 'autotest';
  await openProject(page, projectName);
  await expect(page.locator('#prjName')).toContainText(projectName);
  await expect(page.locator('#panel_right [title="Карты"]')).toBeHidden();

  await signOut(page);
  role = 'none';
  await signInAsTest(page);
  role = 'test';
  await openUsers(page);
  await setGroup(page, true);

  await signOut(page);
  role = 'none';
  await signIn(page);
  role = 'autotest';
  await openProject(page, projectName);
  await expect(page.locator('#panel_right [title="Карты"]')).toBeVisible();
  await openViewList(page, 'Карты');
});

