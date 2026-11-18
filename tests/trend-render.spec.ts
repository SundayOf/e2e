import { expect, test } from './helpers/test';
import {
  ensureProject, ensureVirtualTag, openDeviceTags, openDeviceTree, openProject,
  openTrendList, projectName, setTagValue, signIn,
} from './helpers/scada';
import { openMenuEditor } from './helpers/menu';
import { prepareOperatorTrend, removeOperatorTrend } from './helpers/trend';

type Point = { dt: number; v1: number; c?: string };
type Vertex = { x: number; y: number };
type Draw = { kind: 'stroke' | 'fill'; mode: number; start: number; end: number; style: string; alpha: number; curves: number; path: Vertex[] };
type Label = { text: string; x: number; y: number; start: number; end: number };
type Style = { mode: number; fill: boolean; smooth: number; labels: boolean; title: string };
type Section = { height: number; min_value: number; max_value: number; trends: { id: string; type_graph: number; fill: number; smooth: number; out_value: number; values: Point[] }[] };
type Original = Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'fill' | 'quadraticCurveTo' | 'bezierCurveTo' | 'fillText'>;
type TrendWindow = {
  os: { vars: { keyup: { timer: number | false } }; trends: { graph: { start_dt: number; end_dt: number; width: number; height: number; buffer: { send_query: boolean }; data: { sections: Section[] } } } };
  renderProbe?: { original: Original; calls: Draw[]; labels: Label[] };
};

