import { expect, type Page } from '@playwright/test';
import { chooseTag, deleteVirtualDeviceIfPresent, ensureVirtualDevice, ensureVirtualTag, openDeviceTags, openDeviceTree } from './scada';
import { deleteViewRow, openViewList, viewRow } from './view';
import { saveOwned } from './owned';

export async function cleanupTrigger(page: Page, device: string, name: string) {
  for (const selector of ['#form_edit_if_alarm', '#form_edit_link_tag_value']) {
    const form = page.locator(selector);
    if (await form.isVisible()) await form.locator('#form_cancel').click();
  }
  const formula = page.locator('#form_edit_formula');
  if (await formula.isVisible()) await formula.locator('.btn.cancel').click();
  await openViewList(page, 'Триггеры');
  if (await viewRow(page, name).count()) await deleteViewRow(page, name, 'Удалить триггер');
  await openViewList(page, 'Триггеры');
  await expect(viewRow(page, name)).toHaveCount(0);
  await deleteVirtualDeviceIfPresent(page, device);
  await openDeviceTree(page);
  await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
}

export async function prepareTrigger(page: Page, device: string, name: string) {
  await cleanupTrigger(page, device, name);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  await ensureVirtualTag(page, { id: 2, name: 'Source', type: 'Float' });
  await ensureVirtualTag(page, { id: 3, name: 'Dest', type: 'Float' });
  for (const tag of ['Source', 'Dest']) {
    await expect(page.locator('#table_option tr').filter({ hasText: tag }).locator('td[id^="v"]')).toHaveText('0');
  }
  await openViewList(page, 'Триггеры');
  await page.locator('#header_main .btn_add[onclick="os.tags.links.edit(\'-\')"]').click();
  const form = page.locator('#form_edit_link_tag_value');
  await expect(form).toBeVisible();
  await form.locator('#name').fill(name);
  await chooseTag(page, form.locator('#source_tag').locator('..'), device, 'Source');
  await chooseTag(page, form.locator('#dest_tag').locator('..'), device, 'Dest');
  const picker = form.locator('#formula_out').locator('..');
  const box = await picker.boundingBox();
  if (!box) throw new Error('Не виден выбор формулы триггера');
  await picker.click({ position: { x: box.width - 6, y: box.height / 2 } });
  const formula = page.locator('#form_edit_formula');
  await expect(formula).toBeVisible();
  await formula.locator('.CodeMirror').click();
  await page.keyboard.insertText('1');
  await formula.locator('#btn_set_formula_tag').click();
  await expect(form.locator('#formula_out')).toHaveValue('1');
  const id = await saveOwned(page, '/save_link_tag_value/', 'link_id', () => form.locator('#form_ok').click());
  await expect(viewRow(page, name)).toHaveAttribute('rec_id', id);
  await expect(viewRow(page, name)).toBeVisible();
  await editTriggerThreshold(page, name, '0', true);
}

export async function editTriggerThreshold(page: Page, name: string, value: string, add = false) {
  const loaded = page.waitForResponse(response => response.url().includes('/edit_if_link_tag_value/') && response.ok(), { timeout: 10_000 });
  await viewRow(page, name).locator('td.alarm').click();
  await loaded;
  const form = page.locator('#form_edit_if_alarm');
  await expect(form).toBeVisible();
  const condition = form.locator('.fields .div_tr');
  if (add) await form.locator('.buttons .btn_add').filter({ hasText: 'Добавить' }).click();
  await expect(condition).toHaveCount(1);
  await condition.locator('select').selectOption('more');
  await condition.locator('input').fill(value);
  const saved = page.waitForResponse(response => response.url().includes('/save_if_link_tag_value/') && response.ok(), { timeout: 10_000 });
  await form.locator('#form_ok').click();
  await saved;
  await expect(viewRow(page, name).locator('td.alarm')).toContainText(`v>${value}`);
}

export async function openTriggerTags(page: Page, device: string) {
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  const dest = page.locator('#table_option tr').filter({ hasText: 'Dest' }).locator('td[id^="v"]');
  await expect(dest).toHaveText('0');
  return dest;
}
