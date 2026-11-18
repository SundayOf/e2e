import { expect, test } from './helpers/test';
import {
  deleteTag, deleteVirtualDeviceIfPresent, ensureProject, ensureVirtualDevice, ensureVirtualTag, expectTagValueUnchanged,
  openDeviceTags, openDeviceTree, openProject, projectName, setTagFormula, setTagValue, signIn,
} from './helpers/scada';

test('Пересчёт формулы при изменении тега', { tag: ['@tags', '@formula', '@fx02', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const device = 'Расчёт формулы';
  const result = page.locator('#table_option tr').filter({ hasText: 'Результат' }).locator('td[id^="v"]');
  let resultCreated = false;

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    if (await page.locator('#form_edit').isVisible()) await page.reload();
    if (await page.locator('#form_edit_formula').isVisible()) await page.locator('#form_edit_formula .btn.cancel').click();
    if (await page.locator('#form_edit_tag').isVisible()) await page.locator('#form_edit_tag #form_cancel').click();
    try {
      if (resultCreated) {
        await openDeviceTree(page);
        await openDeviceTags(page, device);
        await setTagFormula(page, 'Результат', '');
      }
    } finally {
      await deleteVirtualDeviceIfPresent(page, device);
      await openDeviceTree(page);
      await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
    }
  });
  await deleteVirtualDeviceIfPresent(page, device);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  await ensureVirtualTag(page, { id: 2, name: 'Вход', type: 'Float' });
  await ensureVirtualTag(page, { id: 3, name: 'Результат', type: 'Float' });
  resultCreated = true;
  await expect(page.locator('#table_option tr').filter({ hasText: 'Вход' }).locator('td[id^="v"]')).toHaveText('0');
  await expect(result).toHaveText('0');

  await test.step('Включить формулу вместо ручного значения', async () => {
    await setTagValue(page, 'Вход', 1);
    await setTagValue(page, 'Результат', 7);
    await setTagFormula(page, 'Результат', `[${device}//Вход]*2`);
    await expect(result).toHaveText('2');
  });

  for (const value of [0, 2, -2]) {
    await test.step(`Задать ${value} и получить ${value * 2}`, async () => {
      await setTagValue(page, 'Вход', value);
      await expect.poll(async () => {
        const text = (await result.innerText()).trim();
        return text ? Number(text) : NaN;
      }).toBe(value * 2);
    });
  }
});

test('Остановка расчёта после удаления формулы', { tag: ['@tags', '@formula', '@fx04', '@base'] }, async ({ page, onCleanup }, info) => {
  test.setTimeout(60_000);
  const device = 'Отключение формулы';
  const result = page.locator('#table_option tr').filter({ hasText: 'Результат' }).locator('td[id^="v"]');
  let resultCreated = false;
  let deviceId = '';
  const deviceNode = page.locator('.devices_tree_title[node_id]').filter({ hasText: new RegExp(`^${device}$`) });

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  await openDeviceTree(page);
  await expect(deviceNode, 'Существующее устройство не изменяем').toHaveCount(0);
  onCleanup(async () => {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('before-cleanup.png'), timeout: 3000 }).catch(() => {});
    if (!deviceId) return;
    await page.reload();
    await openDeviceTree(page);
    await expect(deviceNode).toHaveAttribute('node_id', deviceId);
    try {
      if (resultCreated) {
        await openDeviceTree(page);
        await openDeviceTags(page, device);
        await setTagFormula(page, 'Результат', '');
      }
    } finally {
      await deleteVirtualDeviceIfPresent(page, device);
      await openDeviceTree(page);
      await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
    }
  });
  await ensureVirtualDevice(page, device);
  deviceId = (await deviceNode.getAttribute('node_id'))!;
  expect(deviceId).toBeTruthy();
  await openDeviceTags(page, device);
  await ensureVirtualTag(page, { id: 2, name: 'Вход', type: 'Float' });
  await ensureVirtualTag(page, { id: 3, name: 'Результат', type: 'Float' });
  resultCreated = true;
  await expect(page.locator('#table_option tr').filter({ hasText: 'Вход' }).locator('td[id^="v"]')).toHaveText('0');
  await expect(result).toHaveText('0');

  await test.step('Проверить работающую формулу', async () => {
    await setTagFormula(page, 'Результат', `[${device}//Вход]*2`);
    await setTagValue(page, 'Вход', 2);
    await expect(result).toHaveText('4');
  });

  await test.step('Удалить формулу и проверить настройки', async () => {
    await setTagFormula(page, 'Результат', '');
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(result).toHaveText('4');
    await setTagValue(page, 'Результат', 7);
  });

  for (const value of [3, -3]) {
    await test.step(`Задать ${value}: результат остаётся равным 7`, async () => {
      await expectTagValueUnchanged(result, '7', () => setTagValue(page, 'Вход', value));
    });
  }
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  await expect(page.locator('#table_option tr').filter({ hasText: 'Вход' }).locator('td[id^="v"]')).toHaveText('-3');
  await expect(result).toHaveText('7');
});

