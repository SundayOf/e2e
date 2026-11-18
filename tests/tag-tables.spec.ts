import { saveOwned } from './helpers/owned';
import { type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import {
  chooseTag, deleteTag, deleteVirtualDeviceIfPresent, ensureProject, ensureVirtualDevice, ensureVirtualTag, expectTagValueUnchanged,
  openDeviceTags, openDeviceTree, openProject, projectName, setTagValue, signIn,
} from './helpers/scada';
import { deleteMenuLink, ensureMenuLink, openMenuEditor } from './helpers/menu';
import { cleanupViewRows, openViewList, viewRow } from './helpers/view';

async function createTable(page: Page, name: string, device: string, rows: [title: string, tag: string][]) {
  await openViewList(page, 'Таблицы тегов');
  await page.locator('#header_main .btn_add[onclick="os.tags.table.edit(\'-\')"]').click();
  const form = page.locator('#form_edit_table_tags');
  await expect(form).toBeVisible();
  await form.locator('#name').fill(name);
  await saveOwned(page, '/save_table_tags/', 'table_id', () => form.locator('#form_ok').click());
  await viewRow(page, name).locator('td.tag2').click();
  await expect(page.locator('#header_main > div:first-child')).toContainText(`Теги для таблицы «${name}»`);
  for (const [title, tag] of rows) {
    await page.locator('#header_main .btn_add[onclick="os.tags.table.tags.edit(\'\')"]').click();
    const tagForm = page.locator('#form_edit_table_tag');
    await expect(tagForm).toBeVisible();
    await tagForm.locator('#name_table_tag').fill(title);
    await chooseTag(page, tagForm.locator('.select_tag_tree'), device, tag);
    await tagForm.locator('#form_ok').click();
    await expect(page.locator('#table_option tr[rec_id]').filter({ hasText: `${device}//${tag}` })).toBeVisible();
  }
}

async function cleanupTable(page: Page, device: string, names: string[], menu: string) {
  await openMenuEditor(page);
  const menuRow = page.locator('#panel_main2 .devices_tree_title').filter({ hasText: new RegExp(`^${menu}$`) });
  if (await menuRow.count()) await deleteMenuLink(page, menuRow);
  await cleanupViewRows(page, 'Таблицы тегов', names, 'Удалить таблицу(ы)?');
  await openViewList(page, 'Таблицы тегов');
  for (const name of names) await expect(viewRow(page, name)).toHaveCount(0);
  await deleteVirtualDeviceIfPresent(page, device);
  await openDeviceTree(page);
  await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
}

async function closeTableForms(page: Page) {
  if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
  if (await page.locator('#my_confirm').isVisible()) await page.locator('#btn_cancel_confirm').click();
  for (const selector of ['#form_edit2', '#form_select_data_nodes', '#form_edit_table_tag', '#form_edit_table_tags', '#form_edit_menu_item', '#form_edit_device_hub', '#form_edit_tag', '#form_edit']) {
    const form = page.locator(selector);
    if (await form.isVisible()) await form.locator('.header > .close_form').click();
  }
}

test('Обновление значений в открытой таблице тегов', { tag: ['@tags', '@tagtable', '@tbl05', '@base'] }, async ({ page, context, onCleanup }) => {
  test.setTimeout(120_000);
  const device = 'Данные таблицы';
  const name = 'Таблица текущих значений';
  const menu = 'Текущие значения тест';
  let operator: Page | undefined;

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    await operator?.close();
    await closeTableForms(page);
    await cleanupTable(page, device, [name], menu);
  });
  await cleanupTable(page, device, [name], menu);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  await ensureVirtualTag(page, { id: 2, name: 'Уровень', type: 'Float' });
  await ensureVirtualTag(page, { id: 3, name: 'Контроль', type: 'Float' });
  for (const tag of ['Уровень', 'Контроль']) {
    await expect(page.locator('#table_option tr').filter({ hasText: tag }).locator('td[id^="v"]')).toHaveText('0');
  }
  await setTagValue(page, 'Контроль', 9);

  await test.step('Создать таблицу с двумя тегами и ссылку в меню', async () => {
    await createTable(page, name, device, [['Уровень', 'Уровень'], ['Контроль', 'Контроль']]);
    await ensureMenuLink(page, menu, name);
  });

  await openDeviceTree(page);
  await openDeviceTags(page, device);
  await expect(page.locator('#table_option tr').filter({ hasText: 'Уровень' }).locator('td[id^="v"]')).toHaveText('0');
  const display = await context.newPage();
  operator = display;
  await display.goto('/');
  await openProject(display, projectName);
  await display.locator('#menu_main').getByText(menu, { exact: true }).click();
  await expect(display.locator('#header_main > div:first-child')).toContainText(name);
  const table = display.locator('#table_option.table_tags');
  await expect(table).toBeVisible();
  const value = table.locator('tr').filter({ has: display.getByRole('cell', { name: 'Уровень', exact: true }) }).locator('span[id^="v_"]');
  const control = table.locator('tr').filter({ has: display.getByRole('cell', { name: 'Контроль', exact: true }) }).locator('span[id^="v_"]');
  await expect(value).toHaveText('0');
  await expect(control).toHaveText('9');
  const url = display.url();
  let navigations = 0;
  display.on('framenavigated', frame => {
    if (frame === display.mainFrame()) navigations++;
  });

  for (const next of [5, -2.5, 0]) {
    await test.step(`Записать ${next} в другой вкладке и проверить таблицу`, async () => {
      await setTagValue(page, 'Уровень', next);
      await expect.poll(async () => {
        const text = (await value.innerText()).trim();
        return text ? Number(text) : NaN;
      }).toBe(next);
      await expect(control).toHaveText('9');
      expect(display.url()).toBe(url);
      expect(navigations, 'Операторская вкладка не должна перезагружаться или переходить на другую страницу').toBe(0);
    });
  }
});

