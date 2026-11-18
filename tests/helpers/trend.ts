import { expect, type Page } from '@playwright/test';
import { saveOwned } from './owned';
import { deleteMenuLink, ensureMenuLink, openMenuEditor } from './menu';
import {
  chooseTag, deleteTrend, deleteVirtualDeviceIfPresent, ensureVirtualDevice, ensureVirtualTag,
  openDeviceTags, openDeviceTree, openTrendConfig, openTrendList,
} from './scada';

const owned = new WeakMap<Page, string>();

export async function removeOperatorTrend(page: Page, name: string) {
  if (owned.get(page) !== name) return;
  await openMenuEditor(page);
  const link = page.locator('#panel_main2 #main .devices_tree_title').and(page.getByText(name, { exact: true }));
  if (await link.count()) await deleteMenuLink(page, link);
  await openMenuEditor(page);
  await expect(link).toHaveCount(0);
  await openTrendList(page);
  const trend = page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name, exact: true }) });
  if (await trend.count()) await deleteTrend(page, name);
  await openTrendList(page);
  await expect(trend).toHaveCount(0);
  await deleteVirtualDeviceIfPresent(page, `${name}Device`);
  await openDeviceTree(page);
  await expect(page.locator('.devices_tree_title').and(page.getByText(`${name}Device`, { exact: true }))).toHaveCount(0);
  owned.delete(page);
}

export async function prepareOperatorTrend(page: Page, name: string) {
  const device = `${name}Device`;
  await openMenuEditor(page);
  await expect(page.locator('#panel_main2 #main .devices_tree_title').and(page.getByText(name, { exact: true })), 'Существующий пункт меню не изменяем').toHaveCount(0);
  await openTrendList(page);
  await expect(page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name, exact: true }) }), 'Существующий тренд не изменяем').toHaveCount(0);
  await openDeviceTree(page);
  await expect(page.locator('.devices_tree_title').and(page.getByText(device, { exact: true })), 'Существующее устройство не изменяем').toHaveCount(0);
  owned.set(page, name);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  await ensureVirtualTag(page, { id: 2, name: 'Level', type: 'Float' });
  await openTrendList(page);
  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
  await page.locator('#form_edit_main_trend #name').fill(name);
  await saveOwned(page, '/save_main_trend/', 'main_trend_id', () => page.locator('#form_edit_main_trend #form_ok').click());
  await openTrendConfig(page, name);
  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить секцию' }).click();
  await page.locator('#form_edit_section_trend #name').fill('Values');
  await page.locator('#form_edit_section_trend #form_ok').click();
  const section = page.locator('#panel_main2 [id^="table_section_id_"]');
  await expect(section).toHaveCount(1);
  await section.locator('th .btn_add[onclick*="os.trends.edit"]').click();
  const form = page.locator('#form_edit_trend');
  await chooseTag(page, form.locator('.select_tag_tree'), device, 'Level');
  await form.locator('#title').fill('Level');
  await form.locator('#form_ok').click();
  await ensureMenuLink(page, name);
  await page.locator('#menu_main').getByText(name, { exact: true }).click();
  await expect(page.locator('#main_canvas')).toBeVisible();
}
