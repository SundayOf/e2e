import { saveOwned } from './helpers/owned';
import { expect, test } from './helpers/test';
import {
  projectName,
  chooseTag, deleteTrend, deleteVirtualDeviceIfPresent, ensureProject, ensureVirtualDevice,
  ensureVirtualTag, openDeviceTags, openDeviceTree, openProject, openTrendConfig,
  openTrendList, signIn,
} from './helpers/scada';
import { prepareOperatorTrend, removeOperatorTrend } from './helpers/trend';

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
});

test('Сохранение цвета линии тренда', { tag: ['@trend', '@f03', '@base'] }, async ({ page, onCleanup }) => {
  const deviceName = 'TrendColorDevice';
  const name = 'TrendColorTest';
  const form = page.locator('#form_edit_trend');
  await openTrendList(page);
  const trend = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name, exact: true }) });
  if (await trend.count()) await deleteTrend(page, name);

  onCleanup(async () => {
    if (await page.locator('#color_dialog_lite').isVisible()) await page.locator('#color_dialog_lite input.Cancel').click();
    for (const selector of ['#form_edit_trend', '#form_edit_section_trend', '#form_edit_main_trend']) {
      if (await page.locator(selector).isVisible()) await page.locator(`${selector} #form_cancel`).click();
    }
    await openTrendList(page);
    if (await trend.count()) await deleteTrend(page, name);
    await deleteVirtualDeviceIfPresent(page, deviceName);
  });
  await deleteVirtualDeviceIfPresent(page, deviceName);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, deviceName);
  await openDeviceTags(page, deviceName);
  await ensureVirtualTag(page, { id: 2, name: 'Level', type: 'Float' });
  await openTrendList(page);
  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
  await page.locator('#form_edit_main_trend #name').fill(name);
  await saveOwned(page, '/save_main_trend/', 'main_trend_id', () => page.locator('#form_edit_main_trend #form_ok').click());
  await expect(trend).toBeVisible();

  await openTrendConfig(page, name);
  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить секцию' }).click();
  await page.locator('#form_edit_section_trend #name').fill('Tank');
  await page.locator('#form_edit_section_trend #form_ok').click();
  const section = page.locator('#panel_main2 [id^="table_section_id_"]');
  await expect(section).toHaveCount(1);

  await section.locator('th .btn_add[onclick*="os.trends.edit"]').click();
  await chooseTag(page, form.locator('.select_tag_tree'), deviceName, 'Level');
  await form.locator('#title').fill('Tank level');
  await form.locator('#trend_color').click();
  const color = page.locator('#color_dialog_lite');
  await expect(color).toBeVisible();
  await color.locator('.QuickColor[title="#ff0000ff"]').click();
  await color.locator('input.Ok').click();
  await expect(form.locator('#trend_color')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
  await form.locator('#form_ok').click();

  const row = section.locator('tr[rec_id]').filter({ hasText: `${deviceName}//Level` });
  await expect(row).toContainText('Tank level');
  await expect(row.locator('td:nth-child(5) .circle_color')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
  await openTrendConfig(page, name);
  const saved = page.locator('#panel_main2 tr[rec_id]').filter({ hasText: `${deviceName}//Level` });
  await expect(saved.locator('td:nth-child(5) .circle_color')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
  await saved.locator('td.edit').click();
  await expect(form.locator('#title')).toHaveValue('Tank level');
  await expect(form.locator('#trend_color')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
  await form.locator('#form_cancel').click();
});

test('Скрытие и показ шкалы тренда', { tag: ['@trend', '@f03', '@base'] }, async ({ page, onCleanup }) => {
  const name = 'TrendUiScale';
  onCleanup(async () => {
    await removeOperatorTrend(page, name);
  });
  await prepareOperatorTrend(page, name);
  const scale = page.locator('#btn_vis_scale');
  await expect(scale).toBeVisible();
  const original = (await scale.getAttribute('class'))?.includes('vis_scale1') ? 'vis_scale1' : 'vis_scale0';
  const toggled = original === 'vis_scale1' ? 'vis_scale0' : 'vis_scale1';
  await scale.click();
  await expect(scale).toHaveClass(new RegExp(`\\b${toggled}\\b`));
  await expect(page.locator('#section_0')).toBeVisible();
  await scale.click();
  await expect(scale).toHaveClass(new RegExp(`\\b${original}\\b`));
});