test('Замена тега в строке таблицы', { tag: ['@tags', '@tagtable', '@tbl03', '@base'] }, async ({ page, context, onCleanup }) => {
  test.setTimeout(120_000);
  const device = 'Источники таблицы';
  const name = 'Таблица замены источника';
  const menu = 'Замена источника тест';
  const form = page.locator('#form_edit_table_tag');
  let operator: Page | undefined;

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    await operator?.close();
    await closeTableForms(page);
    await cleanupTable(page, device, [name], menu);
  });
  await cleanupTable(page, device, [name], menu);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  for (const [id, tag, unit, value] of [[2, 'Давление', 'bar', 2], [3, 'Температура', '°C', 20]] as const) {
    const row = await ensureVirtualTag(page, { id, name: tag, type: 'Float' });
    await expect(row.locator('td[id^="v"]')).toHaveText('0');
    await row.locator('td.edit').click();
    const tagForm = page.locator('#form_edit_tag');
    await expect(tagForm).toBeVisible();
    await tagForm.locator('#unit').fill(unit);
    await tagForm.locator('#form_ok').click();
    await expect(row.locator('td').nth(9)).toHaveText(unit);
    await setTagValue(page, tag, value);
  }

  await createTable(page, name, device, [['Показание', 'Давление']]);
  const initialRow = page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'Показание', exact: true }) });
  await expect(initialRow).toContainText(`${device}//Давление`);
  const rowId = await initialRow.getAttribute('rec_id');
  if (!rowId) throw new Error('У строки таблицы нет ID');
  const configRow = page.locator(`#table_option tr[rec_id="${rowId}"]`);
  await ensureMenuLink(page, menu, name);

  const display = await context.newPage();
  operator = display;
  await display.goto('/');
  await openProject(display, projectName);
  await display.locator('#menu_main').getByText(menu, { exact: true }).click();
  await expect(display.locator('#header_main > div:first-child')).toContainText(name);
  const runtimeRow = display.locator('#table_option.table_tags tr').filter({ has: display.getByRole('cell', { name: 'Показание', exact: true }) });
  const value = runtimeRow.locator('span[id^="v_"]');
  const valueCell = runtimeRow.locator('td').nth(1);
  await expect(value).toHaveText('2');
  await expect(valueCell).toContainText('bar');
  await expect(valueCell).not.toContainText('°C');

  await test.step('Заменить давление на температуру в строке', async () => {
    await openViewList(page, 'Таблицы тегов');
    await viewRow(page, name).locator('td.tag2').click();
    await configRow.locator('td.edit').click();
    await expect(form.locator('#name_table_tag')).toHaveValue('Показание');
    await expect(form.locator('#select_tag_tree_value')).toHaveValue(`${device}//Давление`);
    await chooseTag(page, form.locator('.select_tag_tree'), device, 'Температура');
    await form.locator('#form_ok').click();
    await expect(configRow).toContainText(`${device}//Температура`);
    await openViewList(page, 'Таблицы тегов');
    await viewRow(page, name).locator('td.tag2').click();
    await expect(page.locator('#table_option tr[rec_id]')).toHaveCount(1);
    await expect(configRow.getByRole('cell', { name: 'Показание', exact: true })).toBeVisible();
    await expect(configRow).toContainText(`${device}//Температура`);
    await configRow.locator('td.edit').click();
    await expect(form.locator('#select_tag_tree_value')).toHaveValue(`${device}//Температура`);
    await form.locator('#form_cancel').click();
  });

  await test.step('Открыть таблицу заново и проверить новый тег', async () => {
    await openDeviceTree(display);
    await display.locator('#menu_main').getByText(menu, { exact: true }).click();
    await expect(display.locator('#header_main > div:first-child')).toContainText(name);
    await expect(value).toHaveText('20');
    await expect(valueCell).toContainText('°C');
    await expect(valueCell).not.toContainText('bar');
  });

  await openDeviceTree(page);
  await openDeviceTags(page, device);
  await expect(page.locator('#table_option tr').filter({ hasText: 'Давление' }).locator('td[id^="v"]')).toHaveText('2');
  await expect(page.locator('#table_option tr').filter({ hasText: 'Температура' }).locator('td[id^="v"]')).toHaveText('20');
  await test.step('Изменить оба тега: строка показывает только новый', async () => {
    await setTagValue(page, 'Температура', -2.5);
    await expect(value).toHaveText('-2.5');
    await expectTagValueUnchanged(value, '-2.5', () => setTagValue(page, 'Давление', 7));
    await expect(valueCell).toContainText('°C');
    await setTagValue(page, 'Температура', 0);
    await expect(value).toHaveText('0');
    await expect(valueCell).not.toContainText('bar');
  });
});

