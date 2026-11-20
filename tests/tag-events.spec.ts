import { expect, test } from './helpers/test';
import {
  deleteVirtualDeviceIfPresent, ensureProject, ensureVirtualDevice, ensureVirtualTag, expectTagValueUnchanged,
  openDeviceTags, openDeviceTree, openProject, projectName, setTagValue, signIn, currentUser,
} from './helpers/scada';

test('Включение и отключение журнала событий тега', { tag: ['@tags', '@tag10', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(90_000);
  const device = 'Журналирование тега';
  const tag = 'Значение';
  const form = page.locator('#form_edit_tag');
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  const usersLoaded = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_users/' && r.ok());
  await page.locator('#panel_right [title="Пользователи"]').click();
  await (await usersLoaded).finished();
  const actor = await page.locator(`#table_option tr[fl="${currentUser().toLowerCase()}"] td`).nth(2).innerText();
  await expect.poll(() => page.evaluate(() => (window as unknown as { os: { vars: { keyup: { timer: number | false } } } }).os.vars.keyup.timer === false)).toBe(true);
  await expect(page.locator('#div_msg')).toBeHidden();
  const originalEventsSelected = await page.locator('#check_events').isChecked();
  onCleanup(async () => {
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
    if (await form.isVisible()) await form.locator('#form_cancel').click();
    const originalTab = originalEventsSelected ? 'check_events' : 'check_alarms';
    if (!await page.locator(`#${originalTab}`).isChecked()) {
      await page.locator(`#select_alarms_events label[for="${originalTab}"]`).first().click();
    }
    await expect(page.locator(`#${originalTab}`)).toBeChecked();
    await deleteVirtualDeviceIfPresent(page, device);
    await openDeviceTree(page);
    await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
  });
  if (!originalEventsSelected) await page.locator('#select_alarms_events label[for="check_events"]').first().click();
  await expect(page.locator('#content-events')).toBeVisible();
  await deleteVirtualDeviceIfPresent(page, device);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  const created = await ensureVirtualTag(page, { id: 2, name: tag, type: 'Float' });
  const id = await created.getAttribute('rec_id');
  expect(id).toBeTruthy();
  const createdControl = await ensureVirtualTag(page, { id: 3, name: 'Контроль', type: 'Float' });
  const controlId = await createdControl.getAttribute('rec_id');
  expect(controlId).toBeTruthy();
  const row = page.locator(`#table_option tr[rec_id="${id}"]`);
  const value = row.locator('td[id^="v"]');
  const control = page.locator(`#table_option tr[rec_id="${controlId}"] td[id^="v"]`);
  const events = page.locator(`#table_events tr[tag_id="${id}"][event_id]`);
  const eventIds = () => events.evaluateAll(rows => rows.map(r => r.getAttribute('event_id')));
  await expect(value).toHaveText('0');
  await expect(control).toHaveText('0');
  await setTagValue(page, 'Контроль', 9);

  const reopen = async () => {
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(2)).toHaveText(tag);
    await expect(control).toHaveText('9');
  };
  const setLogging = async (enabled: boolean) => {
    await row.locator('td.edit').click();
    await expect(form).toBeVisible();
    const input = form.locator('#edit_to_event');
    await expect(input).toBeChecked({ checked: !enabled });
    await input.locator('..').locator('span').click();
    await expect(input).toBeChecked({ checked: enabled });
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/save_tag/${id}/`, { timeout: 10_000 });
    await form.locator('#form_ok').click();
    expect((await (await saved).json()).error).toBeFalsy();
    await expect(form).toBeHidden();
    await reopen();
    await row.locator('td.edit').click();
    await expect(form.locator('#edit_to_event')).toBeChecked({ checked: enabled });
    await form.locator('#form_cancel').click();
  };

  await test.step('Включить журнал событий', async () => {
    await setLogging(true);
    await expect(value).toHaveText('0');
  });
  for (const [previous, next] of [[0, 2], [2, -2.5], [-2.5, 0]]) {
    await test.step(`Записать ${next} и найти событие ${previous} → ${next}`, async () => {
      const seen = await eventIds();
      await setTagValue(page, tag, next);
      const detail = `Изменение тега. ${previous} → ${next}`;
      const event = events.filter({ has: page.getByRole('cell', { name: detail, exact: true }) });
      await expect(event).toHaveCount(1);
      const eventId = await event.getAttribute('event_id');
      expect(eventId).toBeTruthy();
      expect(seen).not.toContain(eventId);
      await expect(event.locator('td.ev_tag')).toHaveCount(1);
      await expect(event.locator('td').nth(1)).toHaveText(/\d/);
      await expect(event.locator('td').nth(2)).toHaveText(detail);
      await expect(event.locator('td').nth(3)).toHaveText(`/${device}//${tag}`);
      await expect(event.locator('td').nth(5)).toHaveText(actor);
      await expect(control).toHaveText('9');
    });
  }
  await test.step('Отключить журнал и проверить отсутствие новых событий', async () => {
    await setLogging(false);
    const seen = await eventIds();
    await expectTagValueUnchanged(control, '9', () => setTagValue(page, tag, 7));
    expect((await eventIds()).filter(eventId => !seen.includes(eventId))).toEqual([]);
    await reopen();
    await expect(value).toHaveText('7');
    await row.locator('td.edit').click();
    await expect(form.locator('#edit_to_event')).not.toBeChecked();
    await form.locator('#form_cancel').click();
  });
});