test('Вид линий, заливка, сглаживание и подписи тренда', { tag: ['@trend', '@trn09', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(120_000);
  const name = 'Вид архивного ряда';
  const device = `${name}Device`;
  const openConfig = async () => {
    await openTrendList(page);
    await expect(page.locator('#filter_name')).toBeVisible();
    // shortcut: список не отменяет отложенный фильтр при уходе; ждать его завершения до исправления SCADA.
    await expect.poll(() => page.evaluate(() => (window as unknown as TrendWindow).os.vars.keyup.timer === false)).toBe(true);
    await expect(page.locator('#div_msg').filter({ hasText: 'Пожалуйста, подождите' })).toBeHidden();
    const row = page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name, exact: true }) });
    await row.locator('td.tag').click();
    await expect(page.locator('#header_main')).toContainText(`Настройка тренда: ${name}`);
  };
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    await page.evaluate(() => {
      const runtime = window as unknown as TrendWindow;
      if (runtime.renderProbe) Object.assign(CanvasRenderingContext2D.prototype, runtime.renderProbe.original);
      delete runtime.renderProbe;
    });
    if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
    if (await page.locator('#color_dialog_lite').isVisible()) await page.locator('#color_dialog_lite input.Cancel').click();
    if (await page.locator('#form_gradient_values').isVisible()) await page.locator('#form_gradient_values #form_cancel').click();
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
    for (const selector of ['#filter_trend', '#form_edit_tag', '#form_edit_trend', '#form_edit_section_trend', '#form_edit_main_trend']) {
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
  await openConfig();
  const series = page.locator('#panel_main2 tr[rec_id]').filter({ hasText: `${device}//Level` });
  const seriesId = await series.getAttribute('rec_id');
  expect(seriesId).toBeTruthy();
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  const source = page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'Level', exact: true }) });
  const sourceId = await source.getAttribute('rec_id');
  expect(sourceId).toBeTruthy();
  const control = await ensureVirtualTag(page, { id: 3, name: 'Контроль', type: 'Float' });
  const controlId = await control.getAttribute('rec_id');
  expect(controlId).toBeTruthy();
  await expect(control.locator('td[id^="v"]')).toHaveText('0');
  await setTagValue(page, 'Контроль', 9);
  await source.locator('td.edit').click();
  await page.locator('#form_edit_tag #period_trend').fill('1000');
  await page.locator('#form_edit_tag #form_ok').click();
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  await expect(source.locator('td[id^="v"]')).toHaveText('0');

  const readDisplay = async () => {
    const opened = page.waitForResponse(r => new URL(r.url()).pathname === `/get_data_main_trend/${trendId}/` && r.request().method() === 'GET', { timeout: 10_000 });
    await page.locator('#menu_main').getByText(name, { exact: true }).click();
    expect((await opened).ok()).toBe(true);
    await expect(page.locator('#main_canvas')).toBeVisible();
    await page.locator('#search_trend_dt').click();
    await page.locator('#filter_trend #trend_period').selectOption('300');
    const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/get_buffer_trend/' && r.request().method() === 'POST', { timeout: 10_000 });
    await page.locator('#filter_trend .buttons .btn_add').click();
    const response = await loaded;
    expect(response.ok()).toBe(true);
    const query = JSON.parse(response.request().postData()!);
    expect(query.data).toHaveLength(1);
    expect(query.data[0]).toMatchObject({ id: seriesId, ns: 0, nt: 0 });
    const buffer: { ns: number; nt: number; values: Point[] }[] = await response.json();
    expect(buffer).toHaveLength(1);
    expect(buffer[0]).toMatchObject({ ns: 0, nt: 0 });
    await expect.poll(() => page.evaluate(() => (window as unknown as TrendWindow).os.trends.graph.data.sections[0].trends[0])).toMatchObject({ id: seriesId, values: expect.arrayContaining(buffer[0].values) });
    await expect.poll(() => page.evaluate(() => (window as unknown as TrendWindow).os.trends.graph.buffer.send_query)).toBe(false);
    await expect(page.locator('#div_msg').filter({ hasText: 'Пожалуйста, подождите' })).toBeHidden();
    return buffer[0].values;
  };
  const points: Point[] = [];
  for (const value of [2, 9, -2.5]) {
    await setTagValue(page, 'Level', value);
    let point: Point | undefined;
    // shortcut: 15 с — бюджет появления архивной точки на стенде, не SLA продукта.
    await expect.poll(async () => {
      point = (await readDisplay()).find(p => p.v1 === value);
      return !!point;
    }, { timeout: 15_000, intervals: [500, 1000] }).toBe(true);
    points.push(point!);
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(source.locator('td[id^="v"]')).toHaveText(String(value));
  }
  await source.locator('td.edit').click();
  await page.locator('#form_edit_tag #period_trend').fill('0');
  await page.locator('#form_edit_tag #form_ok').click();

  const setStyle = async (style: Style) => {
    await openConfig();
    await series.locator('td.edit').click();
    const form = page.locator('#form_edit_trend');
    await expect(form.locator('#select_tag_tree_value')).toHaveValue(`${device}//Level`);
    await expect(form.locator('#type_value')).toHaveValue('1');
    await form.locator('#type_graph').selectOption(String(style.mode));
    for (const [id, checked] of [['fill_trend', style.fill], ['out_value', style.labels]] as const) {
      const input = form.locator(`#${id}`);
      if (await input.isChecked() !== checked) await input.locator('..').locator('span').click();
      await expect(input).toBeChecked({ checked });
    }
    if (style.mode === 1) {
      await expect(form.locator('#smooth')).toBeVisible();
      await form.locator('#smooth').selectOption(String(style.smooth));
    }
    if (style.fill) await form.locator('#fill_opacity').fill('35');
    for (const id of style.mode === 3 ? [] : style.fill ? ['trend_color', 'fill_color'] : ['trend_color']) {
      await form.locator(`#${id}`).click();
      const color = page.locator('#color_dialog_lite');
      await color.locator('.QuickColor[title="#ff0000ff"]').click();
      await color.locator('input.Ok').click();
    }
    if (style.mode === 3) {
      await form.locator('#gradient_values').click();
      const gradient = page.locator('#form_gradient_values');
      await expect(gradient).toBeVisible();
      await gradient.locator('[onclick="os.trends.gradient_values.clear()"]').click();
      await gradient.locator('[onclick="os.trends.gradient_values.add()"]').click();
      const row = gradient.locator('#table_gradient_values tr:has(td input)');
      await expect(row).toHaveCount(1);
      await row.locator('td').nth(0).locator('input').fill('-5');
      await row.locator('td').nth(2).locator('input').fill('15');
      for (const [column, hex, rgb] of [[1, '000000', 'rgb(0, 0, 0)'], [3, '00c800', 'rgb(0, 200, 0)']] as const) {
        await row.locator('td').nth(column).click();
        const color = page.locator('#color_dialog_lite');
        await expect(color.locator('input.Hex')).toBeVisible();
        await color.locator('input.Hex').fill('');
        await color.locator('input.Hex').pressSequentially(hex);
        await expect(color.locator('.Preview .Active')).toHaveCSS('background-color', rgb);
        await color.locator('input.Ok').click();
        await expect(row.locator('td').nth(column)).toHaveCSS('background-color', rgb);
      }
      await gradient.locator('#form_ok').click();
    }
    await form.locator('#form_ok').click();
    await openConfig();
    await expect(series).toHaveAttribute('rec_id', seriesId!);
    await series.locator('td.edit').click();
    await expect(form.locator('#type_graph')).toHaveValue(String(style.mode));
    await expect(form.locator('#fill_trend')).toBeChecked({ checked: style.fill });
    await expect(form.locator('#out_value')).toBeChecked({ checked: style.labels });
    await expect(form.locator('#smooth')).toHaveValue(String(style.smooth));
    if (style.mode !== 3) await expect(form.locator('#trend_color')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
    if (style.fill) {
      await expect(form.locator('#fill_opacity')).toHaveValue('35');
      await expect(form.locator('#fill_color')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
    }
    if (style.mode === 3) {
      await form.locator('#gradient_values').click();
      const gradient = page.locator('#form_gradient_values');
      const row = gradient.locator('#table_gradient_values tr:has(td input)');
      await expect(row).toHaveCount(1);
      await expect(row.locator('td').nth(0).locator('input')).toHaveValue('-5');
      await expect(row.locator('td').nth(2).locator('input')).toHaveValue('15');
      await expect(row.locator('td').nth(1)).toHaveCSS('background-color', 'rgb(0, 0, 0)');
      await expect(row.locator('td').nth(3)).toHaveCSS('background-color', 'rgb(0, 200, 0)');
      await gradient.locator('#form_cancel').click();
    }
    await form.locator('#form_cancel').click();
  };
  await page.evaluate(() => {
    const runtime = window as unknown as TrendWindow;
    const context = CanvasRenderingContext2D.prototype;
    const original = { beginPath: context.beginPath, moveTo: context.moveTo, lineTo: context.lineTo, stroke: context.stroke, fill: context.fill, quadraticCurveTo: context.quadraticCurveTo, bezierCurveTo: context.bezierCurveTo, fillText: context.fillText };
    const paths = new WeakMap<CanvasRenderingContext2D, Vertex[]>();
    const curves = new WeakMap<CanvasRenderingContext2D, number>();
    runtime.renderProbe = { original, calls: [], labels: [] };
    context.beginPath = function () {
      if (this.canvas.id === 'section_0') { paths.set(this, []); curves.set(this, 0); }
      return original.beginPath.call(this);
    };
    context.moveTo = function (x, y) {
      if (this.canvas.id === 'section_0') paths.get(this)?.push({ x, y });
      return original.moveTo.call(this, x, y);
    };
    context.lineTo = function (x, y) {
      if (this.canvas.id === 'section_0') paths.get(this)?.push({ x, y });
      return original.lineTo.call(this, x, y);
    };
    context.quadraticCurveTo = function (...args) {
      if (this.canvas.id === 'section_0') { paths.get(this)?.push({ x: args[2], y: args[3] }); curves.set(this, (curves.get(this) || 0) + 1); }
      return original.quadraticCurveTo.apply(this, args);
    };
    context.bezierCurveTo = function (...args) {
      if (this.canvas.id === 'section_0') { paths.get(this)?.push({ x: args[4], y: args[5] }); curves.set(this, (curves.get(this) || 0) + 1); }
      return original.bezierCurveTo.apply(this, args);
    };
    const record = (ctx: CanvasRenderingContext2D, kind: Draw['kind']) => {
      const probe = runtime.renderProbe!;
      const style = String(kind === 'stroke' ? ctx.strokeStyle : ctx.fillStyle);
      if (ctx.canvas.id === 'section_0' && probe.calls.length < 2000) {
        const g = runtime.os.trends.graph;
        if (!['#ff0000', '#004600', '#008c00', '#001900'].includes(style) && g.data.sections[0].trends[0].type_graph !== 3) return;
        probe.calls.push({ kind, mode: g.data.sections[0].trends[0].type_graph, start: g.start_dt, end: g.end_dt, style, alpha: ctx.globalAlpha, curves: curves.get(ctx) || 0, path: [...(paths.get(ctx) || [])] });
      }
    };
    context.stroke = function (...args: [] | [Path2D]) {
      record(this, 'stroke');
      Reflect.apply(original.stroke, this, args);
    };
    context.fill = function (...args: [CanvasFillRule?] | [Path2D, CanvasFillRule?]) {
      record(this, 'fill');
      Reflect.apply(original.fill, this, args);
    };
    context.fillText = function (...args) {
      const probe = runtime.renderProbe!;
      if (this.canvas.id === 'section_0' && probe.labels.length < 2000) {
        const g = runtime.os.trends.graph;
        probe.labels.push({ text: String(args[0]), x: args[1], y: args[2], start: g.start_dt, end: g.end_dt });
      }
      return original.fillText.apply(this, args);
    };
  });
  const styles: Style[] = [
    { mode: 1, fill: false, smooth: 0, labels: false, title: 'Линия без заливки и подписей' },
    { mode: 2, fill: false, smooth: 0, labels: false, title: 'Гистограмма' },
    { mode: 1, fill: true, smooth: 5, labels: true, title: 'Сглаженная линия с заливкой и подписями' },
    { mode: 1, fill: false, smooth: 0, labels: false, title: 'Возврат обычной линии' },
    { mode: 3, fill: false, smooth: 0, labels: false, title: 'Градиент известных значений' },
    { mode: 1, fill: false, smooth: 0, labels: false, title: 'Возврат линии после градиента' },
  ];
  for (const style of styles) {
    const { mode } = style;
    await test.step(`${style.title}: проверить настройки и график`, async () => {
      await setStyle(style);
      await page.evaluate(() => { const probe = (window as unknown as TrendWindow).renderProbe!; probe.calls = []; probe.labels = []; });
      const saved = await readDisplay();
      for (const point of points) expect(saved).toEqual(expect.arrayContaining([expect.objectContaining(point)]));
      const geometry = await page.evaluate(() => {
        const g = (window as unknown as TrendWindow).os.trends.graph;
        const section = g.data.sections[0];
        const series = section.trends[0];
        return { start: g.start_dt, end: g.end_dt, width: g.width, height: section.height, graphHeight: g.height, min: section.min_value, max: section.max_value, mode: series.type_graph, fill: !!series.fill, smooth: series.smooth, labels: !!series.out_value };
      });
      expect(geometry).toMatchObject({ mode, fill: style.fill, smooth: style.smooth, labels: style.labels });
      expect(geometry.width).toBeGreaterThan(0);
      expect(geometry.height).toBeGreaterThan(0);
      expect(geometry.max).toBeGreaterThan(geometry.min);
      const y = (value: number) => (geometry.max - value) / (geometry.max - geometry.min) * geometry.height;
      const expected = points.map(point => ({ x: (point.dt - geometry.start) / (geometry.end - geometry.start) * geometry.width, y: y(point.v1) }));
      for (const point of expected) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(geometry.width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(geometry.height);
      }
      const near = (a: number, b: number) => Math.abs(a - b) <= 1;
      const calls = () => page.evaluate(({ mode, start, end }) => (window as unknown as TrendWindow).renderProbe!.calls.filter(c => c.mode === mode && c.start === start && c.end === end), { mode, start: geometry.start, end: geometry.end });
      if (mode === 3) {
        // Для диапазона -5..15 и цветов #000000→#00c800 зелёный канал равен (v+5)*10.
        const colors = ['#004600', '#008c00', '#001900'];
        const top = Math.floor(0.1 * geometry.height) + 0.5;
        const bottom = Math.floor(0.9 * geometry.height) + 0.5;
        for (const [i, point] of points.entries()) {
          const colored = saved.find(p => p.dt === point.dt && p.v1 === point.v1);
          expect(colored?.c?.toLowerCase()).toBe(colors[i]);
          const next = saved.find(p => p.dt > point.dt);
          expect(next, 'У архивной точки должен быть следующий момент для цветного интервала').toBeTruthy();
          const right = (next!.dt - geometry.start) / (geometry.end - geometry.start) * geometry.width;
          expect(right).toBeGreaterThan(expected[i].x);
          const corners = [{ x: expected[i].x, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: expected[i].x, y: bottom }];
          await expect.poll(async () => (await calls()).some(draw => draw.kind === 'fill' && draw.style === colors[i] && draw.alpha === 1 && corners.every(corner => draw.path.some(vertex => near(vertex.x, corner.x) && near(vertex.y, corner.y))))).toBe(true);
        }
        return;
      }
      await expect.poll(async () => {
        const drawn = (await calls()).filter(draw => draw.kind === 'stroke');
        if (mode === 1) return drawn.some(draw => (style.smooth ? draw.curves > 0 : draw.curves === 0) && expected.every(point => draw.path.some(vertex => near(vertex.x, point.x) && near(vertex.y, point.y))));
        return expected.every(point => drawn.some(({ path }) => path.length >= 4 && near(path[0].x, point.x) && near(path[0].y, y(0)) && near(path[1].x, point.x) && near(path[1].y, point.y) && path[2].x > point.x && near(path[2].y, point.y) && near(path[3].x, path[2].x) && near(path[3].y, y(0))));
      }, { message: 'Реальный stroke серии должен соответствовать выбранному виду и проекции архивных точек' }).toBe(true);
      if (style.fill) {
        await expect.poll(async () => (await calls()).some(draw => draw.kind === 'fill' && Math.abs(draw.alpha - 0.35) < 0.001 && expected.every(point => draw.path.some(vertex => near(vertex.x, point.x) && near(vertex.y, point.y))) && draw.path.some(vertex => near(vertex.y, geometry.graphHeight + 1)))).toBe(true);
      } else {
        expect((await calls()).filter(draw => draw.kind === 'fill')).toHaveLength(0);
      }
      const labels = () => page.evaluate(({ start, end }) => (window as unknown as TrendWindow).renderProbe!.labels.filter(label => label.start === start && label.end === end), geometry);
      if (style.labels) {
        // Одинаковое значение может иметь несколько архивных отсчётов; подпись проверяем у любого из них.
        const positions = saved.filter(point => points.some(sample => sample.v1 === point.v1)).map(point => ({
          text: String(point.v1), x: (point.dt - geometry.start) / (geometry.end - geometry.start) * geometry.width, y: y(point.v1) - 3,
        }));
        await expect.poll(async () => (await labels()).some(label => positions.some(point => label.text === point.text && near(label.x, point.x) && near(label.y, point.y)))).toBe(true);
      } else {
        expect(await labels()).toHaveLength(0);
      }
    });
  }
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  await expect(source).toHaveAttribute('rec_id', sourceId!);
  await expect(source.locator('td[id^="v"]')).toHaveText('-2.5');
  await expect(page.locator(`#table_option tr[rec_id="${controlId}"] td[id^="v"]`)).toHaveText('9');
});
