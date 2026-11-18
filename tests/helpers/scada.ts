import { expect, type Locator, type Page } from '@playwright/test';
import { bootstrapData } from './bootstrap-data';
import { requireOwned, saveOwned } from './owned';

export const projectName = bootstrapData.project;

export async function waitForIdle(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { os: { vars: { keyup: { timer: number | false } } } }).os.vars.keyup.timer === false)).toBe(true);
  await expect(page.locator('#div_msg')).toBeHidden();
}

function deviceTagRow(page: Page, name: string) {
  return page.locator('#table_option tr[rec_id]').filter({
    has: page.locator('td:nth-child(3)').and(page.getByRole('cell', { name, exact: true, includeHidden: true })),
  });
}

function alarmRow(page: Page, name: string) {
  return page.locator('#table_edit_alarms tr[rec_id]').filter({
    has: page.getByRole('cell', { name, exact: true }).or(page.getByRole('cell', { name: `/${name}`, exact: true })),
  });
}

export async function chooseTag(page: Page, picker: Locator, deviceName: string, tag: string) {
  const box = await picker.boundingBox();
  if (!box) throw new Error('Tag picker is not visible');
  await picker.click({ position: { x: box.width - 6, y: box.height / 2 } });
  const tree = page.locator('#form_edit2');
  await expect(tree).toBeVisible();
  const device = tree.locator(`span[name="${deviceName}"]`).locator('..');
  await expect(device).toBeVisible();
  const expand = device.locator(':scope > .btn_tree_plus');
  if (await expand.isVisible()) await expand.click();
  const target = tree.locator(`[tag_name="${deviceName}//${tag}"] span`);
  await expect(target).toHaveCount(1);
  for (const folder of await target.locator('xpath=ancestor::div[@type_tt="sub_tags"]').all()) {
    const expandFolder = folder.locator(':scope > .btn_tree_plus');
    if (await expandFolder.isVisible()) await expandFolder.click();
  }
  await expect(target).toBeVisible();
  const id = await target.locator('..').getAttribute('id');
  if (!id?.startsWith('tree_t_')) throw new Error(`Tag ${tag} has no tree ID`);
  await target.click();
  await tree.locator('#form_ok').click();
  return id.slice('tree_t_'.length);
}

export function testUser() {
  return bootstrapData.login;
}

export async function signIn(page: Page) {
  await signInWithCredentials(page, bootstrapData.login, bootstrapData.password);
}

export async function signInAsTest(page: Page) {
  const { login: user, password } = bootstrapData.admin;
  if (!user || !password) throw new Error('Задайте USER и PASSWORD администратора в .env');
  await signInWithCredentials(page, user, password);
}

async function signInWithCredentials(page: Page, user: string, password: string) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Логин' }).fill(user);
  await page.locator('input[type="password"]').fill(password);
  await page.getByText('Вход', { exact: true }).click();
  await expect(page.locator('#logout')).toBeVisible();
}

