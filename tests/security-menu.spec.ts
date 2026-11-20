import { expect, test } from './helpers/test';
import { createMenuFolder, deleteMenuLink, openMenuEditor } from './helpers/menu';
import { openProject, projectName, signIn, signInAsAdmin, signOut } from './helpers/scada';
import { scriptMarkers, watchScriptMarker } from './helpers/security';

test('Отображение спецсимволов в названии папки меню', { tag: ['@security', '@access', '@menu', '@sec09', '@pen01', '@mixed', '@permissions'] }, async ({ page, onCleanup }) => {
  test.setTimeout(90_000);
  const name = 'Раздел проверки ввода';
  const form = page.locator('#form_edit_menu_item');
  const checkSafe = await watchScriptMarker(page);
  let id: string | null = null;
  await signIn(page);
  await openProject(page, projectName);
  onCleanup(async () => {
    if (await form.isVisible()) await form.locator('#form_cancel').click();
    await openMenuEditor(page);
    const row = id
      ? page.locator(`#panel_main2 #main .devices_tree_title[item_id="${id}"]`)
      : page.locator('#panel_main2 #main .devices_tree_title').and(page.getByText(name, { exact: true }));
    if (await row.count()) await deleteMenuLink(page, row);
    await openMenuEditor(page);
    await expect(row).toHaveCount(0);
    if (id) await expect(page.locator(`#user_item_id_${id}`)).toHaveCount(0);
    await checkSafe();
  });
  await openMenuEditor(page);
  const old = page.locator('#panel_main2 #main .devices_tree_title').and(page.getByText(name, { exact: true }));
  await expect(old, 'Существующий раздел меню не изменяем').toHaveCount(0);
  const created = await createMenuFolder(page, name);
  id = await created.getAttribute('item_id');
  expect(id).toBeTruthy();
  const row = page.locator(`#panel_main2 #main .devices_tree_title[item_id="${id}"]`);
  const left = page.locator(`#user_title_item_id_${id} > span`);
  await expect(left).toHaveText(name);
  for (const [index, marker] of scriptMarkers.entries()) {
    await test.step(index === 0 ? 'HTML в названии папки' : 'Выход из кавычек в названии папки', async () => {
      if (index > 0) {
        await signOut(page);
        await signIn(page);
        await openProject(page, projectName);
        await openMenuEditor(page);
      }
      await row.click();
      await row.click({ button: 'right' });
      await page.locator('#menu_context.show-menu #item_menu_edit > button').click();
      await expect(form).toBeVisible();
      await expect(form.locator('#type_id')).toHaveValue('0');
      const value = `${name} ${marker}`;
      await form.locator('#name').fill(value);
      const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/save_menu_item/${id}/`, { timeout: 10_000 });
      await form.locator('#form_ok').click();
      expect((await (await saved).json()).error).toBeFalsy();
      await expect(form).toBeHidden();
      await checkSafe();
      await expect.soft(row).toHaveText(value);
      await expect.soft(left).toHaveText(value);
      for (const role of ['автор', 'администратор']) {
        if (role === 'администратор') {
          await signOut(page);
          await signInAsAdmin(page);
          await openProject(page, projectName);
        }
        await test.step(`Дерево, левое меню и форма: ${role}`, async () => {
          await openMenuEditor(page);
          await checkSafe();
          await expect.soft(row).toHaveText(value);
          await expect.soft(left).toHaveText(value);
          await row.click();
          await row.click({ button: 'right' });
          await page.locator('#menu_context.show-menu #item_menu_edit > button').click();
          await expect(form).toBeVisible();
          await checkSafe();
          await expect.soft(form.locator('#name')).toHaveValue(value);
          await form.locator('#form_cancel').click();
        });
      }
    });
  }
});
