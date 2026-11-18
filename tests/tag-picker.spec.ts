import { saveOwned } from './helpers/owned';
import { expect, test } from './helpers/test';
import {
  chooseTag, deleteVirtualDeviceIfPresent, ensureProject, ensureVirtualDevice, ensureVirtualTag,
  openDeviceTags, openDeviceTree, openProject, projectName, setTagValue, signIn,
} from './helpers/scada';
import { deleteMenuLink, ensureMenuLink, openMenuEditor } from './helpers/menu';
import { cleanupViewRows, openViewList, viewRow } from './helpers/view';

type FilterWindow = Window & { os: { vars: { keyup: { timer: number | false } } } };

test('Выбор одноимённых тегов из разных веток', { tag: ['@tags', '@tag07', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(90_000);
  const device = 'Иерархия тегов';
  const tableName = 'Таблица выбора тега';
  const menu = 'Выбор вложенного тега';
  const rowName = 'Выбранный уровень';
  const paths = ['Этаж 1/Бак/Уровень', 'Этаж 2/Бак/Уровень'];
  const form = page.locator('#form_edit_table_tag');

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  const cleanup = async () => {
    if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
    if (await page.locator('#my_confirm').isVisible()) await page.locator('#btn_cancel_confirm').click();
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
    for (const selector of ['#form_edit2', '#form_edit_table_tag', '#form_edit_table_tags', '#form_select_data_nodes', '#form_edit_menu_item', '#form_edit_tag', '#form_edit_device_hub']) {
      const dialog = page.locator(selector);
      if (await dialog.isVisible()) await dialog.locator('.header > .close_form').click();
    }
    await openMenuEditor(page);
    const ownMenu = page.locator('#panel_main2 .devices_tree_title').filter({ hasText: new RegExp(`^${menu}$`) });
    if (await ownMenu.count()) await deleteMenuLink(page, ownMenu);
    await openMenuEditor(page);
    await expect(ownMenu).toHaveCount(0);
    await cleanupViewRows(page, 'Таблицы тегов', [tableName], 'Удалить таблицу(ы)?');
    await deleteVirtualDeviceIfPresent(page, device);
    await openDeviceTree(page);
    await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
  };
  onCleanup(cleanup);
  await cleanup();
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  const sourceIds: string[] = [];
  for (const [index, path] of paths.entries()) {
    const row = await ensureVirtualTag(page, { id: index + 2, name: path, type: 'Float' });
    const id = await row.getAttribute('rec_id');
    expect(id).toBeTruthy();
    sourceIds.push(id!);
    await expect(row.locator('td[id^="v"]')).toHaveText('0');
    await setTagValue(page, path, index === 0 ? 2 : 9);
  }
  expect(sourceIds[0]).not.toBe(sourceIds[1]);
  await openViewList(page, 'Таблицы тегов');
  await page.locator('#header_main .btn_add[onclick="os.tags.table.edit(\'-\')"]').click();
  const tableForm = page.locator('#form_edit_table_tags');
  await tableForm.locator('#name').fill(tableName);
  await saveOwned(page, '/save_table_tags/', 'table_id', () => tableForm.locator('#form_ok').click());
  const openRows = async () => {
    await openViewList(page, 'Таблицы тегов');
    await expect(page.locator('#filter_name')).toBeVisible();
    // shortcut: UI-07 — список не отменяет свой отложенный фильтр при уходе; ждать до исправления приложения.
    await expect.poll(() => page.evaluate(() => (window as unknown as FilterWindow).os.vars.keyup.timer === false)).toBe(true);
    await expect(page.locator('#div_msg')).toBeHidden();
    await viewRow(page, tableName).locator('td.tag2').click();
    await expect(page.locator('#header_main > div:first-child')).toContainText(`Теги для таблицы «${tableName}»`);
  };
  await openRows();
  await page.locator('#header_main .btn_add[onclick="os.tags.table.tags.edit(\'\')"]').click();
  await form.locator('#name_table_tag').fill(rowName);
  const pickAndSave = async (index: number) => {
    const selectedId = await chooseTag(page, form.locator('.select_tag_tree'), device, paths[index]);
    expect(selectedId).toBe(sourceIds[index]);
    await expect(form.locator('#select_tag_tree_value')).toHaveValue(`${device}//${paths[index]}`);
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/save_table_tag/', { timeout: 10_000 });
    await form.locator('#form_ok').click();
    expect((await (await saved).json()).error).toBeFalsy();
    await expect(form).toBeHidden();
  };
  const configRow = page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: rowName, exact: true }) });
  let tableRowId = '';
  const readBinding = async (index: number) => {
    await openRows();
    await expect(page.locator('#table_option tr[rec_id]')).toHaveCount(1);
    await expect(configRow).toHaveAttribute('rec_id', tableRowId);
    await expect(configRow).toContainText(`${device}//${paths[index]}`);
    await configRow.locator('td.edit').click();
    await expect(form.locator('#name_table_tag')).toHaveValue(rowName);
    await expect(form.locator('#select_tag_tree_value')).toHaveValue(`${device}//${paths[index]}`);
    await form.locator('#form_cancel').click();
  };
  const showValue = async (index: number, expected: string) => {
    await openDeviceTree(page);
    await page.locator('#menu_main').getByText(menu, { exact: true }).click();
    await expect(page.locator('#header_main > div:first-child')).toContainText(tableName);
    const runtimeRow = page.locator('#table_option.table_tags tr').filter({ has: page.getByRole('cell', { name: rowName, exact: true }) });
    await expect(runtimeRow).toHaveAttribute('id', `tr_id_${tableRowId}`);
    const value = runtimeRow.locator('span[id^="v_"]');
    await expect(value).toHaveAttribute('id', `v_${sourceIds[index]}`);
    await expect(value).toHaveText(expected);
  };

  await test.step('Выбрать уровень из первой ветки', async () => {
    await pickAndSave(0);
    await expect(configRow).toBeVisible();
    tableRowId = (await configRow.getAttribute('rec_id')) || '';
    expect(tableRowId).toBeTruthy();
    await readBinding(0);
    await ensureMenuLink(page, menu, tableName);
    await showValue(0, '2');
  });
  await test.step('Заменить его уровнем из второй ветки', async () => {
    await openRows();
    await configRow.locator('td.edit').click();
    await pickAndSave(1);
    await readBinding(1);
    await showValue(1, '9');
  });
  await test.step('Открыть таблицу заново и проверить выбранный тег', async () => {
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(page.locator(`#table_option tr[rec_id="${sourceIds[0]}"] td[id^="v"]`)).toHaveText('2');
    await setTagValue(page, paths[0], 7);
    await showValue(1, '9');
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(page.locator(`#table_option tr[rec_id="${sourceIds[1]}"] td[id^="v"]`)).toHaveText('9');
    await setTagValue(page, paths[1], -2.5);
    await showValue(1, '-2.5');
  });
});
