import { expect, test } from './helpers/test';
import { deleteVirtualDeviceIfPresent, ensureVirtualDevice, ensureVirtualTag, openDeviceTags, openDeviceTree, openProject, projectName, signIn, signInAsAdmin, signOut } from './helpers/scada';
import { scriptMarkers, watchScriptMarker } from './helpers/security';

test('Отображение спецсимволов в названии и единице тега', { tag: ['@security', '@access', '@tags', '@sec09', '@pen01', '@mixed', '@permissions'] }, async ({ page, onCleanup }) => {
  test.setTimeout(120_000);
  const device = 'Датчик проверки ввода';
  const name = 'Уровень бака';
  const form = page.locator('#form_edit_tag');
  const checkSafe = await watchScriptMarker(page);
  let role: 'автор' | 'администратор' = 'автор';
  await signIn(page);
  await openProject(page, projectName);
  onCleanup(async () => {
    if (await form.isVisible()) await form.locator('#form_cancel').click();
    await deleteVirtualDeviceIfPresent(page, device);
    await openDeviceTree(page);
    await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
    await checkSafe();
  });
  await deleteVirtualDeviceIfPresent(page, device);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  const created = await ensureVirtualTag(page, { id: 2, name, type: 'Float' });
  const id = await created.getAttribute('rec_id');
  expect(id).toBeTruthy();
  const row = page.locator(`#table_option tr[rec_id="${id}"]`);
  for (const field of [
    { title: 'Название', input: '#title', column: 2, original: name },
    { title: 'Единица', input: '#unit', column: 9, original: '' },
  ]) {
    for (const [index, marker] of scriptMarkers.entries()) {
      await test.step(`${field.title}: ${index === 0 ? 'HTML' : 'выход из кавычек'}`, async () => {
        if (role === 'администратор') {
          await signOut(page);
          await signIn(page);
          role = 'автор';
          await openProject(page, projectName);
          await openDeviceTree(page);
          await openDeviceTags(page, device);
        }
        await row.locator('td.edit').click();
        await expect(form).toBeVisible();
        await expect(form.locator(field.input)).toHaveValue(field.original);
        const value = `${field.input === '#title' ? name : 'м'} ${marker}`;
        await form.locator(field.input).fill(value);
        await expect(form.locator(field.input)).toHaveValue(value);
        const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/save_tag/${id}/`, { timeout: 10_000 });
        await form.locator('#form_ok').click();
        expect((await (await saved).json()).error).toBeFalsy();
        await expect(form).toBeHidden();
        await checkSafe();
        await expect.soft(row.locator('td').nth(field.column)).toHaveText(value);
        for (const reader of ['автор', 'администратор'] as const) {
          if (reader === 'администратор') {
            await signOut(page);
            await signInAsAdmin(page);
            role = 'администратор';
            await openProject(page, projectName);
          }
          await test.step(`Список и форма: ${reader}`, async () => {
            await openDeviceTree(page);
            await openDeviceTags(page, device);
            await checkSafe();
            await expect.soft(row.locator('td').nth(field.column)).toHaveText(value);
            await row.locator('td.edit').click();
            await expect(form).toBeVisible();
            await checkSafe();
            await expect.soft(form.locator(field.input)).toHaveValue(value);
            await form.locator('#form_cancel').click();
          });
        }
        // Каждый вариант начинает с исходного поля, чтобы причины отказа не смешивались.
        await row.locator('td.edit').click();
        await expect(form).toBeVisible();
        await form.locator(field.input).fill(field.original);
        const restored = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/save_tag/${id}/`, { timeout: 10_000 });
        await form.locator('#form_ok').click();
        expect((await (await restored).json()).error).toBeFalsy();
        await expect(form).toBeHidden();
        await openDeviceTree(page);
        await openDeviceTags(page, device);
        await expect(row.locator('td').nth(field.column)).toHaveText(field.original);
      });
    }
  }
});
