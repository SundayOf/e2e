import { requireOwned, saveOwned } from './helpers/owned';
import { expect, test } from './helpers/test';
import {
  chooseTag, deleteVirtualDeviceIfPresent, ensureProject, ensureVirtualDevice, ensureVirtualTag,
  openDeviceTags, openDeviceTree, openProject, projectName, setTagValue, signIn,
} from './helpers/scada';
import { deleteViewRow, openViewList, viewRow } from './helpers/view';

test('Запись значения по расписанию', { tag: ['@jobs', '@f06', '@scenario'] }, async ({ page, onCleanup }) => {
  test.setTimeout(210_000);
  const deviceName = 'Плановый уровень';
  const tagName = 'Уровень';
  const plannerName = 'Установить уровень';
  const form = page.locator('#form_edit_planner');
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);

  onCleanup(async () => {
    if (await page.locator('#form_edit_formula').isVisible()) await page.locator('#form_edit_formula .btn.cancel').click();
    if (await form.isVisible()) await form.locator('#form_cancel').click();
    try {
      await openViewList(page, 'Планировщики');
      const row = viewRow(page, plannerName);
      if (await row.count()) {
        await requireOwned(page, row);
        await row.locator('td.edit').click();
        await form.locator('#enabled').locator('..').locator('span').click();
        await expect(form.locator('#enabled')).not.toBeChecked();
        await form.locator('#form_ok').click();
        await deleteViewRow(page, plannerName, 'Удалить планировщик(и)?');
      }
    } finally {
      await deleteVirtualDeviceIfPresent(page, deviceName);
    }
  });
  await openViewList(page, 'Планировщики');
  if (await viewRow(page, plannerName).count()) await deleteViewRow(page, plannerName, 'Удалить планировщик(и)?');
  await deleteVirtualDeviceIfPresent(page, deviceName);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, deviceName);
  await openDeviceTags(page, deviceName);
  await ensureVirtualTag(page, { id: 2, name: tagName, type: 'Float' });
  await setTagValue(page, tagName, 0);

  await openViewList(page, 'Планировщики');
  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
  await expect(form).toBeVisible();
  await form.locator('#name').fill(plannerName);
  await chooseTag(page, form.locator('#select_tag_tree_value').locator('..'), deviceName, tagName);
  const valuePicker = form.locator('#formula_out').locator('..');
  const box = await valuePicker.boundingBox();
  if (!box) throw new Error('Поле значения планировщика не видно');
  await valuePicker.click({ position: { x: box.width - 6, y: box.height / 2 } });
  const formula = page.locator('#form_edit_formula');
  await expect(formula).toBeVisible();
  await formula.locator('.CodeMirror').click();
  await page.keyboard.insertText('7');
  await formula.locator('#btn_set_formula_tag').click();
  await expect(form.locator('#formula_out')).toHaveValue('7');

  // shortcut: runner and SCADA share a timezone; use server time for remote runners.
  const scheduled = new Date(Date.now() + 120_000);
  await form.locator('#p_year').selectOption(String(scheduled.getFullYear()));
  await form.locator('#p_month').selectOption(String(scheduled.getMonth() + 1));
  await form.locator('#p_day').selectOption(String(scheduled.getDate()));
  await form.locator('#p_hour').selectOption(String(scheduled.getHours()));
  await form.locator('#p_min').selectOption(String(scheduled.getMinutes()));
  const weekday = form.locator(`#dw${(scheduled.getDay() + 6) % 7}`);
  await weekday.locator('..').locator('span').click();
  await expect(weekday).toBeChecked();
  await saveOwned(page, '/save_planner/', 'planner_id', () => form.locator('#form_ok').click());
  await expect(viewRow(page, plannerName)).toBeVisible();

  await openDeviceTree(page);
  await openDeviceTags(page, deviceName);
  const value = page.locator('#table_option tr').filter({ hasText: tagName }).locator('td[id^="v"]');
  await expect(value).toHaveText('7', { timeout: 150_000 });
});