test('Ошибка в формуле и её исправление', { tag: ['@tags', '@formula', '@fx05', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const device = 'Исправление формулы';
  const result = page.locator('#table_option tr').filter({ hasText: 'Результат' }).locator('td[id^="v"]');
  const control = page.locator('#table_option tr').filter({ hasText: 'Контроль' }).locator('td[id^="v"]');
  const form = page.locator('#form_edit_tag');
  const editor = page.locator('#form_edit_formula');
  let resultCreated = false;

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
    if (await page.locator('#form_edit').isVisible()) await page.reload();
    if (await editor.isVisible()) await editor.locator('.btn.cancel').click();
    if (await form.isVisible()) await form.locator('#form_cancel').click();
    try {
      if (resultCreated) {
        await openDeviceTree(page);
        await openDeviceTags(page, device);
        await setTagFormula(page, 'Результат', '');
      }
    } finally {
      await deleteVirtualDeviceIfPresent(page, device);
      await openDeviceTree(page);
      await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
    }
  });
  await deleteVirtualDeviceIfPresent(page, device);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  await ensureVirtualTag(page, { id: 2, name: 'Вход', type: 'Float' });
  await ensureVirtualTag(page, { id: 3, name: 'Результат', type: 'Float' });
  resultCreated = true;
  await ensureVirtualTag(page, { id: 4, name: 'Контроль', type: 'Float' });
  for (const name of ['Вход', 'Результат', 'Контроль']) {
    await expect(page.locator('#table_option tr').filter({ hasText: name }).locator('td[id^="v"]')).toHaveText('0');
  }
  await setTagValue(page, 'Контроль', 9);
  await setTagValue(page, 'Вход', 2);
  await setTagFormula(page, 'Результат', `[${device}//Вход]*2`);
  await expect(result).toHaveText('4');

  await test.step('Проверить ошибку незакрытой ссылки на тег', async () => {
    // shortcut: UI-05 смешивает закрытие предыдущего успеха с новой ошибкой; убрать ожидание после исправления продукта.
    await expect(page.locator('#div_msg')).toHaveCount(0);
    await result.locator('..').locator('td.edit').click();
    await expect(form).toBeVisible();
    await form.locator('#formula_out').locator('..').click({ position: { x: 315, y: 11 } });
    await expect(editor).toBeVisible();
    await editor.locator('.CodeMirror').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(`[${device}//Вход`);
    await editor.locator('#btn_set_formula_tag').click();
    await expectTagValueUnchanged(control, '9', async () => {
      const saved = page.waitForResponse(r => r.request().method() === 'POST' && /\/save_tag\/[^/]+\//.test(new URL(r.url()).pathname), { timeout: 10_000 });
      await form.locator('#form_ok').click();
      const response = await saved;
      expect(response.ok()).toBe(true);
      const body = await response.json();
      expect(body.error).toContain('Ошибка в формуле вывода');
      await test.info().attach('Ответ на сохранение незавершённой формулы', {
        body: JSON.stringify({ error: body.error ?? null, message: body.msg ?? null }),
        contentType: 'application/json',
      });
    });
    await test.info().attach('Состояние после незавершённой формулы', {
      body: JSON.stringify({ errorVisible: await page.locator('#div_msg.msg_error').isVisible(), result: await result.innerText(), control: await control.innerText() }),
      contentType: 'application/json',
    });
    const error = page.locator('#div_msg.msg_error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Ошибка в формуле вывода');
    await expect(error).toContainText('Недопустимый символ');
    await expect(form).toBeVisible();
    await expect(result).toHaveText('4');
    await error.locator('.msg_close').click();
    await form.locator('#form_cancel').click();
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(control).toHaveText('9');
    await expect(result).toHaveText('4');
    await result.locator('..').locator('td.edit').click();
    await expect(form.locator('#formula_out')).toHaveValue(`[${device}//Вход]*2`);
    await expect(form.locator('#save_from_formula')).toBeChecked();
    await test.info().attach('Сохранённые настройки после неверной формулы', {
      body: JSON.stringify({ formula: await form.locator('#formula_out').inputValue(), writeFromFormula: await form.locator('#save_from_formula').isChecked() }),
      contentType: 'application/json',
    });
    await form.locator('#form_cancel').click();
  });

  await test.step('Исправить формулу и проверить расчёт', async () => {
    await setTagFormula(page, 'Результат', `[${device}//Вход]*3`);
    await expect(result).toHaveText('6');
    await expectTagValueUnchanged(control, '9', async () => {
      await setTagValue(page, 'Вход', -2);
      await expect(result).toHaveText('-6');
    });
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(result).toHaveText('-6');
    await expect(control).toHaveText('9');
  });
});

