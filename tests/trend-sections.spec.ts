import { expect, test } from './helpers/test';
import {
  chooseTag, ensureProject, ensureVirtualTag, openDeviceTags, openDeviceTree,
  openProject, openTrendConfig, openTrendList, projectName, setTagValue, signIn,
} from './helpers/scada';
import { openMenuEditor } from './helpers/menu';
import { prepareOperatorTrend, removeOperatorTrend } from './helpers/trend';

type Point = { dt: number; v1: number };
type Series = { id: string; title: string; values: Point[] };
type TrendWindow = { os: { trends: { graph: { data: { sections: {
  id: string; title: string; height_relative: number; height: number; trends: Series[];
}[] } } } } };

test('Высота секций и разделение данных на тренде', { tag: ['@trend', '@trn07', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(120_000);
  const name = 'Секции независимых рядов';
  const device = `${name}Device`;
  const tags = ['Level', 'Second', 'Third'];
  const titles = ['Уровень', 'Давление', 'Температура'];
  const sectionNames = ['Процесс', 'Контроль'];
  const sourceIds: string[] = [];
  const seriesIds: string[] = [];
  const sectionIds: string[] = [];
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
    for (const selector of ['#filter_trend', '#form_edit2', '#form_edit_tag', '#form_edit_trend', '#form_edit_section_trend', '#form_edit_main_trend']) {
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
    if (index === 0) {
      await row.locator('td.edit').click();
      await page.locator('#form_edit_tag #period_trend').fill('1000');
      await page.locator('#form_edit_tag #form_ok').click();
    }
  }
  for (const [index, value] of [2, 9, -5].entries()) {
    await setTagValue(page, tags[index], value);
  }

  await test.step('Создать две секции высотой 1:2 и добавить три тега', async () => {
    await openTrendConfig(page, name);
    const sectionForm = page.locator('#form_edit_section_trend');
    const tables = page.locator('#panel_main2 [id^="table_section_id_"]');
    await expect(tables).toHaveCount(1);
    sectionIds.push((await tables.first().getAttribute('id'))!);
    await tables.first().locator('th .btn_add[onclick^="os.trends.section.edit"]').click();
    await sectionForm.locator('#name').fill(sectionNames[0]);
    await sectionForm.locator('#height_section').fill('1');
    await sectionForm.locator('#form_ok').click();
    await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить секцию' }).click();
    await sectionForm.locator('#name').fill(sectionNames[1]);
    await sectionForm.locator('#height_section').fill('2');
    await sectionForm.locator('#form_ok').click();
    await expect(tables).toHaveCount(2);
    sectionIds.push((await tables.filter({ hasText: sectionNames[1] }).getAttribute('id'))!);
    expect(sectionIds[0]).not.toBe(sectionIds[1]);
    const form = page.locator('#form_edit_trend');
    for (const [index, tag] of tags.entries()) {
      const section = page.locator(`[id="${sectionIds[index === 2 ? 1 : 0]}"]`);
      if (index === 0) await section.locator('tr[rec_id] td.edit').click();
      else await section.locator('th .btn_add[onclick*="os.trends.edit"]').click();
      expect(await chooseTag(page, form.locator('.select_tag_tree'), device, tag)).toBe(sourceIds[index]);
      await form.locator('#title').fill(titles[index]);
      await form.locator('#form_ok').click();
      const row = section.locator('tr[rec_id]').filter({ hasText: `${device}//${tag}` });
      await expect(row).toHaveCount(1);
      seriesIds.push((await row.getAttribute('rec_id'))!);
    }
    expect(new Set(seriesIds).size).toBe(3);
  });

  const readConfig = async () => {
    await openTrendConfig(page, name);
    await expect(page.locator('#panel_main2 [id^="table_section_id_"]')).toHaveCount(2);
    for (const [index, id] of sectionIds.entries()) {
      const section = page.locator(`[id="${id}"]`);
      await expect(section).toContainText(sectionNames[index]);
      await expect(section.locator('tr[rec_id]')).toHaveCount(index === 0 ? 2 : 1);
      await section.locator('th .btn_add[onclick^="os.trends.section.edit"]').click();
      await expect(page.locator('#form_edit_section_trend #name')).toHaveValue(sectionNames[index]);
      await expect(page.locator('#form_edit_section_trend #height_section')).toHaveValue(String(index + 1));
      await page.locator('#form_edit_section_trend #form_cancel').click();
    }
    for (const [index, id] of seriesIds.entries()) {
      const row = page.locator(`[id="${sectionIds[index === 2 ? 1 : 0]}"] tr[rec_id="${id}"]`);
      await expect(row).toContainText(titles[index]);
      await row.locator('td.edit').click();
      await expect(page.locator('#form_edit_trend #title')).toHaveValue(titles[index]);
      await expect(page.locator('#form_edit_trend #select_tag_tree_value')).toHaveValue(`${device}//${tags[index]}`);
      await page.locator('#form_edit_trend #form_cancel').click();
    }
  };
  const runtime = () => page.evaluate(() => (window as unknown as TrendWindow).os.trends.graph.data.sections.map(section => section.trends.map(series => ({ id: series.id, title: series.title, values: series.values }))));
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
    expect(query.data.map((s: { id: string; ns: number; nt: number }) => ({ id: s.id, ns: s.ns, nt: s.nt }))).toEqual([
      { id: seriesIds[0], ns: 0, nt: 0 }, { id: seriesIds[1], ns: 0, nt: 1 }, { id: seriesIds[2], ns: 1, nt: 0 },
    ]);
    const data: { ns: number; nt: number; values: Point[] }[] = await response.json();
    expect(data).toHaveLength(3);
    for (const buffer of data) {
      const index = buffer.ns === 1 ? 2 : buffer.nt;
      expect(buffer.ns).toBe(index === 2 ? 1 : 0);
      expect(buffer.nt).toBe(index === 2 ? 0 : index);
      await expect.poll(async () => (await runtime())[buffer.ns]?.[buffer.nt]).toMatchObject({ id: seriesIds[index], title: titles[index], values: expect.arrayContaining(buffer.values) });
    }
    await expect(page.locator('#filter_trend')).toBeHidden();
    const saved = await runtime();
    expect(saved.map(section => section.map(series => series.id))).toEqual([[seriesIds[0], seriesIds[1]], [seriesIds[2]]]);
    const sections = await page.evaluate(() => (window as unknown as TrendWindow).os.trends.graph.data.sections.map(s => ({ id: s.id, title: s.title, ratio: s.height_relative, height: s.height })));
    expect(sections.map(s => ({ id: s.id, title: s.title, ratio: s.ratio }))).toEqual(sectionIds.map((id, i) => ({ id: id.replace('table_section_id_', ''), title: sectionNames[i], ratio: i + 1 })));
    expect(sections[1].height).toBeCloseTo(2 * sections[0].height, 5);
    const bounds = [];
    for (const [index, section] of sections.entries()) {
      const canvas = page.locator(`#section_${index}`);
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      if (!box) throw new Error(`Не видна секция ${sectionNames[index]}`);
      expect(Math.abs(box.height - section.height)).toBeLessThan(1);
      bounds.push(box);
    }
    expect(Math.abs(bounds[1].height - 2 * bounds[0].height)).toBeLessThanOrEqual(2);
    expect(bounds[1].y).toBeGreaterThanOrEqual(bounds[0].y + bounds[0].height);
    expect(bounds[1].x).toBe(bounds[0].x);
    expect(bounds[1].width).toBe(bounds[0].width);
    await expect(page.locator('#vis_legend .info_trend')).toHaveCount(3);
    for (const [index, id] of seriesIds.entries()) {
      const ns = index === 2 ? 1 : 0;
      const nt = index === 2 ? 0 : index;
      const legend = page.locator('#vis_legend .info_trend').filter({ has: page.locator(`#cb_${ns}_${nt}`) });
      await expect(legend.locator('.title_it')).toHaveText(titles[index]);
      await expect(legend.locator(`[id="value_${id}"]`)).toHaveCount(1);
    }
    return saved.flat();
  };
  await test.step('Проверить высоту секций, подписи и теги после открытия', readConfig);
  const initial = [2, 9, -5];
  let original: Point[] = [];
  await test.step('Проверить высоту и расположение графиков в секциях', async () => {
    // shortcut: 15 с — бюджет появления точек на стенде, не документированный SLA архива.
    await expect.poll(async () => {
      const saved = await readDisplay();
      const found = saved.map((series, i) => series.values.find(p => p.v1 === initial[i]));
      if (found.every(Boolean)) original = found as Point[];
      return found.every(Boolean);
    }, { timeout: 15_000, intervals: [500, 1000] }).toBe(true);
  });
  await test.step('Изменить один тег: остальные графики не изменились', async () => {
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    for (const [index, id] of sourceIds.entries()) await expect(page.locator(`#table_option tr[rec_id="${id}"] td[id^="v"]`)).toHaveText(String(initial[index]));
    await setTagValue(page, tags[0], 7);
    const expected = [7, 9, -5];
    let latest: Series[] = [];
    await expect.poll(async () => {
      latest = await readDisplay();
      return latest.every((series, i) => series.values.some(p => p.dt > original[i].dt && p.v1 === expected[i]));
    }, { timeout: 15_000, intervals: [500, 1000] }).toBe(true);
    for (const [index, series] of latest.entries()) {
      expect(series.values).toContainEqual(original[index]);
      if (index > 0) expect(series.values.filter(p => p.dt >= original[index].dt).every(p => p.v1 === expected[index])).toBe(true);
    }
    const updated = latest[0].values.find(p => p.dt > original[0].dt && p.v1 === 7)!;
    await readConfig();
    const reopened = await readDisplay();
    expect(reopened[0].values).toContainEqual(updated);
    for (const [index, series] of reopened.entries()) expect(series.values).toContainEqual(original[index]);
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    for (const [index, id] of sourceIds.entries()) await expect(page.locator(`#table_option tr[rec_id="${id}"] td[id^="v"]`)).toHaveText(String(expected[index]));
  });
});
