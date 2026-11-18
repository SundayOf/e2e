import { saveOwned } from './helpers/owned';
import { expect, test } from './helpers/test';
import {
  projectName,
  chooseTag, deleteAlarm, deleteTrend, deleteVirtualDevice, deleteVirtualDeviceIfPresent, ensureAlarmThreshold,
  ensureProject, ensureTagAlarm, ensureVirtualDevice, ensureVirtualTag, openDeviceTags,
  openDeviceTree, openProject, openTagAlarms, openTrendConfig, openTrendList, renameVirtualDevice, setTagFormula, signIn,
} from './helpers/scada';
import { alarmName, alarmTag, cleanupAlarmTag, prepareAlarmTag } from './helpers/alarm';
import { deleteMnemonic, ensureMnemonic } from './helpers/mnemonic';
import { deleteMenuLink, ensureMenuLink, openMenuEditor } from './helpers/menu';

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
});

test('Создание, изменение и удаление виртуального устройства', { tag: ['@project', '@base'] }, async ({ page, onCleanup }) => {
  const originalName = 'Датчик уровня';
  const editedName = 'Датчик уровня бака';
  await openDeviceTree(page);
  if (await page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${editedName}$`) }).count()) {
    await deleteVirtualDevice(page, editedName);
  }
  if (await page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${originalName}$`) }).count()) {
    await deleteVirtualDevice(page, originalName);
  }
  onCleanup(async () => {
    if (await page.locator('#form_edit_device_hub').isVisible()) await page.locator('#form_edit_device_hub #form_cancel').click();
    await openDeviceTree(page);
    for (const name of [editedName, originalName]) {
      if (await page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${name}$`) }).count()) {
        await deleteVirtualDevice(page, name);
      }
    }
  });
  await ensureVirtualDevice(page, originalName);
  await renameVirtualDevice(page, originalName, editedName);
});

test('Создание, изменение и удаление тега', { tag: ['@tags', '@base'] }, async ({ page, onCleanup }) => {
  const deviceName = 'Клапаны бака';
  const originalName = 'Клапан подачи';
  const editedName = 'Входной клапан';
  onCleanup(async () => {
    if (await page.locator('#form_edit_tag').isVisible()) await page.locator('#form_edit_tag #form_cancel').click();
    await deleteVirtualDeviceIfPresent(page, deviceName);
  });
  await deleteVirtualDeviceIfPresent(page, deviceName);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, deviceName);
  await openDeviceTags(page, deviceName);
  const original = await ensureVirtualTag(page, { id: 5, name: originalName, type: 'Boolean' });
  await original.locator('td.edit').click();
  const form = page.locator('#form_edit_tag');
  await expect(form.locator('#title')).toHaveValue(originalName);
  await form.locator('#title').fill(editedName);
  await form.locator('#form_ok').click();
  await expect(page.locator('#table_option tr').filter({ hasText: editedName })).toBeVisible();
});

test('Создание, изменение и удаление формулы', { tag: ['@tags', '@base'] }, async ({ page, onCleanup }) => {
  const deviceName = 'FormulaDevice';
  const name = 'FormulaTest';
  onCleanup(async () => {
    if (await page.locator('#form_edit_formula').isVisible()) await page.locator('#form_edit_formula .btn.cancel').click();
    if (await page.locator('#form_edit_tag').isVisible()) await page.locator('#form_edit_tag #form_cancel').click();
    await deleteVirtualDeviceIfPresent(page, deviceName);
  });
  await deleteVirtualDeviceIfPresent(page, deviceName);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, deviceName);
  await openDeviceTags(page, deviceName);
  await ensureVirtualTag(page, { id: 2, name: 'ValveIn', type: 'Boolean' });
  await ensureVirtualTag(page, { id: 3, name: 'ValveOut', type: 'Boolean' });
  await ensureVirtualTag(page, { id: 5, name, type: 'Float' });
  const row = page.locator('#table_option tr[fn="formulatest"]');
  await setTagFormula(page, name, `#+[${deviceName}//ValveIn]-[${deviceName}//ValveOut]`);
  await expect(row).toContainText('Fx');
  await setTagFormula(page, name, `#+[${deviceName}//ValveIn]`);
  await setTagFormula(page, name, '');
  await expect(row).not.toContainText('Fx');
});

test('Создание, изменение и удаление аварии', { tag: ['@alarm', '@base'] }, async ({ page, onCleanup }) => {
  const editedName = 'Критический уровень бака';
  onCleanup(async () => {
    await cleanupAlarmTag(page, [editedName]);
  });
  await prepareAlarmTag(page, [editedName]);
  await openTagAlarms(page, alarmTag);
  const rows = page.locator('#table_edit_alarms tr');
  const original = await ensureTagAlarm(page, alarmName);
  await ensureAlarmThreshold(page, alarmName, 'more', '100');
  await original.locator('td.edit').last().click();
  const form = page.locator('#form_edit_alarm');
  await expect(form.locator('#name')).toHaveValue(alarmName);
  await form.locator('#name').fill(editedName);
  await form.locator('#form_ok').click();
  await expect(rows.filter({ hasText: editedName })).toBeVisible();
  await deleteAlarm(page, editedName);
  await expect(rows.filter({ hasText: editedName })).toHaveCount(0);
});

test('Создание, изменение и удаление мнемосхемы', { tag: ['@mnemonic', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const originalName = 'Бак тест';
  const editedName = 'Бак тест 2';
  await page.locator('[title="Мнемосхемы"]').click();
  const rows = page.locator('#table_option tr');
  const find = (name: string) => rows.filter({ has: page.getByRole('cell', { name, exact: true }) });
  for (const name of [editedName, originalName]) if (await find(name).count()) await deleteMnemonic(page, name);
  onCleanup(async () => {
    if (await page.locator('#form_edit_mnemonic').isVisible()) await page.locator('#form_edit_mnemonic #form_cancel').click();
    for (const name of [editedName, originalName]) if (await find(name).count()) await deleteMnemonic(page, name);
  });
  await ensureMnemonic(page, originalName);
  const form = page.locator('#form_edit_mnemonic');
  await find(originalName).locator('td.edit').click();
  await expect(form.locator('#name')).toHaveValue(originalName);
  await form.locator('#name').fill(editedName);
  await form.locator('#form_ok').click();
  await expect(find(editedName)).toBeVisible();
});

test('Создание, изменение и удаление ссылки меню', { tag: ['@menu', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const targetName = 'MenuCrudTarget';
  const originalName = 'MenuCrud';
  const editedName = 'MenuCrud2';
  const menuRow = (name: string) => page.locator('#panel_main2 #main .devices_tree_title').filter({ hasText: new RegExp(`^${name}$`) });
  onCleanup(async () => {
    if (await page.locator('#form_select_data_nodes').isVisible()) await page.locator('#form_select_data_nodes #form_cancel').click();
    if (await page.locator('#form_edit_menu_item').isVisible()) await page.locator('#form_edit_menu_item #form_cancel').click();
    await openMenuEditor(page);
    for (const name of [editedName, originalName]) if (await menuRow(name).count()) await deleteMenuLink(page, name);
    await page.locator('[title="Мнемосхемы"]').click();
    await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
    const target = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name: targetName, exact: true }) });
    if (await target.count()) await deleteMnemonic(page, targetName);
  });
  await openMenuEditor(page);
  for (const name of [editedName, originalName]) if (await menuRow(name).count()) await deleteMenuLink(page, name);
  await page.locator('[title="Мнемосхемы"]').click();
  await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
  const target = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name: targetName, exact: true }) });
  if (await target.count()) await deleteMnemonic(page, targetName);
  await ensureMnemonic(page, targetName);
  await ensureMenuLink(page, originalName, targetName);
  const row = menuRow(originalName);
  await row.click();
  await row.click({ button: 'right' });
  await page.locator('#item_menu_edit > button').click();
  const form = page.locator('#form_edit_menu_item');
  await expect(form.locator('#name')).toHaveValue(originalName);
  await expect(form.locator('#object_path')).toHaveValue(targetName);
  await form.locator('#name').fill(editedName);
  await form.locator('#form_ok').click();
  await expect(page.locator('#menu_main').getByText(editedName, { exact: true })).toBeVisible();
});

