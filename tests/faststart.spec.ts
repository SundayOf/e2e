import { expect, test } from '@playwright/test';
import {
  projectName,
  chooseTag, ensureAlarmThreshold, ensureProject, ensureTagAlarm, expectNewAlarmEvent,
  ensureVirtualDevice, ensureVirtualTag, openDeviceTags, openDeviceTree,
  openProject, openTagAlarms, openTrendConfig, openTrendList, setTagFormula, setTagValue, signIn,
} from './helpers/scada';
import { ensureMnemonic, openMnemonicEditor, pasteLibraryGroup, saveMnemonicEditor, selectTankLevelRect } from './helpers/mnemonic';
import { ensureMenuLink } from './helpers/menu';
import { checkTankLevelGuard, checkValveLabels } from './helpers/guide-mnemonic';

test('Управление баком по руководству', { tag: ['@guide', '@mnemonic', '@f01', '@f02', '@faststart', '@scenario'] }, async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);

  await test.step('Создать устройство управления баком', async () => {
    await openDeviceTree(page);
    const device = await ensureVirtualDevice(page, 'TankControl');
    await device.click();
    await device.click({ button: 'right' });
    await page.locator('#item_edit_node_devices button').click();
    await expect(page.locator('#param_device')).toContainText('Virtual');
    await page.locator('#form_edit_device_hub #form_cancel').click();
  });


  await test.step('Создать теги уровня и подачи воды', async () => {
    await openDeviceTree(page);
    await openDeviceTags(page, 'TankControl');

    const level = await ensureVirtualTag(page, { id: 2, name: 'TankLevel', type: 'Float', trend: 5000 });
    await expect(level).toContainText('5000');
    const valve = await ensureVirtualTag(page, { id: 3, name: 'ValveIn', type: 'Boolean' });
    await expect(valve).toContainText('Boolean');
  });

  await test.step('Скопировать тег подачи для слива воды', async () => {
    const valveOut = page.locator('#table_option tr').filter({ hasText: 'ValveOut' });
    if (!(await valveOut.count())) {
      const valveIn = page.locator('#table_option tr').filter({ hasText: 'ValveIn' });
      await valveIn.locator('td').first().click();
      await page.locator('[title="Дублировать"]').click();
      const form = page.locator('#form_paste_tags');
      await form.locator('#paste_search_name_tag').fill('ValveIn');
      await form.locator('#paste_replace_name_tag').fill('ValveOut');
      await form.locator('#paste_offset_tag').fill('1');
      await form.locator('#form_ok').click();
    }

    await expect(valveOut.getByRole('cell', { name: 'ValveOut', exact: true })).toBeVisible();
    await expect(valveOut).toContainText('Boolean');
    await expect(valveOut).toContainText('4');
  });

  await test.step('Сохранить формулу уровня воды', async () => {
    const formula = '#+[TankControl//ValveIn]-[TankControl//ValveOut]';
    await setTagFormula(page, 'TankLevel', formula);
  });


  await test.step('Открыть подачу и проверить рост уровня воды', async () => {
    const level = page.locator('#table_option tr').filter({ hasText: 'TankLevel' }).locator('td[id^="v"]');
    await setTagValue(page, 'ValveIn', false);
    await setTagValue(page, 'ValveOut', false);
    await setTagValue(page, 'TankLevel', 0);
    try {
      await setTagValue(page, 'ValveIn', true);
      await expect.poll(async () => Number(await level.textContent()), { timeout: 5000 }).toBeGreaterThan(0);
    } finally {
      await setTagValue(page, 'ValveIn', false);
      await setTagValue(page, 'TankLevel', 0);
    }
  });

  await test.step('Создать аварии уровня бака', async () => {
    await openTagAlarms(page, 'TankLevel');

    for (const name of ['Низкий уровень в баке', 'Высокий уровень в баке']) {
      await ensureTagAlarm(page, name);
    }
  });

  await test.step('Задать пороги аварий бака', async () => {
    for (const [name, operator, threshold] of [
      ['Низкий уровень в баке', 'less', '0'],
      ['Высокий уровень в баке', 'more', '100'],
    ]) {
      await ensureAlarmThreshold(page, name, operator, threshold);
    }
  });


  await test.step('Аварии срабатывают и снимаются на обоих порогах', async () => {
    await page.locator('#form_edit_alarms_from_tag #form_cancel').click();
    await setTagValue(page, 'TankLevel', 0);
    try {
      for (const [name, value] of [
        ['Низкий уровень в баке', -1],
        ['Высокий уровень в баке', 101],
      ] as const) {
        const seen = await page.locator('#table_events tr[event_id]').evaluateAll(rows =>
          rows.map(row => row.getAttribute('event_id') || ''));
        await setTagValue(page, 'TankLevel', value);
        await expect(page.locator('#table_alarms tr[status="1"]').filter({ hasText: name })).toBeVisible();
        await expectNewAlarmEvent(page, seen, name, `Сработала авария. v=${value}`, 'ev_alert');
        await setTagValue(page, 'TankLevel', 0);
        await expect(page.locator('#table_alarms tr[status="1"]').filter({ hasText: name })).toHaveCount(0);
        await expectNewAlarmEvent(page, seen, name, 'Авария устранена. v=0', 'ev_check');
      }
    } finally {
      await setTagValue(page, 'TankLevel', 0);
    }
  });

  await test.step('Создать тренд уровня', async () => {
    await openTrendList(page);

    const trend = page.locator('#table_option tr').filter({ hasText: 'Уровень' });
    if (!(await trend.count())) {
      await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
      await page.locator('#form_edit_main_trend #name').fill('Уровень');
      await page.locator('#form_edit_main_trend #form_ok').click();
    }
    await expect(trend.getByRole('cell', { name: 'Уровень', exact: true })).toBeVisible();
  });

  await test.step('Добавить секцию бака в тренд', async () => {
    await openTrendConfig(page, 'Уровень');

    if (!(await page.locator('#panel_main2').getByText('Бак', { exact: true }).count())) {
      await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить секцию' }).click();
      await page.locator('#form_edit_section_trend #name').fill('Бак');
      await page.locator('#form_edit_section_trend #form_ok').click();
    }
    await expect(page.locator('#panel_main2').getByText('Бак', { exact: true })).toBeVisible();
  });

  await test.step('Добавить уровень воды в тренд', async () => {
    await openTrendConfig(page, 'Уровень');

    if (!(await page.locator('#panel_main2').getByText('TankControl//TankLevel', { exact: true }).count())) {
      await page.locator('#panel_main2').getByText('Добавить тег', { exact: true }).click();
      const form = page.locator('#form_edit_trend');
      await chooseTag(page, form.locator('.select_tag_tree'), 'TankControl', 'TankLevel');
      await expect(form.locator('#select_tag_tree_value')).toHaveValue('TankControl//TankLevel');
      await form.locator('#title').fill('Уровень бака');
      await form.locator('#width_line').fill('2');
      await form.locator('#form_ok').click();
    }
    await expect(page.locator('#panel_main2')).toContainText('TankLevel');
  });

  await test.step('Создать мнемосхему бака', async () => {
    await expect(await ensureMnemonic(page, 'Бак')).toBeVisible();
  });

  await test.step('Скопировать индикатор бака из библиотеки', async () => {
    const editor = await openMnemonicEditor(page, 'Бак');
    const indicator = editor.locator('#my_svg g[desc="Бак"]');

    if (!(await indicator.count())) {
      await pasteLibraryGroup(editor, 'Индикаторы', 'g64m27');
      await expect(indicator).toBeVisible();
      await saveMnemonicEditor(editor);
    }
    await editor.reload();
    await expect(editor.locator('#my_svg g[desc="Бак"]')).toHaveCount(1);
    await editor.close();
  });

  await test.step('Привязать индикатор к уровню воды', async () => {
    const editor = await openMnemonicEditor(page, 'Бак');
    await selectTankLevelRect(editor);
    const rule = editor.locator('#div_tree_option_tags tr[row_id="os_rule63m27"]');

    if (!(await rule.textContent())?.includes('TankControl//TankLevel')) {
      await rule.locator('td.edit').click();
      await chooseTag(editor, editor.locator('#td_select_tag_tree_value'), 'TankControl', 'TankLevel');
      await editor.locator('#edit_data_command_form .buttons #save').click();
      await saveMnemonicEditor(editor);
    }

    await editor.reload();
    await selectTankLevelRect(editor);
    await expect(editor.locator('#div_tree_option_tags tr[row_id="os_rule63m27"]')).toContainText('TankControl//TankLevel');
    await editor.close();
  });

  await test.step('Скопировать переключатели подачи и слива', async () => {
    const editor = await openMnemonicEditor(page, 'Бак');
    const switches = editor.locator('#my_svg g[desc="КнопкаВклВыкл"]');
    for (let index = await switches.count(); index < 2; index++) {
      await pasteLibraryGroup(editor, 'Кнопки,переключатели', 'g220m19');
    }
    await expect(switches).toHaveCount(2);
    await saveMnemonicEditor(editor);
    await editor.reload();
    await expect(editor.locator('#my_svg g[desc="КнопкаВклВыкл"]')).toHaveCount(2);
    await editor.close();
  });

  await test.step('Разнести переключатели на схеме', async () => {
    const editor = await openMnemonicEditor(page, 'Бак');
    const switches = editor.locator('#my_svg g[desc="КнопкаВклВыкл"]');
    const inlet = await switches.nth(0).boundingBox();
    const outlet = await switches.nth(1).boundingBox();
    if (!inlet || !outlet) throw new Error('Switch is not visible in editor');
    if (inlet.x + inlet.width > outlet.x) {
      await editor.locator('label[for="tree_elements_box_tab"]').click();
      const firstId = await switches.nth(0).getAttribute('id');
      const secondId = await switches.nth(1).getAttribute('id');
      if (!firstId || !secondId) throw new Error('Switch has no ID');
      await editor.locator(`#tree_${firstId} span`).click();
      const x = Number(await editor.locator('#table_option input[num_elem="3"]').inputValue());
      await editor.locator(`#tree_${secondId} span`).click();
      await editor.locator('#table_option input[num_elem="3"]').fill(String(x + 200));
      await editor.locator('#table_option input[num_elem="3"]').press('Tab');
      await saveMnemonicEditor(editor);
    }
    await editor.reload();
    const savedInlet = await switches.nth(0).boundingBox();
    const savedOutlet = await switches.nth(1).boundingBox();
    if (!savedInlet || !savedOutlet) throw new Error('Saved switch is not visible');
    expect(savedOutlet.x).toBeGreaterThan(savedInlet.x + savedInlet.width);
    await editor.close();
  });

  await test.step('Привязать переключатели к тегам клапанов', async () => {
    const editor = await openMnemonicEditor(page, 'Бак');
    const switches = editor.locator('#my_svg g[desc="КнопкаВклВыкл"]');
    const tagIds: string[] = [];
    await editor.locator('label[for="tree_elements_box_tab"]').click();

    for (const [index, tag] of ['ValveIn', 'ValveOut'].entries()) {
      const group = switches.nth(index);
      const id = await group.getAttribute('id');
      if (!id) throw new Error(`Switch ${index + 1} has no ID`);
      await editor.locator(`#tree_${id} span`).click();
      await editor.locator('#btn_rename_tags').click();
      const form = editor.locator('#form_rename_tags');
      await expect(form.locator('#type_select_rename_tags')).toHaveValue('2');
      let tagId = '';
      for (const placeholder of ['#тэгстатус', '#тэгуправления']) {
        const row = form.locator(`tr[fn="${placeholder}"]`);
        tagId = await chooseTag(editor, row.locator('.select_tag_tree'), 'TankControl', tag);
        await expect(row.locator('input')).toHaveValue(`TankControl//${tag}`);
      }
      tagIds.push(tagId);
      await form.locator('.buttons #save').click();
      await expect(group.locator('os_rule[os_desc_tag="#ТэгСтатус"]')).toHaveCount(4);
      for (const rule of await group.locator('os_rule[os_desc_tag="#ТэгСтатус"]').all()) {
        await expect(rule).toHaveAttribute('os_tag_id', tagId);
      }
      await expect(group.locator('[desc="Действие"]')).toHaveAttribute('os_tag_id', tagId);
    }

    await saveMnemonicEditor(editor);
    await editor.reload();
    for (const [index, tagId] of tagIds.entries()) {
      const rules = switches.nth(index).locator('os_rule[os_desc_tag="#ТэгСтатус"]');
      await expect(rules).toHaveCount(4);
      for (const rule of await rules.all()) await expect(rule).toHaveAttribute('os_tag_id', tagId);
      await expect(switches.nth(index).locator('[desc="Действие"]')).toHaveAttribute('os_tag_id', tagId);
    }
    await editor.close();
  });


  await test.step('Открыть бак из меню оператора', async () => {
    const link = await ensureMenuLink(page, 'Бак');
    await link.click();
    await expect(page.locator('#header_main > div:first-child')).toHaveText('Бак');
    await expect(page.locator('#main > svg#my_svg')).toBeVisible();
  });

  await test.step('Переключатели схемы управляют обоими клапанами', async () => {
    for (const [tag, rect, direction] of [
      ['ValveIn', '#rect235m19', 1],
      ['ValveOut', '#rect56', -1],
    ] as const) {
      const action = page.locator(`#main > svg#my_svg ${rect}`);
      const id = await action.getAttribute('os_tag_id');
      if (!id) throw new Error(`${tag} switch has no tag ID`);
      await page.waitForFunction(tagId => (window as any).os?.tags?.values?.[`tag_id_${tagId}`] === '0', id);
      try {
        const saved = page.waitForResponse(response => response.url().includes(`/set_value_tag/${id}/`) && response.ok());
        await action.click();
        await saved;
        await openDeviceTree(page);
        await openDeviceTags(page, 'TankControl');
        await expect(page.locator('#table_option tr').filter({ hasText: tag }).locator('td[id^="v"]')).toHaveText('True');
        const level = page.locator('#table_option tr').filter({ hasText: 'TankLevel' }).locator('td[id^="v"]');
        await expect.poll(async () => Number(await level.textContent()) * direction, { timeout: 5000 }).toBeGreaterThan(0);
      } finally {
        await openDeviceTree(page);
        await openDeviceTags(page, 'TankControl');
        await setTagValue(page, 'ValveIn', false);
        await setTagValue(page, 'ValveOut', false);
        await setTagValue(page, 'TankLevel', 0);
      }
      if (tag === 'ValveIn') {
        const link = await ensureMenuLink(page, 'Бак');
        await link.click();
        await expect(page.locator('#main > svg#my_svg')).toBeVisible();
      }
    }
  });

  await test.step('Открыть тренд уровня из меню оператора', async () => {
    const link = await ensureMenuLink(page, 'Уровень');
    await link.click();
    await expect(page.locator('#header_main > div:first-child')).toHaveText('Уровень');
    await expect(page.locator('#main > canvas#main_canvas')).toBeVisible();
    await expect(page.locator('#vis_legend .title_it')).toHaveText('Уровень бака');
  });

  await test.step('Ограничить заливку бака при отрицательном уровне', async () => {
    await checkTankLevelGuard(page);
  });

  await test.step('Добавить подписи клапанов на схему', async () => {
    await checkValveLabels(page);
  });

});
