import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from './helpers/test';
import { testIdentity } from './helpers/bootstrap-data';
import { ensureProject, openProject, projectName, signInAsAdmin, signIn, signOut } from './helpers/scada';
import { cleanupFileFolder, createFileItem, expandFileFolder, fileNode, openFileEditor, openFileManager, renameFileItem, saveFileText, selectFile } from './helpers/files';

test.beforeEach(async ({ page, onCleanup }, info) => {
  await (info.tags.includes('@mixed') ? signInAsAdmin : signIn)(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  await openFileManager(page);
  const snapshot = () => page.locator('#main .devices_tree_title[item_id]').evaluateAll(nodes =>
    nodes.map(node => ({ id: node.getAttribute('item_id'), name: node.textContent?.trim() })));
  const initial = await snapshot();
  onCleanup(async () => {
    await openFileManager(page);
    expect(await snapshot(), 'Существующие файлы и папки сохранены').toEqual(expect.arrayContaining(initial));
  });
});

test('Создание и переименование папки и текстового файла', { tag: ['@files', '@fil02', '@fil03', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const original = 'Проверка текста', renamed = 'Сохранённые записи';
  onCleanup(async () => {
    await cleanupFileFolder(page, original);
    await cleanupFileFolder(page, renamed);
  });
  const folder = await createFileItem(page, original, 'folder');
  const nested = await createFileItem(page, 'Журнал смены', 'folder', folder);
  await openFileManager(page);
  await expandFileFolder(page, folder);
  await renameFileItem(page, nested, 'Архив смены');
  const file = await createFileItem(page, 'Журнал.txt', 'file', folder);
  await openFileManager(page);
  await expandFileFolder(page, folder);
  await openFileEditor(page, file);
  await saveFileText(page, file, 'Уровень бака: 12.5\nКлапан закрыт');
  expect(await openFileEditor(page, file)).toBe('Уровень бака: 12.5\nКлапан закрыт');
  await expect(page.locator('#form_editor_file .ace_text-layer')).toContainText('Клапан закрыт');
  await saveFileText(page, file, 'Уровень бака: 25\nКлапан открыт');
  await renameFileItem(page, file, 'Состояние.txt');
  await renameFileItem(page, folder, renamed);
  await openFileManager(page);
  await expect(fileNode(page, folder)).toHaveText(renamed);
  await expandFileFolder(page, folder);
  await expect(fileNode(page, nested)).toHaveText('Архив смены');
  await expect(fileNode(page, file)).toHaveText('Состояние.txt');
  expect(await openFileEditor(page, file)).toBe('Уровень бака: 25\nКлапан открыт');
  await expect(page.locator('#form_editor_file .ace_text-layer')).toContainText('Клапан открыт');
  await page.locator('#form_editor_file .header > .close_form').click();
  await cleanupFileFolder(page, renamed);
  await expect(fileNode(page, file)).toHaveCount(0);
  await expect(fileNode(page, nested)).toHaveCount(0);
});

test('Загрузка и скачивание файла без повреждений', { tag: ['@files', '@fil04', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const name = 'Проверка данных';
  const sample = Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256));
  onCleanup(async () => {
    await cleanupFileFolder(page, name);
  });
  const folder = await createFileItem(page, name, 'folder');
  const file = await createFileItem(page, 'Данные.bin', 'file', folder);
  await openFileManager(page);
  await expandFileFolder(page, folder);
  await fileNode(page, file).click();
  const uploaded = page.waitForResponse(r => new URL(r.url()).pathname === `/download_file_manager/${file}/`, { timeout: 10_000 });
  await page.locator('#input_file_download').setInputFiles({ name: 'Данные.bin', mimeType: 'application/octet-stream', buffer: sample });
  const upload = await uploaded;
  expect(upload.ok()).toBe(true);
  expect((await upload.json()).error).toBeFalsy();
  await openFileManager(page);
  await expandFileFolder(page, folder);
  await selectFile(page, file);
  const downloading = page.waitForEvent('download', { timeout: 10_000 });
  await page.locator('#param_device td.upload').click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.bin$/);
  await test.info().attach('Имя скачанного файла', { body: download.suggestedFilename(), contentType: 'text/plain' });
  const path = await download.path();
  expect(path).toBeTruthy();
  const result = await readFile(path!);
  expect(result.length).toBe(sample.length);
  expect(createHash('sha256').update(result).digest('hex')).toBe(createHash('sha256').update(sample).digest('hex'));
});

