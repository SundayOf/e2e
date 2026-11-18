import { expect, test } from './helpers/test';
import {
  deleteVirtualDeviceIfPresent, ensureProject, ensureVirtualDevice, ensureVirtualTag, expectTagValueUnchanged,
  openDeviceTags, openDeviceTree, openProject, projectName, setTagValue, signIn,
} from './helpers/scada';
import { replayUiPost } from './helpers/security';

test('Включение и отключение чтения и записи тега', { tag: ['@tags', '@tag08', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(90_000);
  const device = 'Режимы тега';
  const tag = 'Проверяемый';
  const form = page.locator('#form_edit_tag');
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
    if (await form.isVisible()) await form.locator('#form_cancel').click();
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
  const captured = page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === `/set_value_tag/${id}/`, { timeout: 10_000 });
  await setTagValue(page, tag, 5);
  const source = await captured;
  await setTagValue(page, tag, 2);

  const reopen = async () => {
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(2)).toHaveText(tag);
    await expect(control).toHaveText('9');
  };
  const setMode = async (read: boolean, write: boolean) => {
    await row.locator('td.edit').click();
    await expect(form).toBeVisible();
    for (const [selector, enabled] of [['#read_value', read], ['#write_value', write]] as const) {
      const input = form.locator(selector);
      if (await input.isChecked() !== enabled) await input.locator('..').locator('span').click();
      await expect(input).toBeChecked({ checked: enabled });
    }
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/save_tag/${id}/`, { timeout: 10_000 });
    await form.locator('#form_ok').click();
    expect((await (await saved).json()).error).toBeFalsy();
    await expect(form).toBeHidden();
    await reopen();
    await expect(row.locator('td').nth(7)).toHaveText(`${read ? 'R' : ''}${write ? 'W' : ''}`);
    await row.locator('td.edit').click();
    await expect(form).toBeVisible();
    await expect(form.locator('#read_value')).toBeChecked({ checked: read });
    await expect(form.locator('#write_value')).toBeChecked({ checked: write });
    await form.locator('#form_cancel').click();
  };

  await test.step('Отключить запись и проверить запрет изменения', async () => {
    await setMode(true, false);
    await expect(value).toHaveText('2');
    await expect(value).not.toHaveAttribute('onclick', /edit_value/);
    await value.click();
    await expectTagValueUnchanged(value, '2', async () => {
      const response = await replayUiPost(page, source, source.url());
      await test.info().attach('Ответ записи при выключенном флаге', { body: String(response.status()), contentType: 'text/plain' });
    });
    await expect(page.locator('#form_edit')).toHaveCount(0);
    await reopen();
    await expect(value).toHaveText('2');
  });
  await test.step('Включить запись и изменить значение', async () => {
    await setMode(true, true);
    await expect(value).toHaveText('2');
    await expect(value).toHaveAttribute('onclick', /edit_value/);
    expect((await replayUiPost(page, source, source.url())).ok()).toBe(true);
    await expect(value).toHaveText('5');
    await reopen();
    await expect(value).toHaveText('5');
  });
  await test.step('Отключить чтение: значение Null, запись доступна', async () => {
    await setMode(false, true);
    await expectTagValueUnchanged(value, 'Null', async () => {
      await value.click();
      await expect(page.locator('#form_edit')).toBeVisible();
      await page.locator('#form_edit .btn_cancel').click();
    });
    await expect(control).toHaveText('9');
  });
  await test.step('Включить чтение и проверить новое значение', async () => {
    await setMode(true, true);
    await setTagValue(page, tag, 8);
    await reopen();
    await expect(value).toHaveText('8');
    await expect(row.locator('td').nth(7)).toHaveText('RW');
  });
});
