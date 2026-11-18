import { expect, type Page } from '@playwright/test';
import { chooseTag, openDeviceTags, openDeviceTree, setTagValue } from './scada';
import { openMnemonicEditor, saveMnemonicEditor } from './mnemonic';

export async function checkTankLevelGuard(page: Page) {
  await page.locator('[title="Мнемосхемы"]').click();
  const editor = await openMnemonicEditor(page, 'Бак');
  try {
    await editor.locator('label[for="tree_elements_box_tab"]').click();
    await editor.locator('#tree_g64m27 span').click();
    const rules = editor.locator('#table_rules_os_rules34m27 tr[row_id]');
    const guard = editor.locator('#my_svg #rect32m27 os_rule').filter({ hasText: '"height":"80"' });
    await expect(rules.filter({ hasText: 'Высота:=0.8*(100-#)' })).toHaveCount(1);

    if (!(await guard.count())) {
      await editor.locator('#children_os_rules34m27 .btn_add[onclick^="os.editor.events.cmd.edit"]').click();
      const form = editor.locator('#edit_data_command_form');
      await expect(form).toBeVisible();
      await chooseTag(editor, form.locator('#td_select_tag_tree_value'), 'TankControl', 'TankLevel');
      await form.locator('#edit_ifs_td').click();
      const conditions = editor.locator('#edit_ifs');
      await conditions.locator('#add').click();
      await conditions.locator('#table_option_ifs select').selectOption('less');
      await conditions.locator('#table_option_ifs input').fill('0');
      await conditions.locator('#form_ok').click();
      const height = form.locator('input[num_elem="26"]');
      await height.locator('../..').locator('td:first-child input[type="checkbox"]').check();
      await height.fill('80');
      await form.locator('.buttons #save').click();
      await expect(guard).toContainText('"if":"less","v":"0"');
      await saveMnemonicEditor(editor);
    }

    await editor.reload();
    await expect(guard).toContainText('"if":"less","v":"0"');
  } finally {
    await editor.close();
  }

  try {
    for (const [level, height] of [[50, '40'], [-1, '80']] as const) {
      await openDeviceTree(page);
      await openDeviceTags(page, 'TankControl');
      await setTagValue(page, 'TankLevel', level);
      await page.locator('#menu_main').getByText('Бак', { exact: true }).click();
      await expect(page.locator('#main > svg#my_svg #g64m27 #rect32m27')).toHaveAttribute('height', height);
    }
  } finally {
    await openDeviceTree(page);
    await openDeviceTags(page, 'TankControl');
    await setTagValue(page, 'TankLevel', 0);
  }
}

export async function checkValveLabels(page: Page) {
  await page.locator('[title="Мнемосхемы"]').click();
  const editor = await openMnemonicEditor(page, 'Бак');
  try {
    const switches = editor.locator('#my_svg g[desc="КнопкаВклВыкл"]');
    await expect(switches).toHaveCount(2);
    let changed = false;
    for (const [index, label] of ['Клапан подачи', 'Клапан слива'].entries()) {
      const texts = editor.locator('#my_svg text');
      if (await texts.filter({ hasText: label }).count()) continue;
      const box = await switches.nth(index).boundingBox();
      if (!box) throw new Error(`Valve ${index + 1} is not visible in the editor`);
      const before = await texts.evaluateAll(nodes => nodes.map(node => node.id));
      await editor.locator('[title="Текст"]').click();
      await editor.mouse.click(box.x + 4, box.y - 6);
      await expect(texts).toHaveCount(before.length + 1);
      const id = (await texts.evaluateAll(nodes => nodes.map(node => node.id))).find(value => !before.includes(value));
      if (!id) throw new Error(`New text for ${label} has no ID`);
      const properties = editor.locator('#table_option');
      await properties.locator('input[num_elem="14"]').fill(label);
      await properties.locator('input[num_elem="14"]').press('Tab');
      await properties.locator('input[num_elem="16"]').fill('18');
      await properties.locator('input[num_elem="16"]').press('Tab');
      await expect(editor.locator(`#${id}`)).toHaveText(label);
      changed = true;
    }
    if (changed) await saveMnemonicEditor(editor);
    await editor.reload();
    for (const [index, label] of ['Клапан подачи', 'Клапан слива'].entries()) {
      const text = editor.locator('#my_svg text').filter({ hasText: label });
      await expect(text).toHaveCount(1);
      const textBox = await text.boundingBox();
      const switchBox = await switches.nth(index).boundingBox();
      if (!textBox || !switchBox) throw new Error(`${label} or its switch is not visible`);
      expect(textBox.y + textBox.height).toBeLessThanOrEqual(switchBox.y + 5);
      expect(textBox.x).toBeGreaterThanOrEqual(switchBox.x - 10);
      expect(textBox.x).toBeLessThan(switchBox.x + switchBox.width);
    }
  } finally {
    await editor.close();
  }

  await page.locator('#menu_main').getByText('Бак', { exact: true }).click();
  for (const label of ['Клапан подачи', 'Клапан слива']) {
    await expect(page.locator('#main > svg#my_svg text').filter({ hasText: label })).toBeVisible();
  }
}
