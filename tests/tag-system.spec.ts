import { expect, test } from './helpers/test';
import {
  deleteTag, deleteVirtualDeviceIfPresent, ensureProject, ensureVirtualDevice, ensureVirtualTag,
  openDeviceTags, openDeviceTree, openProject, projectName, setTagValue, signIn,
} from './helpers/scada';

test('Защита системного тега от удаления', { tag: ['@tags', '@tag12', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(90_000);
  const device = 'Защита системного тега';
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    if (await page.locator('#my_confirm').isVisible()) await page.locator('#btn_cancel_confirm').click();
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
    if (await page.locator('#form_edit_tag').isVisible()) await page.locator('#form_edit_tag #form_cancel').click();
    await deleteVirtualDeviceIfPresent(page, device);
    await openDeviceTree(page);
    await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
  });
  await deleteVirtualDeviceIfPresent(page, device);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  const initialStatus = page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'StatusDevice', exact: true }) });
  await expect(initialStatus).toHaveCount(1);
  const statusId = await initialStatus.getAttribute('rec_id');
  expect(statusId).toBeTruthy();
  const createdControl = await ensureVirtualTag(page, { id: 2, name: 'Контроль', type: 'Float' });
  const controlId = await createdControl.getAttribute('rec_id');
  expect(controlId).toBeTruthy();
  await expect(createdControl.locator('td[id^="v"]')).toHaveText('0');
  await setTagValue(page, 'Контроль', 9);
  const createdRemovable = await ensureVirtualTag(page, { id: 3, name: 'Удаляемый', type: 'Float' });
  const removableId = await createdRemovable.getAttribute('rec_id');
  expect(removableId).toBeTruthy();
  await expect(createdRemovable.locator('td[id^="v"]')).toHaveText('0');
  await setTagValue(page, 'Удаляемый', 5);
  const status = page.locator(`#table_option tr[rec_id="${statusId}"]`);
  const control = page.locator(`#table_option tr[rec_id="${controlId}"]`);
  const removable = page.locator(`#table_option tr[rec_id="${removableId}"]`);
  const selected = page.locator('#table_option tr[rec_id]:has(td.check_row)');
  const assertStatus = async () => {
    await expect(status).toHaveCount(1);
    await expect(status.locator('td').nth(1)).toHaveText('1');
    await expect(status.locator('td').nth(2)).toHaveText('StatusDevice');
    await expect(status.locator('td.status_device[status]')).toHaveCount(1);
    await expect(status.locator('td.delete, td.uncheck, td.check_row')).toHaveCount(0);
  };
  await assertStatus();

  await test.step('Выделить все теги: системный тег не выбран', async () => {
    const selectAll = page.locator('#table_option tr[header] th[onclick*="all_ckeck_row"]');
    await expect(selected).toHaveCount(0);
    await selectAll.click();
    await expect(selected).toHaveCount(2);
    expect(await selected.evaluateAll(rows => rows.map(r => r.getAttribute('rec_id')).sort())).toEqual([controlId, removableId].sort());
    await assertStatus();
    await selectAll.click();
    await expect(selected).toHaveCount(0);
    await expect(control.locator('td.uncheck')).toHaveCount(1);
    await expect(removable.locator('td.uncheck')).toHaveCount(1);
    await expect(control.locator('td[id^="v"]')).toHaveText('9');
    await expect(removable.locator('td[id^="v"]')).toHaveText('5');
  });
  await test.step('Удалить обычный тег и проверить оставшиеся', async () => {
    await expect(removable.locator('td.delete')).toBeVisible();
    await deleteTag(page, 'Удаляемый');
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(removable).toHaveCount(0);
    await expect(page.locator('#table_option tr[rec_id]')).toHaveCount(2);
    await assertStatus();
    await expect(control.locator('td').nth(2)).toHaveText('Контроль');
    await expect(control.locator('td[id^="v"]')).toHaveText('9');
  });
  await test.step('Записать значение в оставшийся тег', async () => {
    await setTagValue(page, 'Контроль', 12);
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await assertStatus();
    await expect(control.locator('td[id^="v"]')).toHaveText('12');
  });
});
