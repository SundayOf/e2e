import { saveOwned } from './helpers/owned';
import { expect, test } from './helpers/test';
import { projectName, ensureProject, openProject, signIn } from './helpers/scada';
import { addLinkerObject, cleanupViewRows, deleteViewRow, openViewList, viewRow } from './helpers/view';
import { deleteMnemonic, ensureMnemonic } from './helpers/mnemonic';
import { prepareOperatorTrend, removeOperatorTrend } from './helpers/trend';

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
});

test('Поиск мнемосхемы', { tag: ['@mnemonic', '@base'] }, async ({ page, onCleanup }) => {
  const name = 'FilterTest';
  const row = page.locator('#table_option tr[fn="filtertest"]');
  await page.locator('[title="Мнемосхемы"]').click();
  await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
  if (await row.count()) await deleteMnemonic(page, name);
  onCleanup(async () => {
    await page.locator('[title="Мнемосхемы"]').click();
    await page.locator('#filter_name').fill('');
    await page.locator('#filter_name').press('Enter');
    await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
    if (await row.count()) await deleteMnemonic(page, name);
  });
  await ensureMnemonic(page, name);
  await page.locator('#filter_name').fill(name);
  await page.locator('#filter_name').press('Enter');
  await expect(row).toBeVisible();
  await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeHidden();
  await page.locator('#filter_name').fill('');
  await page.locator('#filter_name').press('Enter');
  await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
});

test('Скрытие и показ легенды тренда', { tag: ['@trend', '@base'] }, async ({ page, onCleanup }) => {
  const name = 'TrendUiLegend';
  onCleanup(async () => {
    await removeOperatorTrend(page, name);
  });
  await prepareOperatorTrend(page, name);
  await expect(page.locator('#vis_legend .title_it')).toHaveText('Level');
  await page.locator('[title="Скрыть легенду"]').click();
  await expect(page.locator('#vis_legend')).toBeHidden();
  await page.locator('[title="Показать легенду"]').click();
  await expect(page.locator('#vis_legend .title_it')).toHaveText('Level');
});

test('Переключение тренда между архивом и онлайн', { tag: ['@trend', '@base'] }, async ({ page, onCleanup }) => {
  const name = 'TrendUiOnline';
  onCleanup(async () => {
    await removeOperatorTrend(page, name);
  });
  await prepareOperatorTrend(page, name);
  const mode = page.locator('#play_trend_dt');
  await expect(mode).toHaveClass(/cplay/);
  await mode.click();
  await expect(mode).not.toHaveClass(/cplay/);
  await mode.click();
  await expect(mode).toHaveClass(/cplay/);
});

test('Создание, изменение и удаление компоновщика', { tag: ['@layout', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const title = 'Компоновщики';
  const form = page.locator('#form_edit_linker');
  const original = 'LayoutTest';
  const edited = 'LayoutTest2';
  const mnemonic = 'LayoutTarget';
  const trend = 'LayoutTrend';
  onCleanup(async () => {
    if (await form.isVisible()) await form.locator('#form_cancel').click();
    await cleanupViewRows(page, title, [edited, original], 'Удалить компоновщик(и)?');
    await removeOperatorTrend(page, trend);
    await page.locator('[title="Мнемосхемы"]').click();
    await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
    const target = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name: mnemonic, exact: true }) });
    if (await target.count()) await deleteMnemonic(page, mnemonic);
  });
  await cleanupViewRows(page, title, [edited, original], 'Удалить компоновщик(и)?');
  await prepareOperatorTrend(page, trend);
  await page.locator('[title="Мнемосхемы"]').click();
  await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
  const target = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name: mnemonic, exact: true }) });
  if (await target.count()) await deleteMnemonic(page, mnemonic);
  await ensureMnemonic(page, mnemonic);
  await openViewList(page, title);
  await page.locator('#header_main .btn_add[onclick="os.linkers.edit(\'-\')"]').click();
  await expect(form).toBeVisible();
  await form.locator('#name').fill(original);
  await saveOwned(page, '/save_linker/', 'linker_id', () => form.locator('#form_ok').click());
  await expect(viewRow(page, original)).toBeVisible();

  const popup = page.waitForEvent('popup');
  await viewRow(page, original).locator('td.mnemonic_editor').click();
  const editor = await popup;
  try {
    await addLinkerObject(editor, 'мнемосхему', mnemonic);
    await addLinkerObject(editor, 'тренд', trend);
    await editor.locator('#panel_top [title="Сохранить"]').click();
    await editor.reload();
    await expect(editor.locator('.ace_text-input')).toHaveValue(new RegExp(`mnemonic-path="${mnemonic}"`));
    await expect(editor.locator('.ace_text-input')).toHaveValue(new RegExp(`trend-path="${trend}"`));
  } finally {
    await editor.close();
  }

  await openViewList(page, title);
  await viewRow(page, original).locator('td.edit').click();
  await expect(form.locator('#name')).toHaveValue(original);
  await form.locator('#name').fill(edited);
  await form.locator('#form_ok').click();
  await expect(viewRow(page, edited)).toBeVisible();

  await openViewList(page, title);
  await deleteViewRow(page, edited, 'Удалить компоновщик(и)?');
  await openViewList(page, title);
  await expect(viewRow(page, edited)).toHaveCount(0);
});

