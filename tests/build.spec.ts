import { saveOwned } from './helpers/owned';
import { expect, test } from './helpers/test';
import {
  projectName,
  chooseTag, deleteVirtualDeviceIfPresent, ensureProject, ensureVirtualDevice,
  ensureVirtualTag, expectTagValueUnchanged, openDeviceTags, openDeviceTree, openProject,
  setTagValue, signIn, currentUser,
} from './helpers/scada';
import { deleteViewRow, openViewList, viewRow } from './helpers/view';
import { cleanupTrigger, openTriggerTags, prepareTrigger } from './helpers/trigger';

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
});

test('Открытие формы драйвера без сохранения', { tag: ['@project', '@base'] }, async ({ page }) => {
  await page.locator('#panel_right [title="Драйверы"]').click();
  await expect(page.locator('#header_main > div:first-child')).toContainText('Драйверы');
  const count = await page.locator('#header_main #count_data').textContent();
  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
  const form = page.locator('#form_edit_driver');
  await expect(form).toBeVisible();
  await expect(form.locator('#name')).toBeEmpty();
  await form.locator('#form_cancel').click();
  await expect(form).toBeHidden();
  await expect(page.locator('#header_main #count_data')).toHaveText(count ?? '');
});

test('Просмотр пользователей онлайн', { tag: ['@access', '@base'] }, async ({ page }) => {
  await page.locator('#panel_right [title="Пользователи"]').click();
  await page.locator('#header_main .btn_add[onclick="os.users.info_connect();"]').click();
  await expect(page.locator('#count_connect_users')).toBeVisible();
  await expect(page.locator('#panel_main2 tr[id^="tr_uid_"]')
    .filter({ has: page.getByRole('cell', { name: currentUser(), exact: true }) }).first()).toBeVisible();
  await page.locator('#header_main #undo_history_step').click();
  await expect(page.locator('#header_main > div:first-child')).toContainText('Пользователи');
});

test('Отображение тега в таблице', { tag: ['@tags', '@tagtable', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const deviceName = 'TagTableDevice';
  const title = 'Таблицы тегов';
  const name = 'TagTableTest';
  const form = page.locator('#form_edit_table_tags');
  onCleanup(async () => {
    if (await page.locator('#form_edit_table_tag').isVisible()) await page.locator('#form_edit_table_tag #form_cancel').click();
    if (await form.isVisible()) await form.locator('#form_cancel').click();
    await openViewList(page, title);
    if (await viewRow(page, name).count()) await deleteViewRow(page, name, 'Удалить таблицу(ы)?');
    await deleteVirtualDeviceIfPresent(page, deviceName);
  });
  await openViewList(page, title);
  if (await viewRow(page, name).count()) await deleteViewRow(page, name, 'Удалить таблицу(ы)?');
  await deleteVirtualDeviceIfPresent(page, deviceName);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, deviceName);
  await openDeviceTags(page, deviceName);
  await ensureVirtualTag(page, { id: 2, name: 'Level', type: 'Float' });

  await openViewList(page, title);
  await page.locator('#header_main .btn_add[onclick="os.tags.table.edit(\'-\')"]').click();
  await expect(form).toBeVisible();
  await form.locator('#name').fill(name);
  await saveOwned(page, '/save_table_tags/', 'table_id', () => form.locator('#form_ok').click());
  await expect(viewRow(page, name)).toBeVisible();

  await viewRow(page, name).locator('td.tag2').click();
  await expect(page.locator('#header_main > div:first-child')).toContainText(`Теги для таблицы «${name}»`);
  await page.locator('#header_main .btn_add[onclick="os.tags.table.tags.edit(\'\')"]').click();
  const tagForm = page.locator('#form_edit_table_tag');
  await tagForm.locator('#name_table_tag').fill('Level');
  await chooseTag(page, tagForm.locator('.select_tag_tree'), deviceName, 'Level');
  await tagForm.locator('#form_ok').click();
  await expect(page.locator('#table_option tr[rec_id]').filter({ hasText: `${deviceName}//Level` })).toBeVisible();

  await openViewList(page, title);
  await viewRow(page, name).locator('td.tag2').click();
  await expect(page.locator('#table_option tr[rec_id]').filter({ hasText: `${deviceName}//Level` })).toBeVisible();
  await openViewList(page, title);
  await deleteViewRow(page, name, 'Удалить таблицу(ы)?');
  await openViewList(page, title);
  await expect(viewRow(page, name)).toHaveCount(0);
});

test('Запись значения по триггеру', { tag: ['@trigger', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const deviceName = 'Датчик триггера';
  const triggerName = 'Запись уровня';
  onCleanup(async () => {
    await cleanupTrigger(page, deviceName, triggerName);
  });
  await prepareTrigger(page, deviceName, triggerName);
  const dest = await openTriggerTags(page, deviceName);
  await expectTagValueUnchanged(dest, '0', async () => {
    await setTagValue(page, 'Source', -1);
    await setTagValue(page, 'Source', 0);
  });
  await setTagValue(page, 'Source', 1);
  await expect(dest).toHaveText('1');
});
