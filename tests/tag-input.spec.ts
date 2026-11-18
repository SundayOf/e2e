import { expect, test } from './helpers/test';
import {
  deleteVirtualDeviceIfPresent, ensureProject, ensureVirtualDevice, ensureVirtualTag, expectTagValueUnchanged,
  openDeviceTags, openDeviceTree, openProject, projectName, setTagValue, signIn,
} from './helpers/scada';

test('Ввод числа, текста и пустого значения в числовой тег', { tag: ['@tags', '@tag04', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(90_000);
  const device = 'Ввод числового тега';
  const tag = 'Проверяемый';
  const editor = page.locator('#form_edit');
  const input = editor.locator('#value_tag');
  const error = page.locator('#div_msg.msg_error');
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
    if (await editor.isVisible()) await editor.locator('.btn_cancel').click();
    if (await page.locator('#form_edit_tag').isVisible()) await page.locator('#form_edit_tag #form_cancel').click();
    await deleteVirtualDeviceIfPresent(page, device);
    await openDeviceTree(page);
    await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
  });
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
  await expect(value).toHaveText('0');
  await expect(control).toHaveText('0');
  await setTagValue(page, 'Контроль', 9);
  await setTagValue(page, tag, 2);
  let writeRequests = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `/set_value_tag/${id}/`) writeRequests++;
  });
  await setTagValue(page, tag, 3);
  expect(writeRequests).toBe(1);
  await setTagValue(page, tag, 2);
  expect(writeRequests).toBe(2);
  const reopen = async (expected: string) => {
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(2)).toHaveText(tag);
    await expect(value).toHaveText(expected);
    await expect(control).toHaveText('9');
  };

  await test.step('Ввести текст: сообщение об ошибке, запрос не отправлен', async () => {
    // shortcut: UI-05 требует завершения предыдущего уведомления; убрать ожидание после исправления продукта.
    await expect(page.locator('#div_msg')).toHaveCount(0);
    await value.click();
    await expect(editor).toBeVisible();
    await input.fill('abc');
    await expect(input).toHaveValue('abc');
    const before = writeRequests;
    await expectTagValueUnchanged(value, '2', async () => {
      await editor.locator('#btn_set_form_value_tag').click();
      await expect(error).toBeVisible();
      await expect(error).toContainText('Должно быть число');
    });
    expect(writeRequests).toBe(before);
    await expect(editor).toBeVisible();
    await expect(input).toHaveValue('abc');
    await expect(control).toHaveText('9');
    await error.locator('.msg_close').click();
    await editor.locator('.btn_cancel').click();
    await reopen('2');
  });
  await test.step('Записать отрицательную дробь и ноль', async () => {
    await setTagValue(page, tag, -2.5);
    await reopen('-2.5');
    await setTagValue(page, tag, 0);
    await reopen('0');
  });
  await test.step('Очистить поле, проверить Null и снова записать число', async () => {
    await setTagValue(page, tag, 2);
    await value.click();
    await expect(editor).toBeVisible();
    await input.fill('');
    await expect(input).toHaveValue('');
    const before = writeRequests;
    await editor.locator('#btn_set_form_value_tag').click();
    await expect(editor).toHaveCount(0);
    expect(writeRequests).toBe(before + 1);
    await expect(value).toHaveText('Null');
    await reopen('Null');
    await setTagValue(page, tag, 2);
    await reopen('2');
  });
});