test('Удаление одной строки из таблицы тегов', { tag: ['@tags', '@tagtable', '@tbl04', '@base'] }, async ({ page, context, onCleanup }) => {
  test.setTimeout(120_000);
  const device = 'Строки таблицы';
  const name = 'Таблица удаления строки';
  const menu = 'Удаление строки тест';
  let operator: Page | undefined;

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    await operator?.close();
    await closeTableForms(page);
    await cleanupTable(page, device, [name], menu);
  });
  await cleanupTable(page, device, [name], menu);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  for (const [id, tag, value] of [[2, 'Первый', 2], [3, 'Второй', 9]] as const) {
    const row = await ensureVirtualTag(page, { id, name: tag, type: 'Float' });
    await expect(row.locator('td[id^="v"]')).toHaveText('0');
    await setTagValue(page, tag, value);
  }
  await createTable(page, name, device, [['Первая строка', 'Первый'], ['Вторая строка', 'Второй']]);
  const first = page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'Первая строка', exact: true }) });
  const second = page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'Вторая строка', exact: true }) });
  await expect(page.locator('#table_option tr[rec_id]')).toHaveCount(2);
  const removedId = await first.getAttribute('rec_id');
  const retainedId = await second.getAttribute('rec_id');
  if (!removedId || !retainedId) throw new Error('У строк таблицы нет ID');
  expect(removedId).not.toBe(retainedId);
  const removed = page.locator(`#table_option tr[rec_id="${removedId}"]`);
  const retained = page.locator(`#table_option tr[rec_id="${retainedId}"]`);
  await ensureMenuLink(page, menu, name);

  const display = await context.newPage();
  operator = display;
  await display.goto('/');
  await openProject(display, projectName);
  await display.locator('#menu_main').getByText(menu, { exact: true }).click();
  await expect(display.locator('#header_main > div:first-child')).toContainText(name);
  const table = display.locator('#table_option.table_tags');
  const removedRow = table.locator('tr').filter({ has: display.getByRole('cell', { name: 'Первая строка', exact: true }) });
  const retainedRow = table.locator('tr').filter({ has: display.getByRole('cell', { name: 'Вторая строка', exact: true }) });
  const value = retainedRow.locator('span[id^="v_"]');
  await expect(table.locator('tr:has(td)')).toHaveCount(2);
  await expect(removedRow.locator('span[id^="v_"]')).toHaveText('2');
  await expect(value).toHaveText('9');

  await test.step('Удалить одну строку и проверить оставшуюся', async () => {
    await openViewList(page, 'Таблицы тегов');
    await viewRow(page, name).locator('td.tag2').click();
    await expect(removed.getByRole('cell', { name: 'Первая строка', exact: true })).toBeVisible();
    await removed.locator('td.delete').click();
    const confirm = page.locator('#my_confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Удалить тег(и)?');
    const deleted = page.waitForResponse(r => new URL(r.url()).pathname === '/delete_table_tag/', { timeout: 10_000 });
    await confirm.locator('#btn_ok_confirm').click();
    expect((await deleted).ok()).toBe(true);
    await expect(removed).toHaveCount(0);
    await openViewList(page, 'Таблицы тегов');
    await viewRow(page, name).locator('td.tag2').click();
    await expect(page.locator('#table_option tr[rec_id]')).toHaveCount(1);
    await expect(removed).toHaveCount(0);
    await expect(retained.getByRole('cell', { name: 'Вторая строка', exact: true })).toBeVisible();
    await expect(retained).toContainText(`${device}//Второй`);
    await retained.locator('td.edit').click();
    const form = page.locator('#form_edit_table_tag');
    await expect(form.locator('#name_table_tag')).toHaveValue('Вторая строка');
    await expect(form.locator('#select_tag_tree_value')).toHaveValue(`${device}//Второй`);
    await form.locator('#form_cancel').click();
  });

  await test.step('Открыть таблицу заново: осталась одна строка', async () => {
    await openDeviceTree(display);
    await display.locator('#menu_main').getByText(menu, { exact: true }).click();
    await expect(display.locator('#header_main > div:first-child')).toContainText(name);
    await expect(table.locator('tr:has(td)')).toHaveCount(1);
    await expect(removedRow).toHaveCount(0);
    await expect(value).toHaveText('9');
  });

  await openDeviceTree(page);
  await openDeviceTags(page, device);
  await expect(page.locator('#table_option tr').filter({ hasText: 'Первый' }).locator('td[id^="v"]')).toHaveText('2');
  await expect(page.locator('#table_option tr').filter({ hasText: 'Второй' }).locator('td[id^="v"]')).toHaveText('9');
  await test.step('Проверить исходные теги и обновление оставшейся строки', async () => {
    await expectTagValueUnchanged(value, '9', () => setTagValue(page, 'Первый', 7));
    await expect(removedRow).toHaveCount(0);
    await setTagValue(page, 'Второй', 12);
    await expect(value).toHaveText('12');
    await expect(table.locator('tr:has(td)')).toHaveCount(1);
  });
});

