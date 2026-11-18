import { expect, type Page } from '@playwright/test';
import { requireOwned, saveOwned } from './owned';

export async function ensureMnemonic(page: Page, name: string) {
  await page.locator('[title="Мнемосхемы"]').click();
  await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
  const row = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name, exact: true }) });
  if (await row.count()) {
    await requireOwned(page, row);
    return row;
  }
  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
  const form = page.locator('#form_edit_mnemonic');
  await expect(form).toBeVisible();
  await form.locator('#name').fill(name);
  await form.locator('#type_mnemonic').selectOption({ label: 'Мнемосхема' });
  const id = await saveOwned(page, '/save_mnemonic/', 'mnemonic_id', () => form.locator('#form_ok').click());
  await expect(row).toHaveAttribute('rec_id', id);
  await expect(row).toBeVisible();
  return row;
}

export async function openMnemonicEditor(page: Page, name: string) {
  const row = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name, exact: true }) });
  const popup = page.waitForEvent('popup');
  await row.locator('td.mnemonic_editor').click();
  const editor = await popup;
  await expect(editor.locator('#my_svg')).toBeVisible();
  return editor;
}

export async function saveMnemonicEditor(editor: Page) {
  const saved = editor.waitForResponse(response => response.url().includes('/save_editor_mnemonic/') && response.request().method() === 'POST');
  await editor.locator('#panel_top [title="Сохранить"]').click();
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  await response.finished();
}

export async function pasteLibraryGroup(editor: Page, libraryName: string, treeId: string) {
  await editor.locator('#btn_lib').click();
  const popup = editor.waitForEvent('popup');
  await editor.locator('#form_select_library .table_option_lib tr').filter({ hasText: libraryName }).click();
  const library = await popup;
  await library.locator('label[for="tree_elements_box_tab"]').click();
  await library.locator(`#tree_${treeId} span`).click();
  await library.keyboard.press('Control+C');
  await editor.bringToFront();
  await editor.locator('#canvas').click();
  await editor.keyboard.press('Control+V');
  await library.close();
}

export async function selectTankLevelRect(editor: Page) {
  await editor.locator('label[for="tree_elements_box_tab"]').click();
  await editor.locator('#tree_g64m27 > .btn_tree_plus').click();
  await editor.locator('#tree_rect32m27 span').click();
}

export async function deleteMnemonic(page: Page, name: string) {
  const row = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name, exact: true }) });
  await requireOwned(page, row);
  await row.locator('td.delete').click();
  const confirm = page.locator('#my_confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Удалить мнемосхему(ы)?');
  const deleted = page.waitForResponse(response => response.url().includes('/delete_mnemonic/') && response.ok());
  await confirm.locator('#btn_ok_confirm').click();
  await deleted;
  await expect(row).toHaveCount(0);
  await page.locator('[title="Мнемосхемы"]').click();
  await expect(row).toHaveCount(0);
}
