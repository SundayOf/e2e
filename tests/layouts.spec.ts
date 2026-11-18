import { rememberCreated } from './helpers/owned';
import type { Locator, Page, Request } from '@playwright/test';
import { expect, test } from './helpers/test';
import {
  chooseTag, deleteVirtualDevice, ensureProject, ensureVirtualDevice, ensureVirtualTag,
  openDeviceTags, openDeviceTree, openProject, openTrendConfig, openTrendList,
  projectName, setTagValue, signIn,
} from './helpers/scada';
import { openMnemonicEditor, saveMnemonicEditor } from './helpers/mnemonic';
import { addLinkerObject, deleteViewRow, openViewList, viewRow } from './helpers/view';

type TrendWindow = Window & { os: { trends: { graph: {
  start_dt: number; count_ms_px: number;
  data: { sections: { trends: { id: string; values: { dt: number; v1: number }[] }[] }[] };
} } } };

test.use({ actionTimeout: 10_000 });

test('Изменение состава и размеров компоновщика', { tag: ['@layout', '@lay02', '@lay03', '@lay06', '@base'] }, async ({ page, context, onCleanup }, testInfo) => {
  test.setTimeout(120_000);
  const deviceName = 'Датчик резервуара';
  const tagName = 'Уровень воды';
  const own = {
    mnemonic: { name: 'Состояние резервуара', id: '' },
    replacement: { name: 'Показания насосной', id: '' },
    trend: { name: 'Уровень резервуара', id: '' },
    layout: { name: 'Панель насосной', id: '' },
  };
  const initialIds = new Set<string>();
  const claimId = (value: unknown) => {
    if (typeof value !== 'string' || !/^[a-f\d]{32}$/i.test(value)) throw new Error('Сервер не вернул ID созданного объекта');
    expect(initialIds.has(value), 'Ответ создания не должен указывать на существующий объект').toBe(false);
    initialIds.add(value);
    return value;
  };
  let deviceId = '';
  let tagId = '';
  let seriesId = '';
  let textId = '';
  let replacementTextId = '';
  let editor: Page | undefined;
  let display: Page | undefined;
  const device = page.locator('#panel_main2 #main .devices_tree_title').filter({ hasText: new RegExp(`^${deviceName}$`) });
  const openTree = async () => {
    const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_devices/' && r.ok(), { timeout: 10_000 });
    await openDeviceTree(page);
    await (await loaded).finished();
  };
  const openMnemonics = async () => {
    const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_mnemonics/' && r.ok(), { timeout: 10_000 });
    await page.locator('#panel_right [title="Мнемосхемы"]').click();
    await (await loaded).finished();
    await expect(page.locator('#table_option tr[fn="индикаторы"]')).toBeVisible();
  };
  const openList = async (kind: keyof typeof own) => {
    if (kind === 'mnemonic' || kind === 'replacement') await openMnemonics();
    else if (kind === 'trend') {
      const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_main_trends/' && r.ok(), { timeout: 10_000 });
      await openTrendList(page);
      await (await loaded).finished();
      await expect(page.locator('#header_main > div:first-child')).toContainText('Тренды');
    } else await openViewList(page, 'Компоновщики');
  };
  const removeOwn = async (kind: keyof typeof own) => {
    const item = own[kind];
    if (!item.id) return;
    await openList(kind);
    const row = page.locator(`#table_option tr[rec_id="${item.id}"]`);
    if (await row.count()) {
      await expect(row.getByRole('cell', { name: item.name, exact: true })).toBeVisible();
      const path = { mnemonic: '/delete_mnemonic/', replacement: '/delete_mnemonic/', trend: '/delete_main_trend/', layout: '/delete_linker/' }[kind];
      const question = { mnemonic: 'Удалить мнемосхему(ы)?', replacement: 'Удалить мнемосхему(ы)?', trend: 'Удалить тренд(ы)?', layout: 'Удалить компоновщик(и)?' }[kind];
      const [deleted] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === 'POST', { timeout: 10_000 }),
        deleteViewRow(page, row, question),
      ]);
      expect(deleted.ok()).toBe(true);
      expect((await deleted.json()).error).toBeFalsy();
      await deleted.finished();
    }
    await openList(kind);
    await expect(page.locator(`#table_option tr[rec_id="${item.id}"]`)).toHaveCount(0);
    item.id = '';
  };

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  for (const kind of ['layout', 'mnemonic', 'replacement', 'trend'] as const) {
    await openList(kind);
    for (const id of await page.locator('#table_option tr[rec_id]').evaluateAll(rows => rows.map(row => row.getAttribute('rec_id')!))) initialIds.add(id);
    await expect(viewRow(page, own[kind].name), 'Занятое имя не используем').toHaveCount(0);
  }
  await openTree();
  for (const id of await page.locator('#panel_main2 #main .devices_tree_title[node_id]').evaluateAll(rows => rows.map(row => row.getAttribute('node_id')!))) initialIds.add(id);
  await expect(device, 'Существующее устройство не изменяем').toHaveCount(0);
  onCleanup(async () => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const active = editor && !editor.isClosed() ? editor : display && !display.isClosed() ? display : page;
      await active.screenshot({ path: testInfo.outputPath('Состояние перед очисткой.png'), timeout: 3000 }).catch(() => {});
    }
    await editor?.close();
    await display?.close();
    if (await page.locator('#my_confirm').isVisible()) await page.locator('#btn_cancel_confirm').click();
    for (const id of ['form_edit2', 'form_edit_tag', 'form_edit_device_hub', 'form_edit_linker', 'form_edit_mnemonic', 'form_edit_trend', 'form_edit_section_trend', 'form_edit_main_trend']) {
      const form = page.locator(`#${id}`);
      if (await form.isVisible()) await form.locator('.header > .close_form').click();
    }
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
    for (const kind of ['layout', 'mnemonic', 'replacement', 'trend'] as const) await removeOwn(kind);
    if (deviceId) {
      await openTree();
      if (await device.count()) {
        await expect(device).toHaveAttribute('node_id', deviceId);
        const [deleted] = await Promise.all([
          page.waitForResponse(r => new URL(r.url()).pathname === '/delete_device/' && r.request().method() === 'POST', { timeout: 10_000 }),
          deleteVirtualDevice(page, deviceName),
        ]);
        expect(deleted.ok()).toBe(true);
        expect((await deleted.json()).error).toBeFalsy();
        await deleted.finished();
      }
      await openTree();
      await expect(device).toHaveCount(0);
    }
  });

  await test.step('Создать тег и тренд уровня воды', async () => {
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/save_device//' && r.request().method() === 'POST', { timeout: 10_000 });
    const deviceRow = await ensureVirtualDevice(page, deviceName);
    const response = await created;
    const result = await response.json();
    deviceId = claimId(result.node_id);
    expect(response.ok()).toBe(true);
    expect(result.error).toBeFalsy();
    rememberCreated(page, deviceId);
    await expect(deviceRow).toHaveAttribute('node_id', deviceId);
    await openDeviceTags(page, deviceName);
    const tag = await ensureVirtualTag(page, { id: 2, name: tagName, type: 'Float', trend: 1000 });
    tagId = (await tag.getAttribute('rec_id'))!;
    expect(tagId).toBeTruthy();
    await expect(tag.locator('td[id^="v"]')).toHaveText('0');
    await setTagValue(page, tagName, 2);
    await openList('trend');
    await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
    await page.locator('#form_edit_main_trend #name').fill(own.trend.name);
    const createdTrend = page.waitForResponse(r => new URL(r.url()).pathname === '/save_main_trend//' && r.request().method() === 'POST', { timeout: 10_000 });
    await page.locator('#form_edit_main_trend #form_ok').click();
    const trendResponse = await createdTrend;
    const trendResult = await trendResponse.json();
    own.trend.id = claimId(trendResult.main_trend_id);
    expect(trendResponse.ok()).toBe(true);
    expect(trendResult.error).toBeFalsy();
    rememberCreated(page, own.trend.id);
    await expect(viewRow(page, own.trend.name)).toHaveAttribute('rec_id', own.trend.id);
    await openTrendConfig(page, own.trend.name);
    await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить секцию' }).click();
    await page.locator('#form_edit_section_trend #name').fill('Резервуар');
    await page.locator('#form_edit_section_trend #form_ok').click();
    await page.locator('#panel_main2 [id^="table_section_id_"] th .btn_add[onclick*="os.trends.edit"]').click();
    const form = page.locator('#form_edit_trend');
    expect(await chooseTag(page, form.locator('.select_tag_tree'), deviceName, tagName)).toBe(tagId);
    await form.locator('#title').fill(tagName);
    await form.locator('#form_ok').click();
    seriesId = (await page.locator('#panel_main2 tr[rec_id]').filter({ hasText: `${deviceName}//${tagName}` }).getAttribute('rec_id'))!;
    expect(seriesId).toBeTruthy();
  });

  const createMnemonic = async (item: typeof own.mnemonic, caption: string) => {
    await openMnemonics();
    await expect(viewRow(page, item.name), 'Существующую схему не изменяем').toHaveCount(0);
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
    editor = await openMnemonicEditor(page, item.name);
    const texts = editor.locator('#my_svg text');
    const before = await texts.evaluateAll(nodes => nodes.map(node => node.id));
    await editor.locator('[title="Текст"]').click();
    await editor.locator('#canvas').click({ position: { x: 200, y: 120 } });
    await expect(texts).toHaveCount(before.length + 1);
    const createdTextId = (await texts.evaluateAll(nodes => nodes.map(node => node.id))).find(id => !before.includes(id))!;
    expect(createdTextId).toBeTruthy();
    await editor.locator('#table_option input[num_elem="14"]').fill(caption);
    await editor.locator('#table_option input[num_elem="14"]').press('Tab');
    await editor.locator('#table_option input[num_elem="16"]').fill('28');
    await editor.locator('#table_option input[num_elem="16"]').press('Tab');
    const ruleGroup = await editor.locator(`#my_svg text[id="${createdTextId}"] os_rules`).getAttribute('id');
    expect(ruleGroup).toBeTruthy();
    await editor.locator(`label[for="tree_elements_box_tab"]`).click();
    for (const id of [createdTextId, ruleGroup]) {
      const expand = editor.locator(`#tree_${id} > .btn_tree_plus`);
      if (await expand.isVisible()) await expand.click();
    }
    await editor.locator(`#children_${ruleGroup} .btn_add[onclick^="os.editor.events.cmd.edit"]`).click();
    const rule = editor.locator('#edit_data_command_form');
    await expect(rule).toBeVisible();
    expect(await chooseTag(editor, rule.locator('#td_select_tag_tree_value'), deviceName, tagName)).toBe(tagId);
    const template = rule.locator('input[num_elem="48"]');
    await template.locator('../..').locator('td:first-child input[type="checkbox"]').check();
    await template.fill(`${caption}: #`);
    await rule.locator('.buttons #save').click();
    await expect(rule).toBeHidden();
    await saveMnemonicEditor(editor);
    await editor.close();
    editor = undefined;
    return createdTextId;
  };
  const readLayout = (target: Page) => target.locator('.ace_editor').evaluate(element =>
    (element as HTMLElement & { env: { editor: { getValue(): string } } }).env.editor.getValue());
  const saveLayout = async (target: Page, source: string) => {
    await target.locator('.ace_text-input').press('Control+A');
    await target.keyboard.insertText(source);
    const saved = target.waitForResponse(r => new URL(r.url()).pathname === `/save_editor_linker/${own.layout.id}/` && r.request().method() === 'POST', { timeout: 10_000 });
    await target.locator('#panel_top [title="Сохранить"]').click();
    expect((await saved).ok()).toBe(true);
    const reloaded = target.waitForResponse(r => new URL(r.url()).pathname === `/load_linker_html/${own.layout.id}/` && r.ok(), { timeout: 10_000 });
    await target.reload();
    return (await reloaded).text();
  };
  const openLayoutEditor = async () => {
    await openList('layout');
    await expect(viewRow(page, own.layout.name)).toHaveAttribute('rec_id', own.layout.id);
    const popup = page.waitForEvent('popup');
    await viewRow(page, own.layout.name).locator('td.mnemonic_editor').click();
    const target = await popup;
    editor = target;
    await expect(target.locator('.ace_editor')).toBeVisible();
    await expect.poll(() => readLayout(target), { timeout: 10_000 }).toContain('panel-content');
    return target;
  };
  let trendRequests = 0;
  const openPanel = async () => {
    const target = await context.newPage();
    display = target;
    const initialRequests: Request[] = [];
    const captureInitial = (request: Request) => {
      if (/^\/open_linker\//.test(new URL(request.url()).pathname)) initialRequests.push(request);
    };
    target.on('request', captureInitial);
    target.on('request', request => {
      if (new URL(request.url()).pathname === '/get_buffer_trend/') trendRequests++;
    });
    const projectId = new URL(page.url()).searchParams.get('project_id');
    expect(projectId).toMatch(/^[a-f\d]{32}$/i);
    await target.goto(`/?project_id=${projectId}`);
    await expect.poll(() => target.evaluate(() => Boolean((window as unknown as {
      os?: { linkers?: { is_init?: boolean } };
    }).os?.linkers?.is_init)), { timeout: 10_000 }).toBe(true);
    target.off('request', captureInitial);
    await expect(target.locator('#prjName')).toContainText(projectName);
    const restored = initialRequests.find(request => new URL(request.url()).pathname === `/open_linker/${own.layout.id}/`);
    if (restored) {
      // Инициализация иногда восстанавливает панель сама; учитываем фактический запрос, а не номер открытия.
      const response = await restored.response();
      expect(response?.ok()).toBe(true);
      await response!.finished();
    } else {
      for (const request of initialRequests) await (await request.response())?.finished();
      await openViewList(target, 'Компоновщики');
      const opened = target.waitForResponse(r => new URL(r.url()).pathname === `/open_linker/${own.layout.id}/` && r.ok(), { timeout: 10_000 });
      await viewRow(target, own.layout.name).locator('td.linker').click();
      await (await opened).finished();
    }
    return { page: target, layout: target.frameLocator('#panel_main2 iframe#main') };
  };
  // Внутри SVG text также хранится невидимый os_rules с JSON шаблона.
  const readText = (target: Locator) => target.evaluate(element => Array.from(element.childNodes)
    .filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim());

  await test.step('Создать схему с показанием уровня воды', async () => {
    textId = await createMnemonic(own.mnemonic, tagName);
  });

  await test.step('Вставить схему и тренд в компоновщик', async () => {
    await openList('layout');
    await page.locator('#header_main .btn_add[onclick="os.linkers.edit(\'-\')"]').click();
    await page.locator('#form_edit_linker #name').fill(own.layout.name);
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/save_linker//' && r.request().method() === 'POST', { timeout: 10_000 });
    await page.locator('#form_edit_linker #form_ok').click();
    const response = await created;
    const result = await response.json();
    own.layout.id = claimId(result.linker_id);
    expect(response.ok()).toBe(true);
    expect(result.error).toBeFalsy();
    rememberCreated(page, own.layout.id);
    await expect(viewRow(page, own.layout.name)).toHaveAttribute('rec_id', own.layout.id);
    const popup = page.waitForEvent('popup');
    await viewRow(page, own.layout.name).locator('td.mnemonic_editor').click();
    editor = await popup;
    await addLinkerObject(editor, 'мнемосхему', own.mnemonic.name);
    await addLinkerObject(editor, 'тренд', own.trend.name);
    const sources = await readLayout(editor);
    expect(sources).toContain(`mnemonic-path="${own.mnemonic.name}"`);
    expect(sources).toContain(`trend-path="${own.trend.name}"`);
    const stored = await saveLayout(editor, `<div class="panel-content" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px">${sources}</div>
<style>.panel-content>[data_name]{height:360px!important;min-width:0}.panel-content iframe{height:100%!important}</style>`);
    expect(stored).toContain(`mnemonic-path="${own.mnemonic.name}"`);
    expect(stored).toContain(`trend-path="${own.trend.name}"`);
    expect(stored).toContain('grid-template-columns:minmax(0,1fr) minmax(0,1fr)');
    expect(stored).toContain('height:360px!important');
    await editor.close();
    editor = undefined;
  });

  await test.step('Проверить компоновщик на двух размерах окна', async () => {
    const { page: operator, layout } = await openPanel();
    const mnemonic = layout.frameLocator(`[mnemonic-id="${own.mnemonic.id}"] iframe`);
    const trend = layout.frameLocator(`[trend-id="${own.trend.id}"] iframe`);
    const shownLevel = mnemonic.locator(`#my_svg text[id="${textId}"]`);
    const readLevel = () => readText(shownLevel);
    await expect(shownLevel).toBeVisible();
    await expect.poll(readLevel, { timeout: 10_000 }).toBe('Уровень воды: 2');
    await expect(trend.locator('#main_canvas')).toBeVisible();
    await expect(trend.locator('#vis_legend .title_it')).toHaveText(tagName);
    const checkGeometry = async () => {
      await expect.poll(async () => {
        const panelBox = await operator.locator('#panel_main2 iframe#main').boundingBox();
        const schemeBox = await layout.locator(`[mnemonic-id="${own.mnemonic.id}"]`).boundingBox();
        const trendBox = await layout.locator(`[trend-id="${own.trend.id}"]`).boundingBox();
        return !!panelBox && !!schemeBox && !!trendBox && Math.abs(schemeBox.y - trendBox.y) < 2
          && trendBox.x >= schemeBox.x + schemeBox.width && schemeBox.height === 360 && trendBox.height === 360
          && schemeBox.x >= panelBox.x && trendBox.x + trendBox.width <= panelBox.x + panelBox.width + 1
          && schemeBox.y >= panelBox.y && trendBox.y + trendBox.height <= panelBox.y + panelBox.height + 1;
      }).toBe(true);
      await expect(shownLevel).toBeInViewport({ ratio: 0.95 });
      await expect(trend.locator('#section_0')).toBeInViewport({ ratio: 0.95 });
      return (await layout.locator(`[mnemonic-id="${own.mnemonic.id}"]`).boundingBox())!.width;
    };
    const graphMenu = operator.locator('#menu_nav_trend.show-menu');
    const openGraphMenu = async () => {
      await trend.locator('#section_0').click({ button: 'right', position: { x: 50, y: 50 } });
      await expect(graphMenu).toBeVisible();
    };
    await openGraphMenu();
    await graphMenu.locator('button[onclick="os.trends.graph.filter.form()"]:visible').click();
    const filter = operator.locator('#filter_trend:visible');
    await filter.locator('#trend_period').selectOption('300');
    const buffered = operator.waitForResponse(r => new URL(r.url()).pathname === '/get_buffer_trend/' && r.request().method() === 'POST', { timeout: 10_000 });
    await filter.locator('.buttons .btn_add').click();
    expect((await buffered).ok()).toBe(true);
    await expect(trend.locator('#play_trend_dt')).toHaveClass(/cplay/);
    await openGraphMenu();
    await graphMenu.locator('#menu_play_trend_x').click();
    await openTree();
    await openDeviceTags(page, deviceName);
    let previousWidth: number | undefined;
    let previousValue = 2;
    for (const { width, height, value } of [
      { width: 1280, height: 720, value: 7 },
      { width: 1100, height: 800, value: -2.5 },
    ]) {
      await test.step(`${width} × ${height}: управление и данные`, async () => {
        await operator.setViewportSize({ width, height });
        const currentWidth = await checkGeometry();
        if (previousWidth !== undefined) expect(currentWidth).toBeLessThan(previousWidth);
        previousWidth = currentWidth;
        await expect.poll(readLevel, { timeout: 10_000 }).toBe(`Уровень воды: ${previousValue}`);
        await expect(trend.locator('#play_trend_dt')).not.toHaveClass(/cplay/);
        await openGraphMenu();
        await graphMenu.locator('#menu_play_trend_x').click();
        await expect(trend.locator('#play_trend_dt')).toHaveClass(/cplay/);
        await openGraphMenu();
        await graphMenu.locator('#menu_play_trend_x').click();
        await expect(trend.locator('#play_trend_dt')).not.toHaveClass(/cplay/);
        await setTagValue(page, tagName, value);
        await expect.poll(readLevel, { timeout: 10_000 }).toBe(`Уровень воды: ${value}`);
        await expect.poll(() => trend.locator('body').evaluate((body, expected) => {
          const runtime = body.ownerDocument.defaultView as unknown as TrendWindow;
          const graph = runtime.os.trends.graph;
          const series = graph.data.sections[0].trends[0];
          const [start, end] = series.values.slice(-2);
          return series.id === expected.id && start?.v1 === expected.value && end?.v1 === expected.value
            && (end.dt - start.dt) / graph.count_ms_px >= 4;
        }, { value, id: seriesId }), { timeout: 15_000 }).toBe(true);
        const x = await trend.locator('body').evaluate(body => {
          const graph = (body.ownerDocument.defaultView as unknown as TrendWindow).os.trends.graph;
          // Архив сжимает постоянный участок до двух границ; наводим в середину, а не на стык значений.
          const [start, end] = graph.data.sections[0].trends[0].values.slice(-2);
          return ((start.dt + end.dt) / 2 - graph.start_dt) / graph.count_ms_px;
        });
        const canvas = trend.locator('#section_0');
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        await canvas.hover({ position: { x: Math.max(1, Math.min(x, box!.width - 1)), y: 100 }, timeout: 10_000 });
        await expect.poll(async () => (await trend.locator(`#vis_legend [id="value_${seriesId}"]`).textContent())?.replace(/^v:\s*/, '').trim()).toBe(String(value));
        previousValue = value;
      });
    }
    expect(trendRequests).toBeGreaterThan(0);
    await operator.close();
    display = undefined;
  });

  await test.step('Создать вторую схему', async () => {
    replacementTextId = await createMnemonic(own.replacement, 'Уровень насосной');
  });

  await test.step('Заменить схему и сохранить тренд', async () => {
    const target = await openLayoutEditor();
    const source = await readLayout(target);
    const oldPath = `mnemonic-path="${own.mnemonic.name}"`;
    const newPath = `mnemonic-path="${own.replacement.name}"`;
    expect(source.split(oldPath)).toHaveLength(2);
    const stored = await saveLayout(target, source.replace(oldPath, newPath));
    expect(stored).toContain(newPath);
    expect(stored).not.toContain(oldPath);
    expect(stored).toContain(`trend-path="${own.trend.name}"`);
    await target.close();
    editor = undefined;

    const { page: operator, layout } = await openPanel();
    await expect(layout.locator(`[mnemonic-id="${own.mnemonic.id}"]`)).toHaveCount(0);
    await expect(layout.locator(`[mnemonic-id="${own.replacement.id}"]`)).toHaveCount(1);
    const text = layout.frameLocator(`[mnemonic-id="${own.replacement.id}"] iframe`).locator(`#my_svg text[id="${replacementTextId}"]`);
    await expect(text).toBeVisible();
    await expect.poll(() => readText(text), { timeout: 10_000 }).toBe('Уровень насосной: -2.5');
    await expect(layout.frameLocator(`[trend-id="${own.trend.id}"] iframe`).locator('#main_canvas')).toBeVisible();
    await openTree();
    await openDeviceTags(page, deviceName);
    await setTagValue(page, tagName, 9);
    await expect.poll(() => readText(text), { timeout: 10_000 }).toBe('Уровень насосной: 9');
    await operator.close();
    display = undefined;
  });

  await test.step('Убрать тренд и проверить оставшуюся схему', async () => {
    const target = await openLayoutEditor();
    const source = await readLayout(target);
    const changed = await target.evaluate(({ html, name }) => {
      const template = document.createElement('template');
      template.innerHTML = html;
      const trends = Array.from(template.content.querySelectorAll('[trend-path]'))
        .filter(element => element.getAttribute('trend-path') === name);
      if (trends.length !== 1) throw new Error('Ожидался один собственный тренд в разметке');
      trends[0].remove();
      return template.innerHTML;
    }, { html: source, name: own.trend.name });
    const stored = await saveLayout(target, changed);
    expect(stored).not.toContain('trend-path=');
    expect(stored).toContain(`mnemonic-path="${own.replacement.name}"`);
    await target.close();
    editor = undefined;

    const { page: operator, layout } = await openPanel();
    const text = layout.frameLocator(`[mnemonic-id="${own.replacement.id}"] iframe`).locator(`#my_svg text[id="${replacementTextId}"]`);
    await expect(text).toBeVisible();
    await expect.poll(() => readText(text), { timeout: 10_000 }).toBe('Уровень насосной: 9');
    await expect(layout.locator('[trend-id]')).toHaveCount(0);
    expect(operator.frames().some(frame => new URL(frame.url(), 'http://localhost:8080').pathname === `/open_linker_trend/${own.trend.id}/`)).toBe(false);
    trendRequests = 0;
    await openTree();
    await openDeviceTags(page, deviceName);
    await setTagValue(page, tagName, 12);
    await expect.poll(() => readText(text), { timeout: 10_000 }).toBe('Уровень насосной: 12');
    // Окно наблюдения за лишним опросом архива, не SLA и не проверка серверного реестра подписок.
    await operator.waitForTimeout(2000);
    expect(trendRequests).toBe(0);
    for (const kind of ['mnemonic', 'replacement', 'trend'] as const) {
      await openList(kind);
      await expect(viewRow(page, own[kind].name)).toHaveAttribute('rec_id', own[kind].id);
    }
  });
});
