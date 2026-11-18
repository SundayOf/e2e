import { expect, type Locator, type Page } from '@playwright/test';
import { requireOwned } from './owned';
import { waitForIdle } from './scada';

export async function openViewList(page: Page, title: string, heading = title) {
  await waitForIdle(page);
  const paths: Record<string, string> = {
    'Компоновщики': '/edit_linkers/',
    'Камеры IP': '/edit_cameras/',
    'Карты': '/edit_maps/',
    'Таблицы тегов': '/list_table_tags/',
    'Триггеры': '/edit_links/',
    'Планировщики': '/edit_planners/',
  };
  const path = paths[title];
  if (!path) throw new Error(`Unknown list: ${title}`);
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === path && response.ok());
  await page.locator(`#panel_right [title="${title}"]`).click();
  const response = await loaded;
  await response.finished();
  await waitForIdle(page);
  await expect(page.locator('#header_main > div:first-child')).toContainText(heading);
  await expect(page.locator('#header_main #count_data')).toHaveText(/^\d+$/);
}

export function viewRow(page: Page, name: string) {
  return page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name, exact: true }) });
}

export async function deleteViewRow(page: Page, target: string | Locator, question: string) {
  const row = typeof target === 'string' ? viewRow(page, target) : target;
  await requireOwned(page, row);
  await row.locator('td.delete').click();
  const confirm = page.locator('#my_confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(question);
  await confirm.locator('#btn_ok_confirm').click();
  await expect(row).toHaveCount(0);
}

export async function cleanupViewRows(page: Page, title: string, names: string[], question: string, heading = title) {
  await openViewList(page, title, heading);
  for (const name of names) if (await viewRow(page, name).count()) await deleteViewRow(page, name, question);
}

export async function addLinkerObject(editor: Page, kind: 'мнемосхему' | 'тренд', name: string) {
  await editor.locator(`#panel_top [title="Добавить ${kind}"]`).click();
  const form = editor.locator('#form_edit_data');
  await expect(form).toBeVisible();
  const picker = form.locator('.select_tag_tree');
  const box = await picker.boundingBox();
  if (!box) throw new Error('Linker object picker is not visible');
  await picker.click({ position: { x: box.width - 6, y: box.height / 2 } });
  const objects = editor.locator('#form_select_data_nodes');
  await expect(objects).toBeVisible();
  await objects.locator(`.devices_tree_title[name="${name}"]`).click();
  await objects.locator('#form_ok').click();
  await expect(form.locator('#data_path')).toHaveValue(name);
  await form.locator('#form_ok').click();
}