test('Создание, изменение и удаление отключённой камеры', { tag: ['@camera', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const title = 'Камеры IP';
  const form = page.locator('#form_edit_camera');
  const original = 'CameraTest';
  const edited = 'CameraTest2';
  await cleanupViewRows(page, title, [edited, original], 'Удалить камеру(ы)?', 'Камеры');
  onCleanup(async () => {
    if (await form.isVisible()) await form.locator('#form_cancel').click();
    await cleanupViewRows(page, title, [edited, original], 'Удалить камеру(ы)?', 'Камеры');
  });
  await page.locator('#header_main .btn_add[onclick="os.cameras.edit(\'-\')"]').click();
  await expect(form).toBeVisible();
  await form.locator('#name').fill(original);
  await form.locator('#url').fill('rtsp://127.0.0.1:8554/e2e');
  await form.locator('label.edit_cb span').click();
  await expect(form.locator('#enabled')).not.toBeChecked();
  await saveOwned(page, '/save_camera/', 'camera_id', () => form.locator('#form_ok').click());
  await expect(viewRow(page, original)).toBeVisible();

  await openViewList(page, title, 'Камеры');
  await viewRow(page, original).locator('td.edit').click();
  await expect(form.locator('#name')).toHaveValue(original);
  await expect(form.locator('#url')).toHaveValue('rtsp://127.0.0.1:8554/e2e');
  await expect(form.locator('#enabled')).not.toBeChecked();
  await form.locator('#name').fill(edited);
  await form.locator('#url').fill('rtsp://127.0.0.1:8554/e2e2');
  await form.locator('#form_ok').click();
  await expect(viewRow(page, edited)).toBeVisible();

  await openViewList(page, title, 'Камеры');
  await viewRow(page, edited).locator('td.edit').click();
  await expect(form.locator('#url')).toHaveValue('rtsp://127.0.0.1:8554/e2e2');
  await expect(form.locator('#enabled')).not.toBeChecked();
  await form.locator('#form_cancel').click();
  await deleteViewRow(page, edited, 'Удалить камеру(ы)?');
  await openViewList(page, title, 'Камеры');
  await expect(viewRow(page, edited)).toHaveCount(0);
});

test('Создание, изменение и удаление карты', { tag: ['@map', '@base'] }, async ({ page, onCleanup }) => {
  const title = 'Карты';
  const form = page.locator('#form_edit_map');
  const original = 'MapTest';
  const edited = 'MapTest2';
  await cleanupViewRows(page, title, [edited, original], 'Удалить карту(ы)?');
  onCleanup(async () => {
    if (await form.isVisible()) await form.locator('#form_cancel').click();
    await cleanupViewRows(page, title, [edited, original], 'Удалить карту(ы)?');
  });
  await page.locator('#header_main .btn_add[onclick="os.maps.edit(\'-\')"]').click();
  await expect(form).toBeVisible();
  await form.locator('#name').fill(original);
  await form.locator('#lat').fill('55.75');
  await form.locator('#lon').fill('37.62');
  await form.locator('#scale').fill('15');
  await saveOwned(page, '/save_map/', 'map_id', () => form.locator('#form_ok').click());
  await expect(viewRow(page, original)).toBeVisible();

  await openViewList(page, title);
  await viewRow(page, original).locator('td.edit').click();
  await expect(form.locator('#name')).toHaveValue(original);
  await expect(form.locator('#lat')).toHaveValue('55.75');
  await expect(form.locator('#lon')).toHaveValue('37.62');
  await expect(form.locator('#scale')).toHaveValue('15');
  await form.locator('#name').fill(edited);
  await form.locator('#scale').fill('12');
  await form.locator('#form_ok').click();
  await expect(viewRow(page, edited)).toBeVisible();

  await openViewList(page, title);
  await viewRow(page, edited).locator('td.edit').click();
  await expect(form.locator('#scale')).toHaveValue('12');
  await form.locator('#form_cancel').click();
  await deleteViewRow(page, edited, 'Удалить карту(ы)?');
  await openViewList(page, title);
  await expect(viewRow(page, edited)).toHaveCount(0);
});