test('Запрет чтения, изменения и удаления файла без прав', { tag: ['@files', '@fil09', '@access', '@mixed', '@permissions'] }, async ({ page, onCleanup }) => {
  test.setTimeout(90_000);
  const name = 'Закрытые записи', filename = 'Журнал доступа.txt';
  const original = 'Контрольная запись: доступ ограничен';
  let role: 'admin' | 'operator' | 'none' = 'admin';
  onCleanup(async () => {
    if (role === 'operator') {
      await signOut(page);
      role = 'none';
    }
    if (role === 'none') await signInAsAdmin(page);
    await openProject(page, projectName);
    await cleanupFileFolder(page, name);
  });
  const folder = await createFileItem(page, name, 'folder');
  const file = await createFileItem(page, filename, 'file', folder);
  await openFileManager(page);
  await expandFileFolder(page, folder);
  await openFileEditor(page, file);
  await saveFileText(page, file, original);
  expect(await openFileEditor(page, file)).toBe(original);
  await page.locator('#form_editor_file .header > .close_form').click();
  await selectFile(page, file);
  for (const kind of ['user', 'group'] as const) {
    await page.locator(`#param_device td.${kind}`).click();
    const form = page.locator('#form_edit_file_mode');
    await expect(form).toBeVisible();
    const row = form.locator(`#table_data_on_users tr[id="${await testIdentity(page, kind)}"]`);
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(0)).not.toHaveClass(/\bcheck_sms\b/);
    await expect(row.locator('td').nth(1)).not.toHaveClass(/\bcheck_sms\b/);
    await form.locator('#form_cancel').click();
  }
  const projectId = new URL(page.url()).searchParams.get('project_id');
  expect(projectId).toBeTruthy();
  const ajax = { 'X-Requested-With': 'XMLHttpRequest' };
  const jsonForm = { ...ajax, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
  const editedContent = 'Изменённая запись';
  const write = () => page.request.post(`/save_editor_file/${file}/`, { data: editedContent, headers: ajax });
  const rename = () => page.request.post(`/save_file_item/${file}/?project_id=${projectId}`, {
    data: JSON.stringify({ name: 'Изменённый файл.txt', parent_id: folder, type_id: 1 }), headers: jsonForm,
  });
  const remove = () => page.request.post(`/delete_file_item/?project_id=${projectId}`, {
    data: JSON.stringify({ ids: [file] }), headers: jsonForm,
  });
  await signOut(page);
  role = 'none';
  await signIn(page);
  role = 'operator';
  await openProject(page, projectName);
  const read = await page.request.get(`/load_file/${file}/`, { headers: ajax, maxRedirects: 0 });
  expect(await read.text()).not.toContain(original);
  const deniedDownload = await page.request.get(`/upload_file_manager/${file}/`, { headers: ajax, maxRedirects: 0 });
  expect(await deniedDownload.text()).not.toContain(original);
  const saved = await write();
  const renamed = await rename();
  const removed = await remove();
  await test.info().attach('Статусы запросов без ACL', {
    body: JSON.stringify({ read: read.status(), download: deniedDownload.status(), write: saved.status(), rename: renamed.status(), delete: removed.status() }), contentType: 'application/json',
  });
  await signOut(page);
  role = 'none';
  await signInAsAdmin(page);
  role = 'admin';
  await openProject(page, projectName);
  await openFileManager(page);
  await expandFileFolder(page, folder);
  await expect(fileNode(page, file)).toHaveText(filename);
  expect(await openFileEditor(page, file)).toBe(original);
  await page.locator('#form_editor_file .header > .close_form').click();
  const allowedDownload = await page.request.get(`/upload_file_manager/${file}/`, { headers: ajax, maxRedirects: 0 });
  expect(allowedDownload.ok()).toBe(true);
  expect(await allowedDownload.text()).toBe(original);
  expect((await write()).ok()).toBe(true);
  expect(await openFileEditor(page, file)).toBe(editedContent);
  await page.locator('#form_editor_file .header > .close_form').click();
  expect((await rename()).ok()).toBe(true);
  await openFileManager(page);
  await expandFileFolder(page, folder);
  await expect(fileNode(page, file)).toHaveText('Изменённый файл.txt');
  expect((await remove()).ok()).toBe(true);
  await openFileManager(page);
  await expect(fileNode(page, file)).toHaveCount(0);
});
