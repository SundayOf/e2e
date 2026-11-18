import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import {
  chooseTag, ensureProject, ensureVirtualTag, openDeviceTags, openDeviceTree,
  openProject, openTrendConfig, openTrendList, projectName, setTagValue, signIn,
} from './helpers/scada';
import { openMenuEditor } from './helpers/menu';
import { prepareOperatorTrend, removeOperatorTrend } from './helpers/trend';

type Point = { dt: number; v1: number };
type Graph = { online: { is: boolean }; data: { sections: { trends: { id: string; values: Point[] }[] }[] } };
type TrendWindow = {
  os: { trends: { graph: Graph } };
  onlineProbe?: { graph: Graph; canvas: HTMLElement | null };
};

test('Обновление тренда в режиме онлайн', { tag: ['@trend', '@trn04', '@base'] }, async ({ page, context, onCleanup }) => {
  test.setTimeout(120_000);
  const name = 'Живые данные тренда';
  const device = `${name}Device`;
  const tags = ['Level', 'Control'];
  const titles = ['Уровень', 'Контроль'];
  const sourceIds: string[] = [];
  const seriesIds: string[] = [];
  let operator: Page | undefined;
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    await operator?.close();
    if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
    for (const selector of ['#form_edit2', '#form_edit_tag', '#form_edit_trend', '#form_edit_section_trend', '#form_edit_main_trend']) {
      if (await page.locator(selector).isVisible()) await page.locator(`${selector} .header > .close_form`).click();
    }
    await removeOperatorTrend(page, name);
    await openMenuEditor(page);
    await expect(page.locator('#panel_main2 .devices_tree_title').filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(0);
    await openTrendList(page);
    await expect(page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name, exact: true }) })).toHaveCount(0);
    await openDeviceTree(page);
    await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
  });
  await prepareOperatorTrend(page, name);
  await openTrendList(page);
  const trendId = await page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name, exact: true }) }).getAttribute('rec_id');
  expect(trendId).toBeTruthy();
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  for (const [index, tag] of tags.entries()) {
    const row = await ensureVirtualTag(page, { id: index + 2, name: tag, type: 'Float', trend: 1000 });
    const id = await row.getAttribute('rec_id');
    expect(id).toBeTruthy();
    sourceIds.push(id!);
    await expect(row.locator('td[id^="v"]')).toHaveText('0');
    await row.locator('td.edit').click();
    if (index === 0) {
      await page.locator('#form_edit_tag #period_trend').fill('1000');
      await page.locator('#form_edit_tag #form_ok').click();
      await row.locator('td.edit').click();
    }
    await expect(page.locator('#form_edit_tag #period_trend')).toHaveValue('1000');
    await page.locator('#form_edit_tag #form_cancel').click();
  }
  await setTagValue(page, 'Level', 1);
  await setTagValue(page, 'Control', 9);
  await openTrendConfig(page, name);
  const section = page.locator('#panel_main2 [id^="table_section_id_"]');
  await expect(section).toHaveCount(1);
  const form = page.locator('#form_edit_trend');
  for (const [index, tag] of tags.entries()) {
    if (index === 0) await section.locator('tr[rec_id] td.edit').click();
    else await section.locator('th .btn_add[onclick*="os.trends.edit"]').click();
    expect(await chooseTag(page, form.locator('.select_tag_tree'), device, tag)).toBe(sourceIds[index]);
    await form.locator('#title').fill(titles[index]);
    await form.locator('#form_ok').click();
    const row = section.locator('tr[rec_id]').filter({ hasText: `${device}//${tag}` });
    await expect(row).toHaveCount(1);
    seriesIds.push((await row.getAttribute('rec_id'))!);
  }
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  await expect(page.locator(`#table_option tr[rec_id="${sourceIds[0]}"] td[id^="v"]`)).toHaveText('1');
  await expect(page.locator(`#table_option tr[rec_id="${sourceIds[1]}"] td[id^="v"]`)).toHaveText('9');
  const display = await context.newPage();
  operator = display;
  await display.goto('/');
  // Выбор проекта сам восстанавливает последний тренд; повторный клик создаёт гонку двух открытий.
  const opened = display.waitForResponse(r => new URL(r.url()).pathname === `/get_data_main_trend/${trendId}/` && r.request().method() === 'GET', { timeout: 10_000 });
  await openProject(display, projectName);
  expect((await opened).ok()).toBe(true);
  await expect(display.locator('#main_canvas')).toBeVisible();
  await expect(display.locator('#vis_legend .title_it')).toHaveText(titles);
  const mode = display.locator('#play_trend_dt');
  await expect(mode).toHaveClass(/cplay/);
  await display.locator('#search_trend_dt').click();
  await display.locator('#filter_trend #trend_period').selectOption('300');
  const buffered = display.waitForResponse(r => new URL(r.url()).pathname === '/get_buffer_trend/' && r.request().method() === 'POST', { timeout: 10_000 });
  await display.locator('#filter_trend .buttons .btn_add').click();
  expect((await buffered).ok()).toBe(true);
  const state = () => display.evaluate(() => {
    const g = (window as unknown as TrendWindow).os.trends.graph;
    return { online: g.online.is, series: g.data.sections[0].trends.map(s => ({ id: s.id, values: s.values })) };
  });
  await test.step('Включить онлайн и дождаться данных', async () => {
    await mode.click();
    await expect(mode).not.toHaveClass(/cplay/);
    // shortcut: 15 с — бюджет поступления архивного буфера на стенде, не SLA Online.
    await expect.poll(async () => {
      const current = await state();
      expect(current.online).toBe(true);
      expect(current.series.map(s => s.id)).toEqual(seriesIds);
      return current.series[0].values.some(p => p.v1 === 1) && current.series[1].values.some(p => p.v1 === 9);
    }, { timeout: 15_000 }).toBe(true);
    await expect(display.locator('#vis_legend .title_it')).toHaveText(titles);
  });
  const url = display.url();
  let navigations = 0;
  let reopenings = 0;
  let buffers = 0;
  display.on('framenavigated', frame => { if (frame === display.mainFrame()) navigations++; });
  display.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === `/open_main_trend/${trendId}/` || path === `/get_data_main_trend/${trendId}/`) reopenings++;
    if (path === '/get_buffer_trend/' && request.method() === 'POST') buffers++;
  });
  await display.evaluate(() => {
    const runtime = window as unknown as TrendWindow;
    runtime.onlineProbe = { graph: runtime.os.trends.graph, canvas: document.getElementById('main_canvas') };
  });
  const received: Point[] = [];
  for (const value of [2, -2.5, 0]) {
    await test.step(`Записать ${value} в другой вкладке и проверить новую точку`, async () => {
      const started = await display.evaluate(() => Date.now());
      await setTagValue(page, 'Level', value);
      let point: Point | undefined;
      await expect.poll(async () => {
        const current = await state();
        expect(current.online).toBe(true);
        expect(current.series.map(s => s.id)).toEqual(seriesIds);
        point = current.series[0].values.find(p => p.v1 === value && p.dt >= started);
        return !!point && current.series[1].values.some(p => p.v1 === 9 && p.dt >= started);
      }, { timeout: 15_000 }).toBe(true);
      expect(point!.dt).toBeLessThanOrEqual(await display.evaluate(() => Date.now()));
      if (received.length) expect(point!.dt).toBeGreaterThan(received[received.length - 1].dt);
      received.push(point!);
      const current = await state();
      expect(current.series[1].values.filter(p => p.dt >= started).every(p => p.v1 === 9)).toBe(true);
      await expect(page.locator(`#table_option tr[rec_id="${sourceIds[1]}"] td[id^="v"]`)).toHaveText('9');
      expect(display.url()).toBe(url);
      expect(navigations).toBe(0);
      expect(reopenings).toBe(0);
      expect(await display.evaluate(() => {
        const runtime = window as unknown as TrendWindow;
        return runtime.onlineProbe!.graph === runtime.os.trends.graph && runtime.onlineProbe!.canvas === document.getElementById('main_canvas');
      })).toBe(true);
    });
  }
  expect(buffers).toBeGreaterThan(0);
  await test.step('Остановить онлайн и вернуться к архиву', async () => {
    await mode.click();
    await expect(mode).toHaveClass(/cplay/);
    await expect.poll(async () => (await state()).online).toBe(false);
    await expect(display.locator('#main_canvas')).toBeVisible();
    await expect(display.locator('#vis_legend .title_it')).toHaveText(titles);
  });
});