test('Переименование таблицы тегов', { tag: ['@tags', '@tagtable', '@tbl02', '@base'] }, async ({ page, context, onCleanup }) => {
  test.setTimeout(120_000);
  const device = 'Имя таблицы';
  const originalName = 'Таблица до переименования';
  const editedName = 'Таблица после переименования';
  const menu = 'Имя таблицы тест';
  const names = [originalName, editedName];
  let operator: Page | undefined;

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    await operator?.close();
    await closeTableForms(page);
    await cleanupTable(page, device, names, menu);
  });
  await cleanupTable(page, device, names, menu);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  for (const [id, tag, value] of [[2, 'Первый', 2], [3, 'Второй', 9]] as const) {
    const row = await ensureVirtualTag(page, { id, name: tag, type: 'Float' });
    await expect(row.locator('td[id^="v"]')).toHaveText('0');
    await setTagValue(page, tag, value);
  }
  await createTable(page, originalName, device, [['Первый', 'Первый'], ['Второй', 'Второй']]);
  const tableId = await page.locator('#table_id').inputValue();
  expect(tableId).toBeTruthy();
  const firstId = await page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'Первый', exact: true }) }).getAttribute('rec_id');
  const secondId = await page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'Второй', exact: true }) }).getAttribute('rec_id');
  if (!firstId || !secondId) throw new Error('У строк таблицы нет ID');
  expect(firstId).not.toBe(secondId);
  await ensureMenuLink(page, menu, originalName);

  const display = await context.newPage();
  operator = display;
  await display.goto('/');
  await openProject(display, projectName);
  await display.locator('#menu_main').getByText(menu, { exact: true }).click();
  await expect(display.locator('#header_main > div:first-child')).toContainText(originalName);
  const table = display.locator('#table_option.table_tags');
  const firstValue = table.locator('tr').filter({ has: display.getByRole('cell', { name: 'Первый', exact: true }) }).locator('span[id^="v_"]');
  const secondValue = table.locator('tr').filter({ has: display.getByRole('cell', { name: 'Второй', exact: true }) }).locator('span[id^="v_"]');
  await expect(firstValue).toHaveText('2');
  await expect(secondValue).toHaveText('9');

  await test.step('Переименовать таблицу и проверить строки', async () => {
    await openViewList(page, 'Таблицы тегов');
    const row = page.locator(`#table_option tr[rec_id="${tableId}"]`);
    await expect(row.getByRole('cell', { name: originalName, exact: true })).toBeVisible();
    await row.locator('td.edit').click();
    const form = page.locator('#form_edit_table_tags');
    await expect(form.locator('#name')).toHaveValue(originalName);
    await form.locator('#name').fill(editedName);
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/save_table_tags/${tableId}/`, { timeout: 10_000 });
    await form.locator('#form_ok').click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    expect((await response.json()).error).toBeFalsy();
    await expect(form).toBeHidden();
    await openViewList(page, 'Таблицы тегов');
    await expect(viewRow(page, originalName)).toHaveCount(0);
    await expect(row.getByRole('cell', { name: editedName, exact: true })).toBeVisible();
    await expect(row.locator('td.tag2')).toHaveText('2');
    await row.locator('td.edit').click();
    await expect(form.locator('#name')).toHaveValue(editedName);
    await form.locator('#form_cancel').click();
    await row.locator('td.tag2').click();
    await expect(page.locator('#header_main > div:first-child')).toContainText(`Теги для таблицы «${editedName}»`);
    await expect(page.locator('#table_id')).toHaveValue(tableId);
    await expect(page.locator('#table_option tr[rec_id]')).toHaveCount(2);
    for (const [id, tag] of [[firstId, 'Первый'], [secondId, 'Второй']]) {
      const entry = page.locator(`#table_option tr[rec_id="${id}"]`);
      await expect(entry.getByRole('cell', { name: tag, exact: true })).toBeVisible();
      await expect(entry).toContainText(`${device}//${tag}`);
    }
  });

  await test.step('Открыть переименованную таблицу по прежней ссылке', async () => {
    await openDeviceTree(display);
    await display.locator('#menu_main').getByText(menu, { exact: true }).click();
    await expect(display.locator('#header_main > div:first-child')).toContainText(editedName);
    await expect(table.locator('tr:has(td)')).toHaveCount(2);
    await expect(firstValue).toHaveText('2');
    await expect(secondValue).toHaveText('9');
  });

  await openDeviceTree(page);
  await openDeviceTags(page, device);
  await expect(page.locator('#table_option tr').filter({ hasText: 'Первый' }).locator('td[id^="v"]')).toHaveText('2');
  await expect(page.locator('#table_option tr').filter({ hasText: 'Второй' }).locator('td[id^="v"]')).toHaveText('9');
  await test.step('Изменить оба тега и проверить обновление строк', async () => {
    await setTagValue(page, 'Первый', -3.5);
    await expect(firstValue).toHaveText('-3.5');
    await expect(secondValue).toHaveText('9');
    await setTagValue(page, 'Второй', 0);
    await expect(secondValue).toHaveText('0');
    await expect(firstValue).toHaveText('-3.5');
  });
});

