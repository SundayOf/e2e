import { expect, test } from './helpers/test';
import {
  ensureProject, ensureVirtualTag, openDeviceTags, openDeviceTree, openProject,
  openTrendList, projectName, setTagValue, signInAsTest,
} from './helpers/scada';
import { openMenuEditor } from './helpers/menu';
import { prepareOperatorTrend, removeOperatorTrend } from './helpers/trend';

type Mark = { dt: number; title: string };
type Event = Mark & { type_id: number };
type Point = { dt: number; v1: number };
type Series = { id: string; values: Point[]; marks: Mark[]; events: Event[] };
type TrendWindow = { os: { trends: { graph: { select_dt: number; start_dt: number; end_dt: number; data: { is_marks: number; is_events: number; sections: { trends: Series[] }[] } } } } };

test('Добавление и удаление метки на тренде', { tag: ['@trend', '@trn10', '@base'] }, async ({ page, onCleanup }, info) => {
  test.setTimeout(120_000);
  const name = 'Метки и события тренда';
  const device = `${name}Device`;
  const title = 'Проверка времени метки';
  let markId = '';
  await signInAsTest(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  const eventsSelected = await page.locator('#check_events').isChecked();
  const removeMark = async () => {
    await page.locator('#goto_mark_dt').click();
    const list = page.locator('#form_list_marks_tag');
    await expect(list).toBeVisible();
    const row = list.locator(`#table_marks tr[rec_id="${markId}"]`);
    await expect(row).toHaveCount(1);
    await row.locator('td.delete').click();
    await expect(page.locator('#my_confirm')).toBeVisible();
    await expect(page.locator('#my_confirm')).toContainText('Удалить метку(и)?');
    await page.locator('#btn_ok_confirm').click();
    await expect(row).toHaveCount(0);
    await list.locator('.header > .close_form').click();
    await page.locator('#goto_mark_dt').click();
    await expect(row).toHaveCount(0);
    await list.locator('.header > .close_form').click();
    markId = '';
  };
  onCleanup(async () => {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('Метка перед очисткой.png'), timeout: 3000 }).catch(() => {});
    if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
    if (await page.locator('#my_confirm').isVisible()) await page.locator('#btn_cancel_confirm').click();
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
    for (const selector of ['#form_edit_mark_tag', '#form_list_marks_tag', '#filter_trend', '#form_edit_tag']) {
      if (await page.locator(selector).isVisible()) await page.locator(`${selector} .header > .close_form`).click();
    }
    if (markId) {
      await page.locator('#menu_main').getByText(name, { exact: true }).click();
      await expect(page.locator('#goto_mark_dt')).toBeVisible();
      await removeMark();
    }
    const original = eventsSelected ? 'check_events' : 'check_alarms';
    if (!await page.locator(`#${original}`).isChecked()) await page.locator(`#select_alarms_events label[for="${original}"]`).first().click();
    await expect(page.locator(`#${original}`)).toBeChecked();
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
  const source = page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'Level', exact: true }) });
  const sourceId = await source.getAttribute('rec_id');
  expect(sourceId).toBeTruthy();
  const control = await ensureVirtualTag(page, { id: 3, name: 'Контроль', type: 'Float' });
  const controlId = await control.getAttribute('rec_id');
  expect(controlId).toBeTruthy();
  await expect(control.locator('td[id^="v"]')).toHaveText('0');
  await expect(source.locator('td[id^="v"]')).toHaveText('0');
  await setTagValue(page, 'Контроль', 9);
  await source.locator('td.edit').click();
  const form = page.locator('#form_edit_tag');
  await form.locator('#period_trend').fill('1000');
  await expect(form.locator('#edit_to_event')).not.toBeChecked();
  await form.locator('#edit_to_event').locator('..').locator('span').click();
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/save_tag/${sourceId}/` && r.request().method() === 'POST');
  await form.locator('#form_ok').click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect((await response.json()).error).toBeFalsy();
  await response.finished();
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  await source.locator('td.edit').click();
  await expect(form.locator('#edit_to_event')).toBeChecked();
  await expect(form.locator('#period_trend')).toHaveValue('1000');
  await form.locator('#form_cancel').click();
  await expect(source.locator('td[id^="v"]')).toHaveText('0');
  if (!eventsSelected) await page.locator('#select_alarms_events label[for="check_events"]').first().click();
  await expect(page.locator('#content-events')).toBeVisible();
  let writes = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `/set_value_tag/${sourceId}/`) writes++;
  });
  await setTagValue(page, 'Level', 2);
  expect(writes).toBe(1);
  const logged = page.locator(`#table_events tr[tag_id="${sourceId}"][event_id]`).filter({ has: page.getByRole('cell', { name: 'Изменение тега. 0 → 2', exact: true }) });
  await expect(logged).toHaveCount(1);
  const eventId = await logged.getAttribute('event_id');
  expect(eventId).toBeTruthy();
  const runtime = () => page.evaluate(() => (window as unknown as TrendWindow).os.trends.graph.data.sections[0].trends[0]);
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
    const data: { ns: number; nt: number; values: Point[]; marks: Mark[]; events: Event[] }[] = await response.json();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ ns: 0, nt: 0 });
    await expect.poll(runtime).toMatchObject({ id: query.data[0].id, values: expect.arrayContaining(data[0].values), marks: data[0].marks, events: data[0].events });
    return data[0];
  };
  let point: Point | undefined;
  let event: Event | undefined;
  await test.step('Найти измерение и событие на тренде', async () => {
    // shortcut: 15 с — бюджет наблюдения архива на стенде, не SLA.
    await expect.poll(async () => {
      const data = await readDisplay();
      point = data.values.find(p => p.v1 === 2);
      event = data.events.find(e => e.type_id === 5 && e.title === 'Изменение тега. 0 > 2');
      return !!point && !!event;
    }, { timeout: 15_000, intervals: [500, 1000] }).toBe(true);
  });
  let mark: Mark;
  let markDate = '';
  await test.step('Добавить метку и проверить неизменность измерения', async () => {
    const before = await page.evaluate(() => {
      const g = (window as unknown as TrendWindow).os.trends.graph;
      return { start: g.start_dt, end: g.end_dt };
    });
    await page.locator('#section_0').click({ button: 'right' });
    const context = page.locator('#menu_nav_trend.show-menu');
    await expect(context).toBeVisible();
    const selected = await page.evaluate(() => (window as unknown as TrendWindow).os.trends.graph.select_dt);
    expect(selected).toBeGreaterThanOrEqual(before.start);
    expect(selected).toBeLessThanOrEqual(before.end);
    await context.locator(':scope > li.submenu > button').filter({ hasText: 'Метки' }).hover();
    await context.locator('button[onclick="os.tags.marks.add()"]').click();
    const editor = page.locator('#form_edit_mark_tag');
    await expect(editor).toBeVisible();
    await editor.locator('#title').fill(title);
    await editor.locator('#mark_tag_id').selectOption(sourceId!);
    const date = await editor.locator('#mark_dt').inputValue();
    markDate = date;
    expect(date).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/);
    const stamp = await page.evaluate(text => {
      const [day, month, year, hour, minute, second] = text.split(/[. :]/).map(Number);
      return new Date(year, month - 1, day, hour, minute, second).getTime();
    }, date);
    expect(Math.abs(stamp - selected)).toBeLessThan(1000);
    mark = { dt: stamp, title };
    const saved = page.waitForResponse(r => new URL(r.url()).pathname.startsWith('/save_mark_tag/') && r.request().method() === 'POST', { timeout: 10_000 });
    await editor.locator('#form_ok').click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    const result = await response.json();
    expect(result.mark_id).toBeTruthy();
    markId = result.mark_id;
    const body = JSON.parse(response.request().postData()!);
    expect(body).toMatchObject({ title, tag_id: sourceId, dt: date });
    expect(writes).toBe(1);
  });
  await test.step('Открыть метку и событие заново', async () => {
    const data = await readDisplay();
    const saved = data.marks.filter(item => item.title === mark.title);
    expect(saved).toHaveLength(1);
    // Сервер отдавал timestamp на 1 мс раньше; точную отображаемую дату проверяем в списке.
    expect(Math.abs(saved[0].dt - mark.dt)).toBeLessThanOrEqual(1);
    mark = saved[0];
    expect(data.events).toContainEqual(event);
    expect(data.values).toContainEqual(point);
    const visible = await page.evaluate(() => {
      const g = (window as unknown as TrendWindow).os.trends.graph;
      return { start: g.start_dt, end: g.end_dt };
    });
    for (const dt of [mark.dt, event!.dt]) {
      expect(dt).toBeGreaterThanOrEqual(visible.start);
      expect(dt).toBeLessThanOrEqual(visible.end);
    }
    await expect(page.locator('#btn_vis_marks')).toHaveClass(/vis_marks1/);
    await expect(page.locator('#btn_vis_events')).toHaveClass(/vis_events1/);
    await page.locator('#goto_mark_dt').click();
    const list = page.locator('#form_list_marks_tag');
    const row = list.locator(`#table_marks tr[rec_id="${markId}"]`);
    await expect(row).toHaveAttribute('dt', String(mark.dt));
    await expect(row).toContainText(title);
    await expect(row).toContainText(markDate);
    await list.locator('.header > .close_form').click();
  });
  await test.step('Удалить метку: измерение и событие остаются', async () => {
    await removeMark();
    const data = await readDisplay();
    expect(data.marks).not.toContainEqual(mark);
    expect(data.events).toContainEqual(event);
    expect(data.values).toContainEqual(point);
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(source.locator('td[id^="v"]')).toHaveText('2');
    await expect(page.locator(`#table_option tr[rec_id="${controlId}"] td[id^="v"]`)).toHaveText('9');
    expect(writes).toBe(1);
  });
});