test('Связь формулы с переименованным и удалённым тегом', { tag: ['@tags', '@formula', '@fx07', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(120_000);
  const device = 'Привязка формулы';
  const result = page.locator('#table_option tr').filter({ hasText: 'Результат' }).locator('td[id^="v"]');
  const control = page.locator('#table_option tr').filter({ hasText: 'Контроль' }).locator('td[id^="v"]');
  const form = page.locator('#form_edit_tag');
  let resultCreated = false;

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    if (await page.locator('#div_msg .msg_close').isVisible()) await page.locator('#div_msg .msg_close').click();
    if (await page.locator('#form_edit').isVisible()) await page.reload();
    if (await page.locator('#form_edit_formula').isVisible()) await page.locator('#form_edit_formula .btn.cancel').click();
    if (await form.isVisible()) await form.locator('#form_cancel').click();
    try {
      if (resultCreated) {
        await openDeviceTree(page);
        await openDeviceTags(page, device);
        await setTagFormula(page, 'Результат', '');
      }
    } finally {
      await deleteVirtualDeviceIfPresent(page, device);
      await openDeviceTree(page);
      await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
    }
  });
  await deleteVirtualDeviceIfPresent(page, device);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  const initial = await ensureVirtualTag(page, { id: 2, name: 'Вход', type: 'Float' });
  const originalId = await initial.getAttribute('rec_id');
  if (!originalId) throw new Error('У входного тега нет ID');
  const original = page.locator(`#table_option tr[rec_id="${originalId}"]`);
  await ensureVirtualTag(page, { id: 3, name: 'Результат', type: 'Float' });
  resultCreated = true;
  await ensureVirtualTag(page, { id: 4, name: 'Контроль', type: 'Float' });
  for (const name of ['Вход', 'Результат', 'Контроль']) {
    await expect(page.locator('#table_option tr').filter({ hasText: name }).locator('td[id^="v"]')).toHaveText('0');
  }
  await setTagValue(page, 'Контроль', 9);
  await setTagValue(page, 'Вход', 2);
  await setTagFormula(page, 'Результат', `[${device}//Вход]*2`);
  await expect(result).toHaveText('4');

  await test.step('Переименовать тег и проверить расчёт', async () => {
    await original.locator('td.edit').click();
    await expect(form.locator('#title')).toHaveValue('Вход');
    await form.locator('#title').fill('Источник');
    await form.locator('#form_ok').click();
    await expect(original.getByRole('cell', { name: 'Источник', exact: true })).toBeVisible();
    await setTagValue(page, 'Источник', 3);
    await expect(result).toHaveText('6');
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(original.getByRole('cell', { name: 'Источник', exact: true })).toBeVisible();
    await expect(result).toHaveText('6');
    await result.locator('..').locator('td.edit').click();
    await expect(form.locator('#formula_out')).toHaveValue(`[${device}//Источник]*2`);
    await expect(form.locator('#save_from_formula')).toBeChecked();
    await form.locator('#form_cancel').click();
  });

  const newInput = await ensureVirtualTag(page, { id: 5, name: 'Вход', type: 'Float' });
  const replacementId = await newInput.getAttribute('rec_id');
  if (!replacementId) throw new Error('У подставного тега нет ID');
  expect(replacementId).not.toBe(originalId);
  const replacement = page.locator(`#table_option tr[rec_id="${replacementId}"]`);
  await expect(replacement.locator('td[id^="v"]')).toHaveText('0');
  await test.step('Создать другой тег с прежним именем', async () => {
    await expectTagValueUnchanged(result, '6', () => setTagValue(page, 'Вход', 100));
    await setTagValue(page, 'Источник', 4);
    await expect(result).toHaveText('8');
  });

  await test.step('Удалить исходный тег: результат Null, ссылка пустая', async () => {
    await deleteTag(page, 'Источник');
    await expect(original).toHaveCount(0);
    await expect(result).toHaveText('Null');
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(original).toHaveCount(0);
    await expect(result).toHaveText('Null');
    await expect(control).toHaveText('9');
    await result.locator('..').locator('td.edit').click();
    await expect(form.locator('#formula_out')).toHaveValue('[]*2');
    await expect(form.locator('#save_from_formula')).toBeChecked();
    await form.locator('#form_cancel').click();
  });

  await test.step('Проверить, что одноимённый тег не заменил удалённый', async () => {
    await replacement.locator('td.edit').click();
    await expect(form.locator('#title')).toHaveValue('Вход');
    await form.locator('#title').fill('Источник');
    await form.locator('#form_ok').click();
    await expect(replacement.getByRole('cell', { name: 'Источник', exact: true })).toBeVisible();
    await expectTagValueUnchanged(result, 'Null', () => setTagValue(page, 'Источник', 7));
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(original).toHaveCount(0);
    await expect(replacement.locator('td[id^="v"]')).toHaveText('7');
    await expect(result).toHaveText('Null');
    await expect(control).toHaveText('9');
    await result.locator('..').locator('td.edit').click();
    await expect(form.locator('#formula_out')).toHaveValue('[]*2');
    await form.locator('#form_cancel').click();
  });
});