test('Создание, изменение и удаление тренда, секции и тега', { tag: ['@trend', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const deviceName = 'TrendCrudDevice';
  const originalName = 'Тренд тест';
  const editedName = 'Тренд тест 2';
  onCleanup(async () => {
    for (const form of ['#form_edit_trend', '#form_edit_section_trend', '#form_edit_main_trend']) {
      if (await page.locator(form).isVisible()) await page.locator(`${form} #form_cancel`).click();
    }
    await openTrendList(page);
    for (const name of [editedName, originalName]) {
      if (await page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name, exact: true }) }).count()) await deleteTrend(page, name);
    }
    await deleteVirtualDeviceIfPresent(page, deviceName);
  });
  await openTrendList(page);
  for (const name of [editedName, originalName]) {
    if (await page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name, exact: true }) }).count()) await deleteTrend(page, name);
  }
  await deleteVirtualDeviceIfPresent(page, deviceName);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, deviceName);
  await openDeviceTags(page, deviceName);
  await ensureVirtualTag(page, { id: 2, name: 'Level', type: 'Float', trend: 5000 });
  await openTrendList(page);
  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
  await page.locator('#form_edit_main_trend #name').fill(originalName);
  await saveOwned(page, '/save_main_trend/', 'main_trend_id', () => page.locator('#form_edit_main_trend #form_ok').click());
  await expect(page.locator('#table_option tr[fn="тренд тест"]')).toBeVisible();

  await openTrendConfig(page, originalName);
  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить секцию' }).click();
  const sectionForm = page.locator('#form_edit_section_trend');
  await sectionForm.locator('#name').fill('SectionTest');
  await sectionForm.locator('#form_ok').click();
  const section = page.locator('#panel_main2 [id^="table_section_id_"]');
  await expect(section).toHaveCount(1);
  await expect(section).toContainText('SectionTest');

  await section.locator('th .btn_add[onclick*="os.trends.edit"]').click();
  const tagForm = page.locator('#form_edit_trend');
  await chooseTag(page, tagForm.locator('.select_tag_tree'), deviceName, 'Level');
  await expect(tagForm.locator('#select_tag_tree_value')).toHaveValue(`${deviceName}//Level`);
  await tagForm.locator('#title').fill('LevelTest');
  await tagForm.locator('#form_ok').click();
  const tagRow = section.locator('tr[rec_id]').filter({ hasText: `${deviceName}//Level` });
  await expect(tagRow).toContainText('LevelTest');
  await tagRow.locator('td.edit').click();
  await expect(tagForm.locator('#title')).toHaveValue('LevelTest');
  await tagForm.locator('#title').fill('LevelTest2');
  await tagForm.locator('#form_ok').click();
  await expect(tagRow).toContainText('LevelTest2');

  await tagRow.locator('td.delete').click();
  const confirm = page.locator('#my_confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Удалить тег?');
  await confirm.locator('#btn_ok_confirm').click();
  await expect(tagRow).toHaveCount(0);

  await section.locator('th .btn_add[onclick^="os.trends.section.edit"]').click();
  await expect(sectionForm.locator('#name')).toHaveValue('SectionTest');
  await sectionForm.locator('#name').fill('SectionTest2');
  await sectionForm.locator('#form_ok').click();
  await expect(section).toContainText('SectionTest2');
  await section.locator('th .btn_cancel[onclick="os.trends.section.delete(this)"]').click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Удалить секцию?');
  await confirm.locator('#btn_ok_confirm').click();
  await expect(section).toHaveCount(0);

  await openTrendList(page);
  await page.locator('#table_option tr[fn="тренд тест"]').locator('td.edit').click();
  const form = page.locator('#form_edit_main_trend');
  await expect(form.locator('#name')).toHaveValue(originalName);
  await form.locator('#name').fill(editedName);
  await form.locator('#form_ok').click();
  await expect(page.locator('#table_option tr[fn="тренд тест 2"]')).toBeVisible();
});