test('Удаление тега из таблицы без замены одноимённым', { tag: ['@tags', '@tagtable', '@tbl07', '@base'] }, async ({ page, context, onCleanup }) => {
  test.setTimeout(120_000);
  const device = 'Отсутствующий источник';
  const name = 'Таблица без источника';
  const menu = 'Источник удалён тест';
  let operator: Page | undefined;

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    await operator?.close();
    await closeTableForms(page);
    await cleanupTable(page, device, [name], menu);
  });
  await cleanupTable(page, device, [name], menu);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  const source = await ensureVirtualTag(page, { id: 2, name: 'Источник', type: 'Float' });
  const sourceId = await source.getAttribute('rec_id');
  if (!sourceId) throw new Error('У исходного тега нет ID');
  await ensureVirtualTag(page, { id: 3, name: 'Контроль', type: 'Float' });
  for (const tag of ['Источник', 'Контроль']) {
    await expect(page.locator('#table_option tr').filter({ hasText: tag }).locator('td[id^="v"]')).toHaveText('0');
  }
  await setTagValue(page, 'Источник', 2);
  await setTagValue(page, 'Контроль', 9);
  await createTable(page, name, device, [['Показание', 'Источник'], ['Контроль', 'Контроль']]);
  const missingId = await page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'Показание', exact: true }) }).getAttribute('rec_id');
  const controlId = await page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'Контроль', exact: true }) }).getAttribute('rec_id');
  if (!missingId || !controlId) throw new Error('У строк таблицы нет ID');
  expect(missingId).not.toBe(controlId);
  const missing = page.locator(`#table_option tr[rec_id="${missingId}"]`);
  const retained = page.locator(`#table_option tr[rec_id="${controlId}"]`);
  await ensureMenuLink(page, menu, name);

  const display = await context.newPage();
  operator = display;
  await display.goto('/');
  await openProject(display, projectName);
  await display.locator('#menu_main').getByText(menu, { exact: true }).click();
  await expect(display.locator('#header_main > div:first-child')).toContainText(name);
  const table = display.locator('#table_option.table_tags');
  const missingRow = table.locator('tr').filter({ has: display.getByRole('cell', { name: 'Показание', exact: true }) });
  const controlValue = table.locator('tr').filter({ has: display.getByRole('cell', { name: 'Контроль', exact: true }) }).locator('span[id^="v_"]');
  await expect(table.locator('tr:has(td)')).toHaveCount(2);
  await expect(missingRow.locator('span[id^="v_"]')).toHaveText('2');
  await expect(controlValue).toHaveText('9');

  await test.step('Удалить тег и проверить удаление его строки', async () => {
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(page.locator(`#table_option tr[rec_id="${sourceId}"] td[id^="v"]`)).toHaveText('2');
    await deleteTag(page, 'Источник');
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(page.locator(`#table_option tr[rec_id="${sourceId}"]`)).toHaveCount(0);
    await expect(page.locator('#table_option tr').filter({ hasText: 'Контроль' }).locator('td[id^="v"]')).toHaveText('9');
    await openViewList(page, 'Таблицы тегов');
    await viewRow(page, name).locator('td.tag2').click();
    await expect(page.locator('#table_option tr[rec_id]')).toHaveCount(1);
    await expect(missing).toHaveCount(0);
    await expect(retained.getByRole('cell', { name: 'Контроль', exact: true })).toBeVisible();
    await expect(retained).toContainText(`${device}//Контроль`);
  });

  await test.step('Открыть таблицу и проверить отсутствие удалённого тега', async () => {
    await openDeviceTree(display);
    await display.locator('#menu_main').getByText(menu, { exact: true }).click();
    await expect(display.locator('#header_main > div:first-child')).toContainText(name);
    await expect(table.locator('tr:has(td)')).toHaveCount(1);
    await expect(missingRow).toHaveCount(0);
    await expect(controlValue).toHaveText('9');
  });

  await test.step('Создать одноимённый тег: удалённая строка не появилась', async () => {
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    const replacement = await ensureVirtualTag(page, { id: 2, name: 'Источник', type: 'Float' });
    const replacementId = await replacement.getAttribute('rec_id');
    expect(replacementId).toBeTruthy();
    expect(replacementId).not.toBe(sourceId);
    await expect(replacement.locator('td[id^="v"]')).toHaveText('0');
    await expectTagValueUnchanged(controlValue, '9', () => setTagValue(page, 'Источник', 100));
    await expect(missingRow).toHaveCount(0);
    await setTagValue(page, 'Контроль', 12);
    await expect(controlValue).toHaveText('12');
    await openViewList(page, 'Таблицы тегов');
    await viewRow(page, name).locator('td.tag2').click();
    await expect(page.locator('#table_option tr[rec_id]')).toHaveCount(1);
    await expect(missing).toHaveCount(0);
    await expect(retained).toContainText(`${device}//Контроль`);
    await openDeviceTree(display);
    await display.locator('#menu_main').getByText(menu, { exact: true }).click();
    await expect(display.locator('#header_main > div:first-child')).toContainText(name);
    await expect(table.locator('tr:has(td)')).toHaveCount(1);
    await expect(missingRow).toHaveCount(0);
    await expect(controlValue).toHaveText('12');
  });
});
