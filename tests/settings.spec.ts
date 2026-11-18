import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { ensureProject, openProject, projectName, signInAsTest, signOut } from './helpers/scada';
import { deleteMnemonic, ensureMnemonic, openMnemonicEditor, saveMnemonicEditor } from './helpers/mnemonic';

test('Загрузка шрифта и применение к тексту схемы', { tag: ['@settings', '@set03', '@set04', '@admin', '@base'] }, async ({ page, onCleanup }, testInfo) => {
  test.setTimeout(90_000);
  const originalName = 'Шрифт операторской панели';
  const editedName = 'Шрифт диспетчерской панели';
  const draftName = 'Черновик шрифта панели';
  const mnemonicName = 'Панель резервуара';
  // shortcut: валидный TTF берётся из Windows стенда; для другого хоста нужен подготовленный шрифт.
  const fixture = await readFile(join(process.env.WINDIR || 'C:/Windows', 'Fonts', 'arialbi.ttf'));
  const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
  const originalHash = digest(fixture);
  const options = page.locator('#form_options');
  const editor = page.locator('#form_edit_options_font');
  const rows = options.locator('#table_options_fonts tr[rec_id]');
  const rowByName = (name: string) => rows.filter({ has: page.getByRole('cell', { name, exact: true }) });
  let fontId = '';
  let downloadUrl = '';
  let created = false;
  let mnemonicCreated = false;
  let mnemonicId = '';
  let mnemonicEditor: Page | undefined;
  const mnemonicRow = () => page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: mnemonicName, exact: true }) });
  const openMnemonics = async () => {
    await expect(page.locator('#prjName')).toContainText(projectName);
    const loaded = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/edit_mnemonics/', { timeout: 10_000 });
    await page.locator('#panel_right [title="Мнемосхемы"]').click({ timeout: 10_000 });
    const response = await loaded;
    expect(response.ok()).toBe(true);
    await response.finished();
    await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
  };
  const removeOwnMnemonic = async () => {
    if (!mnemonicCreated) return;
    await openMnemonics();
    if (await mnemonicRow().count()) {
      if (mnemonicId) await expect(mnemonicRow()).toHaveAttribute('rec_id', mnemonicId);
      await deleteMnemonic(page, mnemonicName);
      await openMnemonics();
    }
    if (mnemonicId) await expect(page.locator(`#table_option tr[rec_id="${mnemonicId}"]`)).toHaveCount(0);
    mnemonicCreated = false;
  };
  const openSettings = async () => {
    if (await options.isVisible()) await options.locator('.header > .close_form').click();
    const loaded = page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/form_options/', { timeout: 10_000 });
    await page.locator('#panel_right [title="Настройки"]').click();
    const response = await loaded;
    expect(response.ok()).toBe(true);
    await response.finished();
    await expect(options).toBeVisible();
    await expect(options.locator('#table_options_fonts')).toBeVisible();
    await expect(page.locator('#div_msg').filter({ hasText: 'Пожалуйста, подождите' })).toBeHidden();
  };
  const removeOwnFont = async () => {
    if (!fontId) return;
    const row = options.locator(`#table_options_fonts tr[rec_id="${fontId}"]`);
    if (!await row.count()) return;
    await expect(row).toHaveCount(1);
    await row.locator('td.delete').click();
    const confirm = page.locator('#my_confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Удалить шрифт(ы)?');
    const deleted = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/delete_options_font/', { timeout: 10_000 });
    await confirm.locator('#btn_ok_confirm').click();
    const response = await deleted;
    expect(response.ok()).toBe(true);
    expect((await response.json()).error).toBeFalsy();
    await expect(row).toHaveCount(0);
  };
  const downloadAndCheck = async (label: string) => {
    const row = options.locator(`#table_options_fonts tr[rec_id="${fontId}"]`);
    const downloaded = page.waitForEvent('download', { timeout: 10_000 });
    await row.locator('td.upload').click();
    const file = await downloaded;
    downloadUrl = file.url();
    expect(await file.failure()).toBeNull();
    const path = testInfo.outputPath(`${label}.ttf`);
    await file.saveAs(path);
    const actual = await readFile(path);
    expect(actual.length).toBe(fixture.length);
    expect(digest(actual)).toBe(originalHash);
  };
  await signInAsTest(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  await openSettings();
  await expect(rowByName(originalName), 'Существующий одноимённый шрифт не удаляем').toHaveCount(0);
  await expect(rowByName(editedName), 'Существующий одноимённый шрифт не удаляем').toHaveCount(0);
  const baseline = await rows.evaluateAll(elements => elements.map(element => element.getAttribute('rec_id')));
  onCleanup(async () => {
    if (!created) return;
    if (mnemonicCreated && testInfo.status !== testInfo.expectedStatus) {
      const target = mnemonicEditor && !mnemonicEditor.isClosed() ? mnemonicEditor : page;
      // Ошибка диагностического снимка не должна блокировать удаление своих объектов.
      await target.screenshot({ path: testInfo.outputPath('Шрифт перед очисткой.png'), timeout: 3000 }).catch(() => {});
    }
    if (mnemonicEditor && !mnemonicEditor.isClosed()) await mnemonicEditor.close();
    if (await page.getByRole('textbox', { name: 'Логин' }).isVisible()) {
      await signInAsTest(page);
      await openProject(page, projectName);
    }
    if (await editor.isVisible()) await editor.locator('#form_cancel').click();
    if (await page.locator('#my_confirm').isVisible()) await page.locator('#btn_cancel_confirm').click();
    if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
    await removeOwnMnemonic();
    await openSettings();
    await removeOwnFont();
    await openSettings();
    if (fontId) await expect(options.locator(`#table_options_fonts tr[rec_id="${fontId}"]`)).toHaveCount(0);
    await expect(rowByName(originalName)).toHaveCount(0);
    await expect(rowByName(editedName)).toHaveCount(0);
    expect(await rows.evaluateAll(elements => elements.map(element => element.getAttribute('rec_id')))).toEqual(expect.arrayContaining(baseline));
    await options.locator('.header > .close_form').click();
  });
  await test.step('Добавить шрифт и загрузить файл', async () => {
    await options.getByText('+Добавить', { exact: true }).click();
    await expect(editor).toBeVisible();
    await editor.locator('#name').fill(originalName);
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/save_options_font//', { timeout: 10_000 });
    await editor.locator('#form_ok').click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    const result = await response.json();
    expect(result.error).toBeFalsy();
    expect(result.font_id).toBeTruthy();
    expect(baseline, 'Существующий шрифт не принимаем за свой').not.toContain(result.font_id);
    fontId = result.font_id;
    created = true;
    await expect(editor).toBeHidden();
    await expect(rowByName(originalName)).toHaveAttribute('rec_id', fontId);
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await rowByName(originalName).locator('td.download').click();
    const uploaded = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/download_options_font/${fontId}/`, { timeout: 10_000 });
    await (await chooser).setFiles({ name: 'Шрифт панели.ttf', mimeType: 'font/ttf', buffer: fixture });
    const uploadResponse = await uploaded;
    expect(uploadResponse.ok()).toBe(true);
    expect((await uploadResponse.json()).error).toBeFalsy();
    await openSettings();
    await expect(rowByName(originalName)).toHaveAttribute('rec_id', fontId);
    await downloadAndCheck('После загрузки');
  });
  await test.step('Отменить переименование шрифта', async () => {
    await rowByName(originalName).locator('td.edit').click();
    await expect(editor.locator('#name')).toHaveValue(originalName);
    await editor.locator('#name').fill(draftName);
    await editor.locator('#form_cancel').click();
    await openSettings();
    await expect(rowByName(originalName)).toHaveAttribute('rec_id', fontId);
    await expect(rowByName(draftName)).toHaveCount(0);
    await downloadAndCheck('После отмены');
  });
  await test.step('Переименовать шрифт и проверить файл после входа', async () => {
    await rowByName(originalName).locator('td.edit').click();
    await editor.locator('#name').fill(editedName);
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/save_options_font/${fontId}/`, { timeout: 10_000 });
    await editor.locator('#form_ok').click();
    expect((await (await saved).json()).error).toBeFalsy();
    await expect(editor).toBeHidden();
    await expect(rowByName(editedName)).toHaveAttribute('rec_id', fontId);
    await options.locator('.header > .close_form').click();
    await signOut(page);
    await signInAsTest(page);
    await openProject(page, projectName);
    await openSettings();
    await expect(rowByName(originalName)).toHaveCount(0);
    await expect(rowByName(editedName)).toHaveAttribute('rec_id', fontId);
    await rowByName(editedName).locator('td.edit').click();
    await expect(editor.locator('#name')).toHaveValue(editedName);
    await editor.locator('#form_cancel').click();
    await downloadAndCheck('После повторного входа');
  });
  await test.step('Применить шрифт к надписи и открыть схему заново', async () => {
    await options.locator('.header > .close_form').click();
    await openMnemonics();
    await expect(mnemonicRow(), 'Существующую одноимённую схему не изменяем').toHaveCount(0);
    mnemonicCreated = true;
    const row = await ensureMnemonic(page, mnemonicName);
    mnemonicId = await row.getAttribute('rec_id') || '';
    expect(mnemonicId).toBeTruthy();
    mnemonicEditor = await openMnemonicEditor(page, mnemonicName);
    const texts = mnemonicEditor.locator('#my_svg text');
    const before = await texts.evaluateAll(nodes => nodes.map(node => node.id));
    await mnemonicEditor.locator('[title="Текст"]').click();
    await mnemonicEditor.locator('#canvas').click({ position: { x: 200, y: 120 } });
    await expect(texts).toHaveCount(before.length + 1);
    const textId = (await texts.evaluateAll(nodes => nodes.map(node => node.id))).find(id => !before.includes(id));
    expect(textId).toBeTruthy();
    const properties = mnemonicEditor.locator('#table_option');
    await properties.locator('input[num_elem="14"]').fill('Уровень воды');
    await properties.locator('input[num_elem="14"]').press('Tab');
    await properties.locator('input[num_elem="16"]').fill('28');
    await properties.locator('input[num_elem="16"]').press('Tab');
    const family = `F${fontId}`;
    const fontSelect = properties.locator('select[num_elem="15"]');
    await expect(fontSelect.locator(`option[value="${family}"]`)).toHaveText(editedName);
    await fontSelect.selectOption(family);
    await expect(mnemonicEditor.locator(`#my_svg text[id="${textId}"]`)).toHaveCSS('font-family', family);
    await saveMnemonicEditor(mnemonicEditor);
    await mnemonicEditor.reload();
    const savedText = mnemonicEditor.locator(`#my_svg text[id="${textId}"]`);
    await expect(savedText).toHaveText('Уровень воды');
    await expect(savedText).toHaveCSS('font-family', family);
    await mnemonicEditor.close();
    mnemonicEditor = undefined;

    await page.reload();
    await openProject(page, projectName);
    await openMnemonics();
    await expect(mnemonicRow()).toHaveAttribute('rec_id', mnemonicId);
    const opened = page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === `/open_mnemonic/${mnemonicId}/`, { timeout: 10_000 });
    await mnemonicRow().locator('td.mnemonic').click();
    expect((await opened).ok()).toBe(true);
    const shownText = page.locator(`#panel_main2 #main svg text[id="${textId}"]`);
    await expect(shownText).toBeVisible();
    await expect(shownText).toHaveText('Уровень воды');
    await expect(shownText).toHaveCSS('font-family', family);
    await expect.poll(() => page.evaluate(expected => Array.from(document.fonts).some(face => face.family === expected && face.status === 'loaded'), family), { timeout: 10_000 }).toBe(true);
    const resource = await page.request.get(`/get_font/${fontId}/`);
    expect(resource.ok()).toBe(true);
    expect(digest(await resource.body())).toBe(originalHash);
    await testInfo.attach('Шрифт в рабочем просмотре', {
      body: JSON.stringify({ fontId, mnemonicId, textId, family, loaded: true, sha256: originalHash }),
      contentType: 'application/json',
    });
    await removeOwnMnemonic();
    await openSettings();
  });
  await test.step('Удалить шрифт и обновить список', async () => {
    expect(downloadUrl).toBeTruthy();
    const beforeDelete = await page.request.get(downloadUrl);
    expect(beforeDelete.ok()).toBe(true);
    expect(digest(await beforeDelete.body()), 'До удаления тот же URL должен возвращать загруженный TTF').toBe(originalHash);
    await removeOwnFont();
    await openSettings();
    await expect(options.locator(`#table_options_fonts tr[rec_id="${fontId}"]`)).toHaveCount(0);
    const response = await page.request.get(downloadUrl);
    const body = await response.body();
    const hash = digest(body);
    await testInfo.attach('Доступ к файлу после удаления', {
      body: JSON.stringify({ status: response.status(), contentType: response.headers()['content-type'], bytes: body.length, sha256: hash, matchesOriginal: hash === originalHash }),
      contentType: 'application/json',
    });
    // Доступность файла проверяем через SCADA; физический каталог сервера тест не читает.
    expect(hash, 'Удалённый шрифт не должен скачиваться по прежней ссылке').not.toBe(originalHash);
    expect(await rows.evaluateAll(elements => elements.map(element => element.getAttribute('rec_id')))).toEqual(expect.arrayContaining(baseline));
  });
});