export async function signOut(page: Page) {
  await page.locator('#logout').click();
  const confirm = page.locator('#my_confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('Вы действительно хотите выйти?');
  await confirm.locator('#btn_ok_confirm').click();
  await expect(page).toHaveURL(/\/login\/$/);
}

export async function ensureProject(page: Page, name: string) {
  await waitForIdle(page);
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_projects/' && r.request().method() === 'GET');
  await page.locator('[title="Проекты"]').click();
  const response = await loaded;
  expect(response.ok()).toBe(true);
  await response.finished();
  await waitForIdle(page);
  await expect(page.locator('#count_data')).toBeVisible();
  const projects = page.locator('#table_option');
  const project = projects.getByRole('cell', { name, exact: true });
  if (await project.count()) return;

  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
  await page.locator('#form_edit_project #name').fill(name);
  await page.locator('#form_edit_project #form_ok').click();
  await expect(project).toBeVisible();
}

export async function openProject(page: Page, name: string) {
  await waitForIdle(page);
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/select_projects/' && r.request().method() === 'GET');
  await page.locator('[title="Выбор проекта"]').click();
  const response = await loaded;
  expect(response.ok()).toBe(true);
  await response.finished();
  await waitForIdle(page);
  await page.locator('#table_option').getByRole('row', { name, exact: true }).locator('td.upload').first().click();
  await expect(page.locator('#prjName').getByText(name, { exact: true })).toBeVisible();
}

export async function requireGuideLinks(page: Page, ...names: string[]) {
  for (const name of names) {
    await expect(page.locator('#menu_main').getByText(name, { exact: true }),
      `Missing Tank guide link «${name}». Run tests/faststart.spec.ts first.`).toBeVisible();
  }
}

export async function openDeviceTree(page: Page) {
  await waitForIdle(page);
  const loaded = page.waitForResponse(response => response.url().includes('/edit_devices/') && response.ok());
  await page.locator('[title="Дерево проекта"]').click();
  await (await loaded).finished();
  await waitForIdle(page);
  await expect(page.locator('#header_main > div:first-child')).toContainText('Дерево проекта');
}

export async function ensureVirtualDevice(page: Page, name: string) {
  const device = page.locator('.devices_tree_title').and(page.getByText(name, { exact: true }));
  if (!(await device.count())) {
    await page.locator('#panel_main2 #main').click({ button: 'right', position: { x: 100, y: 100 } });
    await page.locator('#menu_devices #add_node > button').hover();
    await page.locator('#item_add_device button').click();
    await page.locator('#form_edit_device_hub #title').click();
    await page.locator('#form_edit_device_hub #title').fill(name);
    await page.locator('#form_edit_device_hub #mode_select_device').selectOption({ label: 'Virtual' });
    const id = await saveOwned(page, '/save_device/', 'node_id', () => page.locator('#form_edit_device_hub #form_ok').click());
    await expect(device).toHaveAttribute('node_id', id);
  } else {
    await requireOwned(page, device, 'node_id');
  }
  await expect(device).toBeVisible();
  return device;
}

export async function deleteVirtualDevice(page: Page, name: string) {
  await openDeviceTree(page);
  const device = page.locator('.devices_tree_title').and(page.getByText(name, { exact: true }));
  await requireOwned(page, device, 'node_id');
  await device.click();
  await device.click({ button: 'right' });
  await page.locator('#item_delete_node_devices > button').click();
  const confirm = page.locator('#confirm_delete_nodes');
  await expect(confirm).toContainText('Устройства (1)');
  await confirm.locator('.buttons .btn_add').click();
  await expect(device).toHaveCount(0);
}

export async function renameVirtualDevice(page: Page, before: string, after: string) {
  await openDeviceTree(page);
  const device = page.locator('.devices_tree_title').and(page.getByText(before, { exact: true }));
  await requireOwned(page, device, 'node_id');
  await device.click();
  await device.click({ button: 'right' });
  await page.locator('#item_edit_node_devices > button').click();
  const form = page.locator('#form_edit_device_hub');
  await expect(form.locator('#title')).toHaveValue(before);
  await expect(form.locator('#mode_select_device')).toHaveValue('1');
  await form.locator('#title').fill(after);
  const saved = page.waitForResponse(r => r.request().method() === 'POST' && /\/save_device[^/]*\//.test(new URL(r.url()).pathname), { timeout: 10_000 });
  await form.locator('#form_ok').click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect((await response.json()).error).toBeFalsy();
  await expect(page.locator('.devices_tree_title').and(page.getByText(after, { exact: true }))).toBeVisible();
  return response.request();
}

export async function deleteVirtualDeviceIfPresent(page: Page, name: string) {
  await openDeviceTree(page);
  const device = page.locator('.devices_tree_title').and(page.getByText(name, { exact: true }));
  if (await device.count()) await deleteVirtualDevice(page, name);
}

export async function openDeviceTags(page: Page, name: string) {
  const device = page.locator('.devices_tree_title').and(page.getByText(name, { exact: true }));
  await device.click();
  await device.click({ button: 'right' });
  await page.locator('#item_tags_node_devices button').click();
  await expect(page.locator('#panel_main2')).toContainText(`Теги для устройства «${name}»`);
}

export async function ensureVirtualTag(page: Page, tag: { id: number; name: string; type: 'Boolean' | 'Float'; trend?: number }) {
  const row = deviceTagRow(page, tag.name);
  if (!(await row.count())) {
    await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
    const form = page.locator('#form_edit_tag');
    await form.locator('#adress').fill(String(tag.id));
    await form.locator('#title').fill(tag.name);
    await form.locator('#type_signal_tag').selectOption({ label: 'Virtual' });
    await form.locator('#format_value').selectOption({ label: tag.type });
    await form.locator('#format_value_out').selectOption({ label: tag.type });
    if (tag.trend) await form.locator('#period_trend').fill(String(tag.trend));
    await form.locator('#default_value').fill('0');
    const id = await saveOwned(page, '/save_tag/', 'tag_id', () => form.locator('#form_ok').click());
    await expect(row).toHaveAttribute('rec_id', id);
  } else {
    await requireOwned(page, row);
  }
  await expect(row).toBeVisible();
  await expect(row.getByRole('cell', { name: tag.name, exact: true })).toBeVisible();
  return row;
}

export async function deleteTag(page: Page, name: string) {
  const row = deviceTagRow(page, name);
  await requireOwned(page, row);
  await row.locator('td.delete').click();
  await expect(page.locator('#my_confirm')).toContainText('Удалить тег(и)?');
  await page.locator('#btn_ok_confirm').click();
  await expect(row).toHaveCount(0);
}

export async function setTagFormula(page: Page, name: string, formula: string) {
  const row = deviceTagRow(page, name);
  await requireOwned(page, row);
  const form = page.locator('#form_edit_tag');
  await row.locator('td.edit').click();
  await expect(form).toBeVisible();
  if (await form.locator('#formula_out').inputValue() !== formula) {
    await form.locator('#formula_out').locator('..').click({ position: { x: 315, y: 11 } });
    const editor = page.locator('#form_edit_formula');
    await expect(editor).toBeVisible();
    if (formula) {
      // shortcut: UI-06 перекрывает центр повторного редактора; убрать позицию после исправления слоёв в SCADA.
      await editor.locator('.CodeMirror').click({ position: { x: 10, y: 10 } });
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(formula);
    } else {
      await editor.locator('.btn.clear').click();
    }
    await editor.locator('#btn_set_formula_tag').click();
    await expect(form.locator('#formula_out')).toHaveValue(formula);
  }
  if (formula) await form.locator('#save_from_formula').check();
  else await form.locator('#save_from_formula').uncheck();
  const id = await row.getAttribute('rec_id');
  const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/save_tag/${id}/`, { timeout: 10_000 });
  await form.locator('#form_ok').click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect((await response.json()).error).toBeFalsy();
  await expect(form).toBeHidden();
  await row.locator('td.edit').click();
  await expect(form.locator('#formula_out')).toHaveValue(formula);
  if (formula) await expect(form.locator('#save_from_formula')).toBeChecked();
  else await expect(form.locator('#save_from_formula')).not.toBeChecked();
  await form.locator('#form_cancel').click();
  await expect(form).toBeHidden();
}

export async function setTagValue(page: Page, name: string, value: boolean | number) {
  const row = deviceTagRow(page, name);
  await requireOwned(page, row);
  await row.locator('td[id^="v"]').click();
  const input = page.locator('#form_edit #value_tag');
  if (typeof value === 'boolean') {
    if (await input.isChecked() !== value) await input.locator('..').locator('span').click();
    if (value) await expect(input).toBeChecked();
    else await expect(input).not.toBeChecked();
  } else await input.fill(String(value));
  await page.locator('#form_edit #btn_set_form_value_tag').click();
  await expect(page.locator('#form_edit')).toHaveCount(0);
  const displayed = row.locator('td[id^="v"]');
  if (typeof value === 'boolean') {
    await expect(displayed).toHaveText(value ? 'True' : 'False');
  } else {
    await expect.poll(async () => {
      const text = (await displayed.textContent())?.trim();
      return text ? Number(text) : NaN;
    }).toBe(value);
  }
}

export async function expectTagValueUnchanged(dest: Locator, expected: string, action: () => Promise<void>) {
  await expect(dest).toHaveText(expected);
  await dest.evaluate(cell => {
    const values: string[] = [];
    const observer = new MutationObserver(() => values.push(cell.textContent?.trim() || ''));
    observer.observe(cell, { childList: true, characterData: true, subtree: true });
    (cell as HTMLElement & { observation?: { values: string[]; observer: MutationObserver } }).observation = { values, observer };
  });
  try {
    await action();
    // shortcut: окно наблюдения 2 с; серверный предел задержки неизвестен.
    await dest.page().waitForTimeout(2000);
    const values = await dest.evaluate(cell =>
      (cell as HTMLElement & { observation?: { values: string[] } }).observation?.values || []);
    expect(values.filter(value => value !== expected)).toEqual([]);
    await expect(dest).toHaveText(expected);
  } finally {
    await dest.evaluate(cell => {
      const target = cell as HTMLElement & { observation?: { observer: MutationObserver } };
      target.observation?.observer.disconnect();
      delete target.observation;
    });
  }
}

export async function openTagAlarms(page: Page, name: string) {
  await deviceTagRow(page, name).locator('td.alarm').click();
  await expect(page.locator('#form_edit_alarms_from_tag')).toContainText(`Аварии для тега "${name}"`);
}

export async function ensureTagAlarm(page: Page, name: string) {
  const row = alarmRow(page, name);
  if (!(await row.count())) {
    await page.locator('#form_edit_alarms_from_tag #form_add').click();
    await page.locator('#form_edit_alarm #name').fill(name);
    const id = await saveOwned(page, '/save_alarm/', ['alarm_id', 'node_id'], () => page.locator('#form_edit_alarm #form_ok').click());
    await expect(row).toHaveAttribute('rec_id', id);
  } else {
    await requireOwned(page, row);
  }
  await expect(row).toContainText(name);
  return row;
}

export async function ensureAlarmThreshold(page: Page, name: string, operator: string, threshold: string) {
  const row = alarmRow(page, name);
  const preview = row.locator('td.alarm').first();
  const symbol = operator === 'less' ? '<' : '>';
  if ((await preview.textContent())?.includes(`v${symbol}${threshold}`)) return;
  await preview.click();
  const form = page.locator('#form_edit_if_alarm');
  const condition = form.locator('.fields .div_tr');
  if (!(await condition.count())) {
    await form.locator('.buttons .btn_add').filter({ hasText: 'Добавить' }).click();
    await condition.locator('select').selectOption(operator);
    await condition.locator('input').fill(threshold);
    await form.locator('#form_ok').click();
  } else {
    await expect(condition.locator('select')).toHaveValue(operator);
    await expect(condition.locator('input')).toHaveValue(threshold);
    await form.locator('#form_cancel').click();
  }
}

export async function expectNewAlarmEvent(page: Page, seen: string[], name: string, detail: string, cellClass: 'ev_alert' | 'ev_check') {
  await expect.poll(() => page.locator('#table_events tr[event_id]').evaluateAll((rows, expected) =>
    rows.some(row => !expected.seen.includes(row.getAttribute('event_id') || '') &&
      !!row.querySelector(`td.${expected.cellClass}`) && row.textContent?.includes(expected.name) &&
      row.textContent?.includes(expected.detail)), { seen, name, detail, cellClass })).toBe(true);
}

export async function openTrendList(page: Page) {
  await waitForIdle(page);
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/edit_main_trends/' && response.ok());
  await page.locator('#panel_right [title="Тренды"]').click();
  await (await loaded).finished();
  await expect(page.locator('#header_main > div:first-child')).toContainText('Тренды:');
  await waitForIdle(page);
}

export async function openTrendConfig(page: Page, name: string) {
  await openTrendList(page);
  const row = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name, exact: true }) });
  await expect(row).toHaveCount(1);
  await row.locator('td.tag').click();
  await expect(page.locator('#header_main')).toContainText(`Настройка тренда: ${name}`);
}

export async function deleteTrend(page: Page, name: string) {
  const row = page.locator('#table_option tr').filter({ has: page.getByRole('cell', { name, exact: true }) });
  await requireOwned(page, row);
  await row.locator('td.delete').click();
  await expect(page.locator('#my_confirm')).toContainText('Удалить тренд(ы)?');
  await page.locator('#btn_ok_confirm').click();
  await expect(row).toHaveCount(0);
}

export async function deleteAlarm(page: Page, name: string) {
  const row = alarmRow(page, name);
  await requireOwned(page, row);
  await row.locator('td.delete').click();
  await expect(page.locator('#my_confirm')).toContainText('Удалить аварию(и)?');
  await page.locator('#btn_ok_confirm').click();
  await expect(row).toHaveCount(0);
}
