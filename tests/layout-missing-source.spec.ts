import { rememberCreated } from './helpers/owned';
import { expect, test } from './helpers/test';
import { ensureProject, openProject, projectName, signIn } from './helpers/scada';
import { openMnemonicEditor, saveMnemonicEditor } from './helpers/mnemonic';
import { addLinkerObject, deleteViewRow, openViewList, viewRow } from './helpers/view';

test.use({ actionTimeout: 10_000 });

test('Компоновщик после удаления исходной схемы', { tag: ['@layout', '@lay07', '@base'] }, async ({ page, context, onCleanup }, testInfo) => {
  test.setTimeout(60_000);
  const removed = { name: 'Обзор резервуара', caption: 'Схема резервуара', id: '', textId: '' };
  const remaining = { name: 'Состояние насоса', caption: 'Насос готов', id: '', textId: '' };
  const panel = { name: 'Панель резервуара', id: '' };
  const knownIds = new Set<string>();
  const claimId = (value: unknown) => {
    if (typeof value !== 'string' || !/^[a-f\d]{32}$/i.test(value)) throw new Error('Сервер не вернул ID созданного объекта');
    expect(knownIds.has(value), 'Существующий объект не становится собственным').toBe(false);
    knownIds.add(value);
    return value;
  };
  const openMnemonics = async () => {
    const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_mnemonics/' && r.ok(), { timeout: 10_000 });
    await page.locator('#panel_right [title="Мнемосхемы"]').click();
    await (await loaded).finished();
    await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
  };
  const removeOwn = async (item: { name: string; id: string }, kind: 'mnemonic' | 'linker') => {
    if (!item.id) return;
    const open = () => kind === 'mnemonic' ? openMnemonics() : openViewList(page, 'Компоновщики');
    await open();
    const row = page.locator(`#table_option tr[rec_id="${item.id}"]`);
    if (await row.count()) {
      await expect(row.getByRole('cell', { name: item.name, exact: true })).toBeVisible();
      const [response] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === `/delete_${kind}/` && r.request().method() === 'POST', { timeout: 10_000 }),
        deleteViewRow(page, row, kind === 'mnemonic' ? 'Удалить мнемосхему(ы)?' : 'Удалить компоновщик(и)?'),
      ]);
      expect(response.ok()).toBe(true);
      expect((await response.json()).error).toBeFalsy();
      await response.finished();
    }
    await open();
    await expect(page.locator(`#table_option tr[rec_id="${item.id}"]`)).toHaveCount(0);
    item.id = '';
  };
  const createSource = async (item: typeof removed) => {
    await openMnemonics();
    await expect(viewRow(page, item.name), 'Занятую схему не изменяем').toHaveCount(0);
    await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
    const form = page.locator('#form_edit_mnemonic');
    await expect(form).toBeVisible();
    await form.locator('#name').fill(item.name);
    await form.locator('#type_mnemonic').selectOption({ label: 'Мнемосхема' });
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/save_mnemonic//' && r.request().method() === 'POST', { timeout: 10_000 });
    await form.locator('#form_ok').click();
    const response = await created;
    const result = await response.json();
    item.id = claimId(result.mnemonic_id);
    expect(response.ok()).toBe(true);
    expect(result.error).toBeFalsy();
    rememberCreated(page, item.id);
    await expect(viewRow(page, item.name)).toHaveAttribute('rec_id', item.id);
    const editor = await openMnemonicEditor(page, item.name);
    await editor.locator('[title="Текст"]').click();
    await editor.locator('#canvas').click({ position: { x: 200, y: 120 } });
    const text = editor.locator('#my_svg text');
    await expect(text).toHaveCount(1);
    item.textId = (await text.getAttribute('id'))!;
    expect(item.textId).toBeTruthy();
    await editor.locator('#table_option input[num_elem="14"]').fill(item.caption);
    await editor.locator('#table_option input[num_elem="14"]').press('Tab');
    await editor.locator('#table_option input[num_elem="16"]').fill('28');
    await editor.locator('#table_option input[num_elem="16"]').press('Tab');
    await saveMnemonicEditor(editor);
    await editor.close();
  };
  const openPanel = async () => {
    await openViewList(page, 'Компоновщики');
    await expect(viewRow(page, panel.name)).toHaveAttribute('rec_id', panel.id);
    const opened = page.waitForResponse(r => new URL(r.url()).pathname === `/open_linker/${panel.id}/`, { timeout: 10_000 });
    await viewRow(page, panel.name).locator('td.linker').click();
    expect((await opened).ok()).toBe(true);
    return page.frameLocator('#panel_main2 iframe#main');
  };

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  await openMnemonics();
  const sourceRows = page.locator('#table_option tr[rec_id]');
  for (const item of [removed, remaining]) await expect(viewRow(page, item.name)).toHaveCount(0);
  for (const id of await sourceRows.evaluateAll(rows => rows.map(row => row.getAttribute('rec_id')!))) knownIds.add(id);
  await openViewList(page, 'Компоновщики');
  await expect(viewRow(page, panel.name)).toHaveCount(0);
  for (const id of await page.locator('#table_option tr[rec_id]').evaluateAll(rows => rows.map(row => row.getAttribute('rec_id')!))) knownIds.add(id);
  onCleanup(async () => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const active = context.pages().at(-1) || page;
      await active.screenshot({ path: testInfo.outputPath('Состояние перед очисткой.png'), timeout: 3000 }).catch(() => {});
    }
    for (const ownPage of context.pages()) if (ownPage !== page) await ownPage.close();
    if (await page.locator('#my_confirm').isVisible()) await page.locator('#btn_cancel_confirm').click();
    for (const id of ['form_edit_mnemonic', 'form_edit_linker']) {
      const form = page.locator(`#${id}`);
      if (await form.isVisible()) await form.locator('#form_cancel').click();
    }
    await removeOwn(panel, 'linker');
    await removeOwn(remaining, 'mnemonic');
    await removeOwn(removed, 'mnemonic');
  });

  await test.step('Создать две схемы и компоновщик', async () => {
    for (const item of [removed, remaining]) await createSource(item);
    await openViewList(page, 'Компоновщики');
    await page.locator('#header_main .btn_add[onclick="os.linkers.edit(\'-\')"]').click();
    await page.locator('#form_edit_linker #name').fill(panel.name);
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/save_linker//' && r.request().method() === 'POST', { timeout: 10_000 });
    await page.locator('#form_edit_linker #form_ok').click();
    const response = await created;
    const result = await response.json();
    panel.id = claimId(result.linker_id);
    expect(response.ok()).toBe(true);
    expect(result.error).toBeFalsy();
    rememberCreated(page, panel.id);
    await expect(viewRow(page, panel.name)).toHaveAttribute('rec_id', panel.id);
    const loaded = context.waitForEvent('response', {
      predicate: r => new URL(r.url()).pathname === `/load_linker_html/${panel.id}/` && r.ok(),
      timeout: 10_000,
    });
    const popup = page.waitForEvent('popup');
    await viewRow(page, panel.name).locator('td.mnemonic_editor').click();
    const editor = await popup;
    await expect(editor.locator('.ace_editor')).toBeVisible();
    await (await loaded).finished();
    for (const item of [removed, remaining]) await addLinkerObject(editor, 'мнемосхему', item.name);
    const sources = await editor.locator('.ace_editor').evaluate(element =>
      (element as HTMLElement & { env: { editor: { getValue(): string } } }).env.editor.getValue());
    for (const item of [removed, remaining]) expect(sources).toContain(`mnemonic-path="${item.name}"`);
    const code = editor.locator('.ace_text-input');
    await code.press('Control+A');
    await editor.keyboard.insertText(`<div class="panel-content" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px">${sources}</div><style>.panel-content>[data_name]{height:360px!important;min-width:0}.panel-content iframe{height:100%!important}</style>`);
    const saved = editor.waitForResponse(r => new URL(r.url()).pathname === `/save_editor_linker/${panel.id}/` && r.request().method() === 'POST', { timeout: 10_000 });
    await editor.locator('#panel_top [title="Сохранить"]').click();
    expect((await saved).ok()).toBe(true);
    const reloaded = editor.waitForResponse(r => new URL(r.url()).pathname === `/load_linker_html/${panel.id}/` && r.ok(), { timeout: 10_000 });
    await editor.reload();
    const stored = await (await reloaded).text();
    for (const item of [removed, remaining]) expect(stored).toContain(`mnemonic-path="${item.name}"`);
    await editor.close();
    const layout = await openPanel();
    for (const item of [removed, remaining]) {
      const text = layout.frameLocator(`[mnemonic-id="${item.id}"] iframe`).locator(`#my_svg text[id="${item.textId}"]`);
      await expect(text).toBeVisible();
      await expect(text).toHaveText(item.caption);
    }
  });

  const deletedId = removed.id;
  await test.step('Удалить исходную схему и обновить оставшуюся', async () => {
    await removeOwn(removed, 'mnemonic');
    await openMnemonics();
    await expect(viewRow(page, remaining.name)).toHaveAttribute('rec_id', remaining.id);
    const editor = await openMnemonicEditor(page, remaining.name);
    await editor.locator('label[for="tree_elements_box_tab"]').click();
    await editor.locator(`#tree_${remaining.textId} span`).click();
    await editor.locator('label[for="element_box_tab"]').click();
    const caption = editor.locator('#table_option input[num_elem="14"]');
    await expect(caption).toHaveValue(remaining.caption);
    await caption.fill('Насос работает');
    await caption.press('Tab');
    await saveMnemonicEditor(editor);
    await editor.reload();
    await expect(editor.locator(`#my_svg text[id="${remaining.textId}"]`)).toHaveText('Насос работает');
    await editor.close();
  });

  await test.step('Проверить ошибку источника и вторую схему', async () => {
    const missing = page.waitForResponse(r => new URL(r.url()).pathname === `/open_linker_mnemonic/${deletedId}/`, { timeout: 10_000 });
    const layout = await openPanel();
    const errorFrame = layout.frameLocator(`[mnemonic-id="${deletedId}"] iframe`);
    await expect(errorFrame.getByText('Что-то пошло не так', { exact: false })).toBeVisible();
    await expect(errorFrame.locator(`#my_svg text[id="${removed.textId}"]`)).toHaveCount(0);
    const control = layout.frameLocator(`[mnemonic-id="${remaining.id}"] iframe`).locator(`#my_svg text[id="${remaining.textId}"]`);
    await expect(control).toBeVisible();
    await expect(control).toHaveText('Насос работает');
    const response = await missing;
    await testInfo.attach('Ответ удалённого источника', {
      body: JSON.stringify({ sourceId: deletedId, status: response.status(), remainingId: remaining.id, layoutId: panel.id }),
      contentType: 'application/json',
    });
    await openMnemonics();
    await expect(page.locator(`#table_option tr[rec_id="${deletedId}"]`)).toHaveCount(0);
    await expect(viewRow(page, remaining.name)).toHaveAttribute('rec_id', remaining.id);
    await openViewList(page, 'Компоновщики');
    await expect(viewRow(page, panel.name)).toHaveAttribute('rec_id', panel.id);
  });
});
