import { expect, test } from './helpers/test';
import { deleteVirtualDeviceIfPresent, ensureProject, ensureVirtualDevice, openDeviceTree, openProject, projectName, signIn, signInAsTest } from './helpers/scada';
import { deleteMenuLink, ensureMenuLink, openMenuEditor } from './helpers/menu';
import { deleteMnemonic, ensureMnemonic } from './helpers/mnemonic';

test.beforeEach(async ({ page }, testInfo) => {
  await (testInfo.tags.includes('@admin') ? signInAsTest : signIn)(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
});

const lists = [
  { title: 'Группы', add: "os.groups_users.edit('')", tag: '@access' },
  { title: 'Пользователи', add: "os.users.edit('')", tag: '@access' },
  { title: 'Драйверы', add: "os.drivers.edit('')", tag: '@project' },
  { title: 'Мнемосхемы', add: "os.mnemonics.edit('-')", tag: '@mnemonic' },
  { title: 'Аварии', add: "os.alarms.edit('-')", tag: '@alarm' },
  { title: 'Тренды', add: "os.trends.main.edit('-')", tag: '@trend' },
] as const;

for (const { title, add, tag } of lists) {
  test(`${title}: список и кнопка добавления`, { tag: [tag, '@base'] }, async ({ page }) => {
    await page.locator(`#panel_right [title="${title}"]`).click();
    await expect(page.locator('#header_main > div:first-child')).toContainText(title);
    await expect(page.locator('#header_main #count_data')).toHaveText(/^\d+$/);
    await expect(page.locator('#table_option')).toBeVisible();
    await expect(page.locator(`#header_main .btn_add[onclick="${add}"]`)).toBeVisible();
  });
}

const emptyLists = [
  { title: 'Таблицы тегов', add: "os.tags.table.edit('-')", form: '#form_edit_table_tags', formTitle: 'Добавить таблицу тегов', tag: '@tags' },
  { title: 'Триггеры', add: "os.tags.links.edit('-')", form: '#form_edit_link_tag_value', formTitle: 'Добавить триггер', tag: '@trigger' },
  { title: 'Компоновщики', add: "os.linkers.edit('-')", form: '#form_edit_linker', formTitle: 'Добавить компоновщик', tag: '@layout' },
  { title: 'Отчеты', add: "os.reports.edit('-')", form: '#form_edit_report', formTitle: 'Добавить отчет', tag: '@jobs' },
  { title: 'Планировщики', add: "os.planners.edit('-')", form: '#form_edit_planner', formTitle: 'Добавить планировщик', tag: '@jobs' },
  { title: 'Камеры IP', heading: 'Камеры', add: "os.cameras.edit('-')", form: '#form_edit_camera', formTitle: 'Добавить камеру', tag: '@camera' },
  { title: 'Карты', add: "os.maps.edit('-')", form: '#form_edit_map', formTitle: 'Добавить карту', tag: '@map' },
] as const;

for (const { title, add, form, formTitle, tag, ...rest } of emptyLists) {
  test(`${title}: отмена добавления`, { tag: [tag, '@base'] }, async ({ page }) => {
    await page.locator(`#panel_right [title="${title}"]`).click();
    await expect(page.locator('#header_main > div:first-child')).toContainText('heading' in rest ? rest.heading : title);
    const count = page.locator('#header_main #count_data');
    await expect(count).toHaveText(/^\d+$/);
    const before = await count.textContent();
    const rows = page.locator('#table_option tr[rec_id]');
    const rowCount = await rows.count();
    await page.locator(`#header_main .btn_add[onclick="${add}"]`).click();
    await expect(page.locator(form)).toBeVisible();
    await expect(page.locator(`${form} .header`)).toContainText(formTitle);
    await page.locator(`${form} #form_cancel`).click();
    await expect(page.locator(form)).toBeHidden();
    await expect(count).toHaveText(before ?? '');
    await expect(rows).toHaveCount(rowCount);
  });
}

test('Отображение устройства в дереве проекта', { tag: ['@project', '@base'] }, async ({ page, onCleanup }) => {
  const name = 'MenuTreeDevice';
  onCleanup(async () => {
    await deleteVirtualDeviceIfPresent(page, name);
  });
  await deleteVirtualDeviceIfPresent(page, name);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, name);
  await expect(page.locator('#header_main > div:first-child')).toHaveText('Дерево проекта');
  await expect(page.locator('#panel_main2 #main .devices_tree_title').filter({ hasText: name })).toBeVisible();
});

test('Открытие схемы в редакторе и из меню', { tag: ['@menu', '@base'] }, async ({ page, onCleanup }) => {
  const target = 'MenuViewTarget';
  const link = 'MenuView';
  const row = page.locator('#panel_main2 #main .devices_tree_title').filter({ hasText: /^MenuView$/ });
  onCleanup(async () => {
    await openMenuEditor(page);
    if (await row.count()) await deleteMenuLink(page, link);
    await page.locator('[title="Мнемосхемы"]').click();
    await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
    const targetRow = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name: target, exact: true }) });
    if (await targetRow.count()) await deleteMnemonic(page, target);
  });
  await openMenuEditor(page);
  if (await row.count()) await deleteMenuLink(page, link);
  await page.locator('[title="Мнемосхемы"]').click();
  await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
  const targetRow = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name: target, exact: true }) });
  if (await targetRow.count()) await deleteMnemonic(page, target);
  await ensureMnemonic(page, target);
  await ensureMenuLink(page, link, target);
  await openMenuEditor(page);
  await expect(row).toBeVisible();
  await page.locator('#menu_main').getByText(link, { exact: true }).click();
  await expect(page.locator('#main > svg#my_svg')).toBeVisible();
});

test('Просмотр резервных копий', { tag: ['@files', '@admin', '@base'] }, async ({ page }) => {
  await page.locator('#panel_right [title="Резервные копии"]').click();
  await expect(page.locator('#header_main > div:first-child')).toContainText('Резервных копий:');
  await expect(page.locator('#table_option')).toBeVisible();
});

test('Открытие файлового менеджера', { tag: ['@files', '@base'] }, async ({ page }) => {
  await page.locator('#panel_right [title="Файловый менеджер"]').click();
  await expect(page.locator('#header_main > div:first-child')).toHaveText('Файловый менеджер');
  await expect(page.locator('#panel_main2 #main')).toBeVisible();
});

test('Открытие и закрытие настроек', { tag: ['@menu', '@admin', '@base'] }, async ({ page }) => {
  await page.locator('#panel_right [title="Настройки"]').click();
  const form = page.locator('#form_options');
  await expect(form).toBeVisible();
  await expect(form.locator('#table_options_fonts')).toBeVisible();
  await form.locator('.header > .close_form').click();
  await expect(form).toBeHidden();
});

test('Открытие и закрытие окна «О программе»', { tag: ['@menu', '@admin', '@base'] }, async ({ page }) => {
  await page.locator('#panel_right [title="О программе"]').click();
  const form = page.locator('#form_info_program');
  await expect(form).toBeVisible();
  await expect(form.locator('.header')).toContainText('О программе');
  await form.locator('#form_ok').click();
  await expect(form).toBeHidden();
});
