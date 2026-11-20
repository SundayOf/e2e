import { expect, test } from './helpers/test';
import { openProject, projectName, signIn, signInAsAdmin, signOut } from './helpers/scada';
import { scriptMarkers, watchScriptMarker } from './helpers/security';
import { deleteViewRow, openViewList, viewRow } from './helpers/view';
import { saveOwned } from './helpers/owned';

for (const item of [
  { kind: 'карты', menu: 'Карты', heading: 'Карты', form: '#form_edit_map', name: 'План проверки', path: '/save_map/', question: 'Удалить карту(ы)?', tag: '@map' },
  { kind: 'камеры', menu: 'Камеры IP', heading: 'Камеры', form: '#form_edit_camera', name: 'Камера проверки', path: '/save_camera/', question: 'Удалить камеру(ы)?', tag: '@camera' },
]) {
  test(`Отображение спецсимволов в названии ${item.kind}`, { tag: ['@security', '@access', '@sec09', '@pen01', item.tag, '@mixed', '@permissions'] }, async ({ page, onCleanup }) => {
    test.setTimeout(90_000);
    const checkSafe = await watchScriptMarker(page);
    const form = page.locator(item.form);
    let id: string | null = null;
    await signIn(page);
    await openProject(page, projectName);
    await openViewList(page, item.menu, item.heading);
    await expect(viewRow(page, item.name), 'Существующий объект не изменяем').toHaveCount(0);
    onCleanup(async () => {
      if (await form.isVisible()) await form.locator('#form_cancel').click();
      if (!id) return;
      await openViewList(page, item.menu, item.heading);
      const row = page.locator(`#table_option tr[rec_id="${id}"]`);
      if (await row.count()) await deleteViewRow(page, row, item.question);
      await openViewList(page, item.menu, item.heading);
      await expect(row).toHaveCount(0);
    });
    await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
    await expect(form).toBeVisible();
    await form.locator('#name').fill(item.name);
    if (item.tag === '@camera') {
      await form.locator('#url').fill('rtsp://127.0.0.1:8554/e2e');
      await form.locator('label.edit_cb span').click();
      await expect(form.locator('#enabled')).not.toBeChecked();
    } else {
      await form.locator('#lat').fill('55.75');
      await form.locator('#lon').fill('37.62');
      await form.locator('#scale').fill('15');
    }
    id = await saveOwned(page, item.path, item.tag === '@map' ? 'map_id' : 'camera_id', () => form.locator('#form_ok').click());
    const original = viewRow(page, item.name);
    await expect(original).toBeVisible();
    await expect(original).toHaveAttribute('rec_id', id);
    const row = page.locator(`#table_option tr[rec_id="${id}"]`);
    const nameCell = row.locator('td').nth(item.tag === '@camera' ? 2 : 1);
    for (const [index, marker] of scriptMarkers.entries()) {
      const value = `${item.name} ${marker}`;
      await test.step(index === 0 ? 'HTML в текстовом контексте' : 'Выход из кавычек атрибута', async () => {
        if (index > 0) {
          await signOut(page);
          await signIn(page);
          await openProject(page, projectName);
          await openViewList(page, item.menu, item.heading);
        }
        await row.locator('td.edit').click();
        await expect(form).toBeVisible();
        await form.locator('#name').fill(value);
        const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `${item.path}${id}/`, { timeout: 10_000 });
        await form.locator('#form_ok').click();
        expect((await (await saved).json()).error).toBeFalsy();
        await expect(form).toBeHidden();
        await checkSafe();
        await expect.soft(nameCell).toHaveText(value);
        for (const role of ['автор', 'администратор']) {
          if (role === 'администратор') {
            await signOut(page);
            await signInAsAdmin(page);
            await openProject(page, projectName);
          }
          await test.step(`Повторное чтение: ${role}`, async () => {
            await openViewList(page, item.menu, item.heading);
            await checkSafe();
            await expect.soft(nameCell).toHaveText(value);
            await row.locator('td.edit').click();
            await expect(form).toBeVisible();
            await checkSafe();
            await expect.soft(form.locator('#name')).toHaveValue(value);
            await form.locator('#form_cancel').click();
          });
        }
      });
    }
    await checkSafe();
  });
}
