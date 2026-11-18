import { expect, test } from './helpers/test';
import {
  ensureProject, openDeviceTags, openDeviceTree, openProject, openTrendConfig,
  openTrendList, projectName, setTagValue, signIn,
} from './helpers/scada';
import { openMenuEditor } from './helpers/menu';
import { prepareOperatorTrend, removeOperatorTrend } from './helpers/trend';

type Point = { dt: number; v1: number };
type Label = { text: string; x: number; y: number; align: string; start: number; end: number };
type TrendWindow = Window & {
  os: { trends: { graph: {
    start_dt: number; end_dt: number; width: number; offset: { left: number };
    data: { sections: { trends: { id: string; values: Point[] }[] }[] };
  } } };
  rangeProbe?: { original: CanvasRenderingContext2D['fillText']; calls: Label[] };
};

test.use({ timezoneId: 'UTC' });

test('Выбор периода и масштаба тренда', { tag: ['@trend', '@trn06', '@f12', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(120_000);
  const name = 'Период и шкала тренда';
  const device = `${name}Device`;
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    await page.evaluate(() => {
      const runtime = window as unknown as TrendWindow;
      if (runtime.rangeProbe) CanvasRenderingContext2D.prototype.fillText = runtime.rangeProbe.original;
      delete runtime.rangeProbe;
    });
    if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
    if (await page.locator('#calendar').isVisible()) await page.locator('#calendar .buttons .btn_cancel').click();
    for (const selector of ['#filter_trend', '#form_edit_tag', '#form_edit_trend', '#form_edit_section_trend', '#form_edit_main_trend', '#form_edit2']) {
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
  await openTrendConfig(page, name);
  const series = page.locator('#panel_main2 tr[rec_id]').filter({ hasText: `${device}//Level` });
  await expect(series).toHaveCount(1);
  const seriesId = await series.getAttribute('rec_id');
  expect(seriesId).toBeTruthy();
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  const source = page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'Level', exact: true }) });
  const sourceId = await source.getAttribute('rec_id');
  expect(sourceId).toBeTruthy();
  await source.locator('td.edit').click();
  await page.locator('#form_edit_tag #period_trend').fill('1000');
  await page.locator('#form_edit_tag #form_ok').click();
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  await expect(source.locator('td[id^="v"]')).toHaveText('0');

  const graph = () => page.evaluate(() => {
    const g = (window as unknown as TrendWindow).os.trends.graph;
    const series = g.data.sections[0]?.trends[0];
    return { start: g.start_dt, end: g.end_dt, left: g.offset.left, width: g.width, seriesId: series?.id, points: series?.values || [] };
  });
  const relativePeriod = async () => {
    await page.locator('#menu_main').getByText(name, { exact: true }).click();
    await expect(page.locator('#main_canvas')).toBeVisible();
    await page.locator('#search_trend_dt').click();
    const filter = page.locator('#filter_trend');
    await expect(filter.locator('#rf_trend0')).toBeChecked();
    await filter.locator('#trend_period').selectOption('300');
    const before = await page.evaluate(() => Date.now());
    const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/get_buffer_trend/' && r.request().method() === 'POST', { timeout: 10_000 });
    await filter.locator('.buttons .btn_add').click();
    const response = await loaded;
    expect(response.ok()).toBe(true);
    const data: { ns: number; nt: number; values: Point[] }[] = await response.json();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ ns: 0, nt: 0 });
    await expect.poll(async () => (await graph()).points).toEqual(expect.arrayContaining(data[0].values));
    await expect(filter).toBeHidden();
    await expect.poll(async () => { const g = await graph(); return g.end - g.start; }).toBe(300_000);
    const g = await graph();
    expect(g.end).toBeGreaterThanOrEqual(before);
    expect(g.end).toBeLessThanOrEqual(await page.evaluate(() => Date.now()));
  };
  const points: Point[] = [];
  for (const value of [2, 9]) {
    await test.step(`Записать ${value} в архив`, async () => {
      await setTagValue(page, 'Level', value);
      let point: Point | undefined;
      // shortcut: 15 с — бюджет фоновой регистрации на стенде, не SLA продукта.
      await expect.poll(async () => {
        await relativePeriod();
        const g = await graph();
        expect(g.seriesId).toBe(seriesId);
        point = g.points.find(p => p.v1 === value);
        return !!point;
      }, { timeout: 15_000, intervals: [500, 1000] }).toBe(true);
      points.push(point!);
      await openDeviceTree(page);
      await openDeviceTags(page, device);
      await expect(source).toHaveAttribute('rec_id', sourceId!);
      await expect(source.locator('td[id^="v"]')).toHaveText(String(value));
    });
  }
  await source.locator('td.edit').click();
  await page.locator('#form_edit_tag #period_trend').fill('0');
  await page.locator('#form_edit_tag #form_ok').click();
  await relativePeriod();

  await page.evaluate(() => {
    const runtime = window as unknown as TrendWindow;
    const original = CanvasRenderingContext2D.prototype.fillText;
    runtime.rangeProbe = { original, calls: [] };
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      const g = runtime.os.trends.graph;
      const probe = runtime.rangeProbe!;
      if (this.canvas.id === 'main_canvas' && probe.calls.length < 1000) {
        probe.calls.push({ text: String(args[0]), x: args[1], y: args[2], align: this.textAlign, start: g.start_dt, end: g.end_dt });
      }
      return original.apply(this, args);
    };
  });

  const checkScale = async (start: number, end: number) => {
    await expect.poll(async () => { const g = await graph(); return { start: g.start, end: g.end }; }).toEqual({ start, end });
    await expect.poll(async () => (await graph()).points).toEqual(expect.arrayContaining(points));
    const g = await graph();
    expect(g.seriesId).toBe(seriesId);
    for (const point of points) {
      expect(point.dt).toBeGreaterThanOrEqual(start);
      expect(point.dt).toBeLessThanOrEqual(end);
    }
    const labels = () => page.evaluate(({ start, end }) => (window as unknown as TrendWindow).rangeProbe!.calls.filter(c => c.start === start && c.end === end), { start, end });
    await expect.poll(async () => (await labels()).filter(c => /^\d{2}:\d{2}$/.test(c.text)).length).toBeGreaterThanOrEqual(3);
    const drawn = await labels();
    const time = drawn.filter(c => /^\d{2}:\d{2}$/.test(c.text));
    for (const tick of time) {
      expect(tick.align).toBe('center');
      expect(tick.x).toBeGreaterThanOrEqual(g.left);
      expect(tick.x).toBeLessThanOrEqual(g.left + g.width);
      const at = start + (tick.x - g.left) / g.width * (end - start);
      const pixel = (end - start) / g.width;
      const candidates = [-pixel, 0, pixel].map(delta => new Date(at + delta).toISOString().slice(11, 16));
      expect(candidates, `Подпись ${tick.text} при X=${tick.x} должна соответствовать времени оси`).toContain(tick.text);
    }
    const numeric = drawn.filter(c => c.align === 'right' && /^-?\d+(\.\d+)?$/.test(c.text) && Math.abs(c.x - (g.left - 6)) < 1);
    const ticks = [...new Map(numeric.map(c => [c.y, c])).values()].sort((a, b) => a.y - b.y);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ticks.length; i++) expect(Number(ticks[i].text)).toBeLessThan(Number(ticks[i - 1].text));
    expect(Number(ticks[0].text)).toBeGreaterThanOrEqual(9);
    expect(Number(ticks[ticks.length - 1].text)).toBeLessThanOrEqual(2);
  };

  const center = Math.floor((points[0].dt + points[1].dt) / 2000) * 1000;
  const start = center - 150_000;
  const end = center + 150_000;
  const fixedPeriod = async () => {
    await page.locator('#search_trend_dt').click();
    for (const [field, stamp] of [['#trend_start_date', start], ['#trend_end_date', end]] as const) {
      const date = new Date(stamp);
      const picker = page.locator(`#filter_trend ${field}`).locator('..');
      const box = await picker.boundingBox();
      if (!box) throw new Error('Не виден выбор даты тренда');
      await picker.click({ position: { x: box.width - 5, y: box.height / 2 } });
      const calendar = page.locator('#calendar');
      await expect(calendar).toBeVisible();
      const year = Number(await calendar.locator('#c_year').inputValue());
      const target = date.getUTCFullYear();
      expect(Math.abs(year - target)).toBeLessThanOrEqual(1);
      if (year !== target) await calendar.locator(`button[onclick="os.calendar.${year < target ? 'next_year' : 'prev_year'}();"]`).click();
      await expect(calendar.locator('#c_year')).toHaveValue(String(target));
      await calendar.locator('#c_month').selectOption(String(date.getUTCMonth()));
      await calendar.locator(`#c_days #d${date.getUTCDate()}`).click();
      await calendar.locator('#c_hour').selectOption(String(date.getUTCHours()));
      await calendar.locator('#c_min').selectOption(String(date.getUTCMinutes()));
      await calendar.locator('#c_sec').selectOption(String(date.getUTCSeconds()));
      await calendar.locator('.buttons .btn_add').click();
      await expect(calendar).toBeHidden();
      const pad = (v: number) => String(v).padStart(2, '0');
      await expect(page.locator(`#filter_trend ${field}`)).toHaveValue(`${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${target} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`);
    }
    await expect(page.locator('#filter_trend #rf_trend1')).toBeChecked();
    await page.locator('#filter_trend .buttons .btn_add').click();
    await expect(page.locator('#filter_trend')).toBeHidden();
  };
  const clearLabels = () => page.evaluate(() => { (window as unknown as TrendWindow).rangeProbe!.calls = []; });
  await test.step('Выбрать период и проверить точки и шкалу времени', async () => {
    await fixedPeriod();
    await checkScale(start, end);
  });
  await test.step('Изменить масштаб и проверить границы времени', async () => {
    for (const [button, duration] of [['#plus_trend_dt', 150_000], ['#minus_trend_dt', 225_000]] as const) {
      await clearLabels();
      const before = await page.evaluate(() => Date.now());
      await page.locator(button).click();
      await expect.poll(async () => { const g = await graph(); return g.end - g.start; }).toBe(duration);
      const g = await graph();
      expect(g.end).toBeGreaterThanOrEqual(before);
      expect(g.end).toBeLessThanOrEqual(await page.evaluate(() => Date.now()));
      await checkScale(g.end - duration, g.end);
    }
  });
  await test.step('Вернуть прежний период и проверить точки', async () => {
    await clearLabels();
    await fixedPeriod();
    await checkScale(start, end);
  });
});
