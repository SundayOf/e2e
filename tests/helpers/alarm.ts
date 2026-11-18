import { expect, type Locator, type Page } from '@playwright/test';
import { requireOwned } from './owned';
import {
  deleteVirtualDeviceIfPresent, ensureVirtualDevice, ensureVirtualTag, openDeviceTags,
  openDeviceTree, setTagValue, openTagAlarms, ensureTagAlarm, ensureAlarmThreshold,
} from './scada';

export const alarmDevice = 'Контроль уровня';
export const alarmTag = 'Уровень бака';
export const alarmName = 'Высокий уровень бака';

export async function prepareThresholdAlarm(page: Page) {
  await prepareAlarmTag(page);
  await setTagValue(page, alarmTag, 0);
  await openTagAlarms(page, alarmTag);
  await ensureTagAlarm(page, alarmName);
  await page.locator('#table_edit_alarms tr').filter({ hasText: alarmName }).locator('td.edit').last().click();
  const form = page.locator('#form_edit_alarm');
  await expect(form.locator('#enable_check')).toBeChecked();
  await form.locator('#form_cancel').click();
  await ensureAlarmThreshold(page, alarmName, 'more', '100');
  await page.locator('#form_edit_alarms_from_tag #form_cancel').click();
  return page.locator('#table_alarms tr[stamp]').filter({ hasText: alarmName });
}

export async function alarmEventIds(page: Page) {
  return page.locator('#table_events tr[event_id]').evaluateAll(rows => rows.map(row => row.getAttribute('event_id') || ''));
}

export async function acknowledgeAlarm(page: Page, row: Locator) {
  const id = await row.getAttribute('id');
  if (!id) throw new Error('У аварии отсутствует ID');
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `/check_alarm/${id}/`, { timeout: 10_000 });
  await row.locator('td.check_alarm').click();
  const result = await response;
  expect(result.ok()).toBe(true);
  expect((await result.json()).error).toBeFalsy();
  await expect(row).toHaveAttribute('status', '3');
}

async function deleteAlarmNodeIfPresent(page: Page, name: string) {
  await openDeviceTree(page);
  const alarm = page.locator('.devices_tree_title[node_type="5"]').filter({ hasText: new RegExp(`^${name}$`) });
  if (!(await alarm.count())) return;
  await requireOwned(page, alarm, 'node_id');
  await alarm.click();
  await alarm.click({ button: 'right' });
  await page.locator('#item_delete_node_devices > button').click();
  const confirm = page.locator('#confirm_delete_nodes');
  await expect(confirm).toContainText('Аварии (1)');
  await confirm.locator('.buttons .btn_add').click();
  await expect(alarm).toHaveCount(0);
}

export async function prepareAlarmTag(page: Page, otherAlarmNames: string[] = []) {
  await openDeviceTree(page);
  for (const name of [alarmName, ...otherAlarmNames]) {
    await expect(page.locator('.devices_tree_title[node_type="5"]').and(page.getByText(name, { exact: true })), 'Существующую аварию не изменяем').toHaveCount(0);
  }
  await expect(page.locator('.devices_tree_title').and(page.getByText(alarmDevice, { exact: true })), 'Существующее устройство не изменяем').toHaveCount(0);
  await ensureVirtualDevice(page, alarmDevice);
  await openDeviceTags(page, alarmDevice);
  await ensureVirtualTag(page, { id: 2, name: alarmTag, type: 'Float' });
}

export async function cleanupAlarmTag(page: Page, otherAlarmNames: string[] = []) {
  for (const selector of ['#form_edit_if_alarm', '#form_edit_alarm', '#form_edit_alarms_from_tag']) {
    const form = page.locator(selector);
    if (await form.isVisible()) await form.locator('#form_cancel').click();
  }
  await openDeviceTree(page);
  if (await page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${alarmDevice}$`) }).count()) {
    await requireOwned(page, page.locator('.devices_tree_title').and(page.getByText(alarmDevice, { exact: true })), 'node_id');
    await openDeviceTags(page, alarmDevice);
    if (await page.locator('#table_option tr').filter({ hasText: alarmTag }).count()) {
      await setTagValue(page, alarmTag, 0);
    }
  }
  for (const name of [alarmName, ...otherAlarmNames]) await deleteAlarmNodeIfPresent(page, name);
  await deleteVirtualDeviceIfPresent(page, alarmDevice);
  await openDeviceTree(page);
  for (const name of [alarmName, ...otherAlarmNames]) {
    await expect(page.locator('.devices_tree_title[node_type="5"]').filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(0);
  }
  await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${alarmDevice}$`) })).toHaveCount(0);
}
