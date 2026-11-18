import { expect, test } from './helpers/test';
import type { Locator } from '@playwright/test';
import { requireOwned, saveOwned } from './helpers/owned';
import {
  ensureProject, ensureVirtualTag, openDeviceTree, openProject, projectName, setTagValue, signIn,
} from './helpers/scada';

test.use({ actionTimeout: 10_000 });

test('Создание устройства с тегами внутри группы', { tag: ['@tree', '@tree02', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const groupName = 'Насосная станция';
  const deviceName = 'Резервуар';
  let groupId = '';
  let deviceId = '';
  const node = (name: string) => page.locator('#panel_main2 #main span.devices_tree_title').and(page.getByText(name, { exact: true }));
  const group = node(groupName);
  const device = node(deviceName);
  const openTree = async () => {
    await openDeviceTree(page);
    await expect(page.locator('#header_main > div:first-child')).toHaveText('Дерево проекта');
    await expect(page.locator('#div_msg').filter({ hasText: 'Пожалуйста, подождите' })).toBeHidden();
  };
  const expandGroup = async () => {
    const id = await group.getAttribute('node_id');
    expect(id).toBeTruthy();
    const children = page.locator(`#children_${id}`);
    const expand = page.locator(`#tree_${id} > .btn_tree_plus`);
    if (await expand.isVisible()) await expand.click();
    return children;
  };
  const openMenu = async (target?: Locator) => {
    if (target) {
      await target.click();
      await target.click({ button: 'right' });
    } else {
      await page.locator('#panel_main2 #main').click({ button: 'right', position: { x: 100, y: 100 } });
    }
    const menu = page.locator('#menu_devices');
    await expect(menu).toHaveClass(/\bshow-menu\b/);
    return menu;
  };
  const deleteNode = async (target: Locator, kind: 'Устройства' | 'Группы') => {
    await requireOwned(page, target, 'node_id');
    const menu = await openMenu(target);
    await menu.locator('#item_delete_node_devices > button').click();
    const confirm = page.locator('#confirm_delete_nodes');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(`${kind} (1)`);
    await confirm.locator('.buttons .btn_add').click();
    await expect(target).toHaveCount(0);
  };
  const cleanup = async () => {
    const backdrop = page.locator('#fade');
    if (await backdrop.isVisible()) await backdrop.click({ position: { x: 5, y: 5 } });
    else if (await page.locator('#menu_devices').evaluate(el => el.classList.contains('show-menu'))) {
      await page.locator('#header_main').click({ position: { x: 5, y: 5 } });
    }
    for (const selector of ['#form_edit_tag', '#form_edit_device_hub', '#form_edit_device_group']) {
      if (await page.locator(selector).isVisible()) await page.locator(`${selector} #form_cancel`).click();
    }
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
    await openTree();
    if (groupId && await group.count()) await expandGroup();
    if (deviceId && await device.count()) await deleteNode(device, 'Устройства');
    await openTree();
    await expect(device).toHaveCount(0);
    if (groupId && await group.count()) {
      const children = await expandGroup();
      await expect(children.locator('.devices_tree_title'), 'Удалять можно только свою пустую группу').toHaveCount(0);
      await deleteNode(group, 'Группы');
    }
    await openTree();
    await expect(group).toHaveCount(0);
    await expect(device).toHaveCount(0);
  };

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  await openTree();
  await expect(group, 'Название группы уже занято: существующие объекты не удаляем').toHaveCount(0);
  await expect(device, 'Название устройства уже занято: существующие объекты не удаляем').toHaveCount(0);
  onCleanup(cleanup);
  await test.step('Создать группу и устройство внутри неё', async () => {
    let menu = await openMenu();
    await menu.locator('#add_node > button').hover();
    await menu.locator('#item_add_device_group > button').click();
    const form = page.locator('#form_edit_device_group');
    await expect(form).toBeVisible();
    // Клик по подложке закрывает контекстное меню штатным mouseup.
    await page.locator('#fade').click({ position: { x: 5, y: 5 } });
    await expect(menu).not.toHaveClass(/\bshow-menu\b/);
    await expect(menu).toHaveCSS('pointer-events', 'none');
    await form.locator('#title').fill(groupName);
    groupId = await saveOwned(page, '/save_device_group/', 'node_id', () => form.locator('#form_ok').click());
    await expect(form).toBeHidden();
    await openTree();
    await expect(group).toHaveCount(1);
    await expect(group).toHaveAttribute('node_id', groupId);
    menu = await openMenu(group);
    await menu.locator('#add_node > button').hover();
    await menu.locator('#item_add_device > button').click();
    const deviceForm = page.locator('#form_edit_device_hub');
    await expect(deviceForm).toBeVisible();
    await page.locator('#fade').click({ position: { x: 5, y: 5 } });
    await expect(menu).not.toHaveClass(/\bshow-menu\b/);
    await expect(menu).toHaveCSS('pointer-events', 'none');
    await deviceForm.locator('#title').click();
    await deviceForm.locator('#title').fill(deviceName);
    await deviceForm.locator('#mode_select_device').selectOption({ label: 'Virtual' });
    const savedDevice = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/save_device//', { timeout: 10_000 });
    deviceId = await saveOwned(page, '/save_device/', 'node_id', () => deviceForm.locator('#form_ok').click());
    const deviceResponse = await savedDevice;
    expect(deviceResponse.ok()).toBe(true);
    expect((await deviceResponse.json()).error).toBeFalsy();
    expect(JSON.parse(deviceResponse.request().postData()!)).toMatchObject({ parent_id: groupId, nt_parent: 1 });
    await expect(deviceForm).toBeHidden();
    await expect(device).toHaveCount(1);
    await expect(device).toHaveAttribute('node_id', deviceId);
    expect(deviceId).not.toBe(groupId);
  });

  const readHierarchy = async () => {
    await openTree();
    await expect(group).toHaveAttribute('node_id', groupId);
    await expect(device).toHaveAttribute('node_id', deviceId);
    const children = await expandGroup();
    await expect(children).toBeVisible();
    await expect(children.locator(`:scope > #tree_${deviceId} > .devices_tree_title`)).toHaveText(deviceName);
    await expect(children.locator('.devices_tree_title')).toHaveCount(1);
  };
  const openTags = async () => {
    const menu = await openMenu(device);
    await menu.locator('#item_tags_node_devices > button').click();
    await expect(page.locator('#header_main')).toContainText(deviceName);
    await expect(page.locator('#table_option')).toBeVisible();
  };
  const level = page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'Уровень воды', exact: true }) });
  const control = page.locator('#table_option tr[rec_id]').filter({ has: page.getByRole('cell', { name: 'Давление', exact: true }) });
  let levelId = '';
  let controlId = '';
  await test.step('Открыть дерево заново и записать значения тегов', async () => {
    await readHierarchy();
    await openTags();
    await ensureVirtualTag(page, { id: 2, name: 'Уровень воды', type: 'Float' });
    await ensureVirtualTag(page, { id: 3, name: 'Давление', type: 'Float' });
    levelId = (await level.getAttribute('rec_id'))!;
    controlId = (await control.getAttribute('rec_id'))!;
    expect(levelId).toBeTruthy();
    expect(controlId).toBeTruthy();
    expect(levelId).not.toBe(controlId);
    await expect(level.locator('td[id^="v"]')).toHaveText('0');
    await expect(control.locator('td[id^="v"]')).toHaveText('0');
    await setTagValue(page, 'Уровень воды', 7);
    await setTagValue(page, 'Давление', 9);
  });
  await test.step('Проверить группу, теги и их значения после открытия', async () => {
    await readHierarchy();
    await openTags();
    await expect(level).toHaveAttribute('rec_id', levelId);
    await expect(control).toHaveAttribute('rec_id', controlId);
    await expect(level.locator('td[id^="v"]')).toHaveText('7');
    await expect(control.locator('td[id^="v"]')).toHaveText('9');
    await setTagValue(page, 'Уровень воды', -2.5);
    await readHierarchy();
    await openTags();
    await expect(level).toHaveAttribute('rec_id', levelId);
    await expect(control).toHaveAttribute('rec_id', controlId);
    await expect(level.locator('td[id^="v"]')).toHaveText('-2.5');
    await expect(control.locator('td[id^="v"]')).toHaveText('9');
  });
});
