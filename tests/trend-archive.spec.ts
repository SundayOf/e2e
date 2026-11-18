import { expect, test } from './helpers/test';
import {
  ensureProject, ensureVirtualTag, openDeviceTags, openDeviceTree, openProject,
  openTrendConfig, openTrendList, projectName, setTagValue, signIn,
} from './helpers/scada';
import { openMenuEditor } from './helpers/menu';
import { prepareOperatorTrend, removeOperatorTrend } from './helpers/trend';

type Point = { dt: number; v1: number };
type Archive = {
  main_trend_id: string;
  start_dt: number;
  end_dt: number;
  sections: { trends: { id: string; type_value: number; values: Point[] }[] }[];
};

test('Запись значений в архив и просмотр на тренде', { tag: ['@trend', '@trn05', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(120_000);
  const name = 'Архив трёх значений';
  const device = `${name}Device`;
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
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
  await openTrendList(page);
  const trendId = await page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name, exact: true }) }).getAttribute('rec_id');
  expect(trendId).toBeTruthy();
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
  const control = await ensureVirtualTag(page, { id: 3, name: 'Контроль', type: 'Float' });
  const controlId = await control.getAttribute('rec_id');
  expect(controlId).toBeTruthy();
  await expect(control.locator('td[id^="v"]')).toHaveText('0');
  await setTagValue(page, 'Контроль', 9);

  const setPeriod = async (period: number) => {
    await source.locator('td.edit').click();
    const form = page.locator('#form_edit_tag');
    await form.locator('#period_trend').fill(String(period));
    await form.locator('#form_ok').click();
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(source).toHaveAttribute('rec_id', sourceId!);
    await source.locator('td.edit').click();
    await expect(form.locator('#period_trend')).toHaveValue(String(period));
    await form.locator('#form_cancel').click();
  };
  await setPeriod(1000);
  const readArchive = async () => {
    const loaded = page.waitForResponse(r => new URL(r.url()).pathname === `/get_data_main_trend/${trendId}/` && r.request().method() === 'GET', { timeout: 10_000 });
    await page.locator('#menu_main').getByText(name, { exact: true }).click();
    const response = await loaded;
    expect(response.ok()).toBe(true);
    const data: Archive = await response.json();
    await expect(page.locator('#main_canvas')).toBeVisible();
    await expect(page.locator('#vis_legend .title_it')).toHaveText('Level');
    await expect(page.locator('#play_trend_dt')).toHaveClass(/cplay/);
    expect(data.main_trend_id).toBe(trendId);
    expect(data.sections).toHaveLength(1);
    expect(data.sections[0].trends).toHaveLength(1);
    const saved = data.sections[0].trends[0];
    expect(saved.id).toBe(seriesId);
    expect(saved.type_value).toBe(1);
    expect(Array.isArray(saved.values)).toBe(true);
    await page.locator('#search_trend_dt').click();
    const filter = page.locator('#filter_trend');
    await expect(filter).toBeVisible();
    await expect(filter.locator('#rf_trend0')).toBeChecked();
    await filter.locator('#trend_period').selectOption('300');
    const buffered = page.waitForResponse(r => new URL(r.url()).pathname === '/get_buffer_trend/' && r.request().method() === 'POST', { timeout: 10_000 });
    await filter.locator('.buttons .btn_add').click();
    const buffer = await buffered;
    expect(buffer.ok()).toBe(true);
    // Клиент отправляет JSON с Content-Type формы, поэтому postDataJSON разбирает его неверно.
    const query = JSON.parse(buffer.request().postData()!);
    expect(query.cmd).toBe('get_buffer_trend');
    expect(query.data).toHaveLength(1);
    expect(query.data[0]).toMatchObject({ id: seriesId, ns: 0, nt: 0 });
    const result: { ns: number; nt: number; values: Point[] }[] = await buffer.json();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ns: 0, nt: 0 });
    const points = result[0].values;
    expect(Array.isArray(points)).toBe(true);
    for (const point of points) {
      expect(Number.isFinite(point.dt)).toBe(true);
      expect(Number.isFinite(point.v1)).toBe(true);
    }
    await expect(filter).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
      const runtime = window as unknown as { os: { trends: { graph: { data: Archive } } } };
      const graph = runtime.os.trends.graph.data;
      const series = graph.sections[0]?.trends[0];
      return { trendId: graph.main_trend_id, seriesId: series?.id, points: series?.values };
    })).toMatchObject({ trendId, seriesId, points: expect.arrayContaining(points) });
    const visible = await page.evaluate(() => {
      const runtime = window as unknown as { os: { trends: { graph: { start_dt: number; end_dt: number } } } };
      return { start: runtime.os.trends.graph.start_dt, end: runtime.os.trends.graph.end_dt };
    });
    expect(visible.end - visible.start).toBe(300_000);
    expect(query.data[0].start_dt).toBeLessThanOrEqual(visible.start);
    expect(query.data[0].end_dt).toBeGreaterThanOrEqual(visible.end);
    return { points, ...visible };
  };
  const expected: Point[] = [];
  for (const value of [2, -2.5, 7]) {
    await test.step(`Записать ${value} и найти точку в архиве`, async () => {
      await setTagValue(page, 'Level', value);
      let point: Point | undefined;
      // shortcut: 15 с — бюджет наблюдения стенда, не документированный SLA архива.
      await expect.poll(async () => {
        const archive = await readArchive();
        // У нового тега значения уникальны; берём начало участка, а не обновляемый конец буфера.
        point = archive.points.find(p => p.v1 === value);
        return !!point;
      }, { timeout: 15_000, intervals: [500, 1000] }).toBe(true);
      expect(Number.isFinite(point!.dt)).toBe(true);
      expect(point!.dt).toBeGreaterThan(0);
      if (expected.length) expect(point!.dt).toBeGreaterThan(expected[expected.length - 1].dt);
      expected.push(point!);
      await openDeviceTree(page);
      await openDeviceTags(page, device);
      await expect(source).toHaveAttribute('rec_id', sourceId!);
      await expect(source.locator('td[id^="v"]')).toHaveText(String(value));
      await expect(page.locator(`#table_option tr[rec_id="${controlId}"] td[id^="v"]`)).toHaveText('9');
    });
  }
  await test.step('Остановить запись в архив и открыть тренд заново', async () => {
    await setPeriod(0);
    const { start, end, points } = await readArchive();
    for (const point of expected) {
      expect(points).toContainEqual(point);
      expect(point.dt).toBeGreaterThanOrEqual(start);
      expect(point.dt).toBeLessThanOrEqual(end);
    }
    await openDeviceTree(page);
    const reread = await readArchive();
    for (const point of expected) expect(reread.points).toContainEqual(point);
  });
});
