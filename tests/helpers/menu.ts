import { expect, type Locator, type Page } from '@playwright/test';
import { requireOwned, saveOwned } from './owned';
import { waitForIdle } from './scada';

export async function openMenuEditor(page: Page) {
  await waitForIdle(page);
  const loaded = page.waitForResponse(response => response.url().includes('/edit_menu/') && response.ok());
  await page.locator('[title="Меню"]').click();
  await (await loaded).finished();
  await waitForIdle(page);
  await expect(page.locator('#header_main > div:first-child')).toHaveText('Меню');
}

async function openMenuAddForm(page: Page) {
  await openMenuEditor(page);
  const main = page.locator('#panel_main2 #main');
  const box = await main.boundingBox();
  if (!box) throw new Error('Menu tree is not visible');
  await main.click({ button: 'right', position: { x: Math.min(300, box.width - 10), y: Math.min(100, box.height - 10) } });
  const context = page.locator('#menu_context.show-menu');
  await expect(context).toBeVisible();
  await context.locator('#item_menu_add > button').click();

  const form = page.locator('#form_edit_menu_item');
  await expect(form).toBeVisible();
  return form;
}

export async function createMenuFolder(page: Page, name: string) {
  const form = await openMenuAddForm(page);
  await form.locator('#name').fill(name);
  await form.locator('#type_id').selectOption('0');
  const id = await saveOwned(page, '/save_menu_item/', 'item_id', () => form.locator('#form_ok').click());
  await expect(form).toBeHidden();
  const row = page.locator(`#panel_main2 #main .devices_tree_title[item_id="${id}"]`);
  await expect(row).toHaveText(name);
  return row;
}

export async function ensureMenuLink(page: Page, name: string, objectName = name) {
  const item = page.locator('#menu_main').getByText(name, { exact: true });
  if (await item.count()) {
    await openMenuEditor(page);
    await requireOwned(page, page.locator('#panel_main2 #main .devices_tree_title').and(page.getByText(name, { exact: true })), 'item_id');
    return item;
  }
  const form = await openMenuAddForm(page);
  await form.locator('#name').fill(name);
  await form.locator('#type_id').selectOption('1');
  const picker = form.locator('#div_open_data .select_tag_tree');
  const pickerBox = await picker.boundingBox();
  if (!pickerBox) throw new Error('Menu object picker is not visible');
  await picker.click({ position: { x: pickerBox.width - 6, y: pickerBox.height / 2 } });
  const objects = page.locator('#form_select_data_nodes');
  const object = objects.locator(`.devices_tree_title[name="${objectName}"]`);
  await expect(object).toHaveCount(1);
  await object.click();
  await objects.locator('#form_ok').click();
  await expect(form.locator('#object_path')).toHaveValue(objectName);
  await saveOwned(page, '/save_menu_item/', 'item_id', () => form.locator('#form_ok').click());
  await expect(item).toBeVisible();
  return item;
}

export async function deleteMenuLink(page: Page, target: string | Locator) {
  await openMenuEditor(page);
  const row = typeof target === 'string' ? page.locator('#panel_main2 #main .devices_tree_title').and(page.getByText(target, { exact: true })) : target;
  await requireOwned(page, row, 'item_id');
  await row.click();
  await row.click({ button: 'right' });
  const context = page.locator('#menu_context.show-menu');
  await expect(context).toBeVisible();
  await expect(context.locator('#item_delete_menu')).not.toHaveClass(/disabled/);
  await context.locator('#item_delete_menu > button').click();
  const confirm = page.locator('#my_confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Удалить пункт(ы) меню?');
  await confirm.locator('#btn_ok_confirm').click();
  await expect(row).toHaveCount(0);
  await openMenuEditor(page);
  await expect(row).toHaveCount(0);
}
