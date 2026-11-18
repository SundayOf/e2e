import { expect, type Locator, type Page } from '@playwright/test';

type OwnedItem = { name: string; parent: string; type: 'folder' | 'file' };
const owned = new WeakMap<Page, Map<string, OwnedItem>>();

function siblings(page: Page, parent: string) {
  return page.locator(parent ? `#main #children_${parent}` : '#main')
    .locator(':scope > div[id^="tree_"] > span.devices_tree_title[item_id]');
}

export function fileNode(page: Page, id: string) {
  return page.locator(`#panel_main2 #main span.devices_tree_title[item_id="${id}"]`);
}

export async function selectFile(page: Page, id: string) {
  const selected = page.waitForResponse(r => new URL(r.url()).pathname === `/get_param_item_file/${id}/` && r.ok(), { timeout: 10_000 });
  await fileNode(page, id).click();
  await (await selected).finished();
}

export async function openFileManager(page: Page) {
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_file_tree/' && r.ok(), { timeout: 10_000 });
  await page.locator('#panel_right [title="Файловый менеджер"]').click();
  await (await loaded).finished();
  await expect(page.locator('#header_main > div:first-child')).toHaveText('Файловый менеджер');
  await expect(page.locator('#div_msg')).toHaveCount(0);
}

export async function expandFileFolder(page: Page, id: string) {
  const children = page.locator(`#main #children_${id}`);
  if (!(await children.isVisible())) await page.locator(`#main #tree_${id} > .btn_tree_plus`).click();
  await expect(children).toBeVisible();
}

export async function fileMenu(page: Page, node?: Locator) {
  if (node) {
    await node.click();
    await node.click({ button: 'right' });
  } else {
    await page.locator('#panel_main2 #main').click({ button: 'right', position: { x: 80, y: 80 } });
  }
  const menu = page.locator('#menu_file_manager.show-menu');
  await expect(menu).toBeVisible();
  return menu;
}

export async function createFileItem(page: Page, name: string, type: 'folder' | 'file', parent = '') {
  await openFileManager(page);
  await expect(siblings(page, parent).and(page.getByText(name, { exact: true })), 'Существующий файл или папку не изменяем').toHaveCount(0);
  const initialIds = await page.locator('#main .devices_tree_title[item_id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('item_id')));
  const menu = await fileMenu(page, parent ? fileNode(page, parent) : undefined);
  await menu.locator('#add_file > button').hover();
  const opened = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_file_item//' && r.ok(), { timeout: 10_000 });
  await menu.locator(type === 'folder' ? '#item_folder_add > button' : '#item_file_add > button').click();
  await (await opened).finished();
  const form = page.locator('#form_edit_file_item');
  await expect(form).toBeVisible();
  await form.locator('#name').fill(name);
  await form.locator('#parent_id').selectOption(parent);
  const saved = page.waitForResponse(r => new URL(r.url()).pathname.startsWith('/save_file_item/') && r.ok(), { timeout: 10_000 });
  await form.locator('#form_ok').click();
  const data = await (await saved).json();
  expect(data.error).toBeFalsy();
  const id: string = data.item_id;
  expect(id).toMatch(/^[a-f\d]{32}$/i);
  expect(initialIds).not.toContain(id);
  if (!owned.has(page)) owned.set(page, new Map());
  owned.get(page)!.set(id, { name, parent, type });
  await expect(fileNode(page, id)).toHaveText(name);
  return id;
}

export async function renameFileItem(page: Page, id: string, name: string) {
  const menu = await fileMenu(page, fileNode(page, id));
  const opened = page.waitForResponse(r => new URL(r.url()).pathname === `/edit_file_item/${id}/` && r.ok(), { timeout: 10_000 });
  await menu.locator('#item_file_edit > button').click();
  await (await opened).finished();
  const form = page.locator('#form_edit_file_item');
  await expect(form).toBeVisible();
  const parent = await form.locator('#parent_id').inputValue();
  await expect(siblings(page, parent).and(page.getByText(name, { exact: true }))
    .and(page.locator(`[item_id]:not([item_id="${id}"])`)), 'Занятое имя не используем').toHaveCount(0);
  await form.locator('#name').fill(name);
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/save_file_item/${id}/` && r.ok(), { timeout: 10_000 });
  await form.locator('#form_ok').click();
  expect((await (await saved).json()).error).toBeFalsy();
  const item = owned.get(page)?.get(id);
  if (item) item.name = name;
  await expect(fileNode(page, id)).toHaveText(name);
}

export async function openFileEditor(page: Page, id: string) {
  const menu = await fileMenu(page, fileNode(page, id));
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === `/load_file/${id}/`, { timeout: 10_000 });
  await menu.locator('#item_file_editor > button').click();
  const response = await loaded;
  expect(response.ok()).toBe(true);
  await expect(page.locator('#form_editor_file #editor_file .ace_text-input')).toBeVisible();
  return response.text();
}

export async function saveFileText(page: Page, id: string, text: string) {
  const form = page.locator('#form_editor_file');
  await form.locator('#editor_file .ace_text-input').focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/save_editor_file/${id}/` && r.ok(), { timeout: 10_000 });
  await form.locator('[onclick^="os.files.editor.save"]').click();
  expect((await (await saved).json()).error).toBeFalsy();
  await expect(form).toBeHidden();
}

export async function cleanupFileFolder(page: Page, name: string) {
  const items = owned.get(page);
  const entry = [...(items || [])].find(([, item]) => item.type === 'folder' && !item.parent && item.name === name);
  if (!entry) return;
  const [id] = entry;
  for (const selector of ['#form_editor_file', '#form_edit_file_item']) {
    const form = page.locator(selector);
    if (await form.isVisible()) await form.locator('.header > .close_form').click();
  }
  await openFileManager(page);
  const node = fileNode(page, id);
  if (await node.count()) {
    await expect(node).toHaveText(name);
    const children = await page.locator(`#main #children_${id} .devices_tree_title[item_id]`).evaluateAll(nodes => nodes.map(node => node.getAttribute('item_id')!));
    expect(children.filter(child => !items!.has(child)), 'Чужие файлы внутри папки не удаляем каскадом').toEqual([]);
    const menu = await fileMenu(page, node);
    await menu.locator('#item_file_delete > button').click();
    const confirm = page.locator('#my_confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Удалить выделенные файлы/папки?');
    await confirm.locator('#btn_ok_confirm').click();
    await expect(node).toHaveCount(0);
    for (const child of children) items!.delete(child);
  }
  await openFileManager(page);
  await expect(node).toHaveCount(0);
  items!.delete(id);
}
