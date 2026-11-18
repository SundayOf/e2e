import { expect, test } from './helpers/test';
import {
  deleteVirtualDeviceIfPresent, ensureProject, ensureVirtualDevice, ensureVirtualTag,
  openDeviceTags, openDeviceTree, openProject, projectName, setTagValue, signIn, signOut,
} from './helpers/scada';

test('Сохранение логического и числового значений после входа', { tag: ['@tags', '@tag03', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(120_000);
  const device = 'Проверка значений тегов';
  const booleanValue = page.locator('#table_option tr').filter({ hasText: 'Флаг' }).locator('td[id^="v"]');
  const floatValue = page.locator('#table_option tr').filter({ hasText: 'Измерение' }).locator('td[id^="v"]');

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    if (await page.getByRole('textbox', { name: 'Логин' }).isVisible()) {
      await signIn(page);
      await openProject(page, projectName);
    }
    if (await page.locator('#form_edit').isVisible()) await page.reload();
    if (await page.locator('#form_edit_tag').isVisible()) await page.locator('#form_edit_tag #form_cancel').click();
    await deleteVirtualDeviceIfPresent(page, device);
    await openDeviceTree(page);
    await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
  });
  await deleteVirtualDeviceIfPresent(page, device);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  await ensureVirtualTag(page, { id: 2, name: 'Флаг', type: 'Boolean' });
  await ensureVirtualTag(page, { id: 3, name: 'Измерение', type: 'Float' });
  await expect(booleanValue).toHaveText('False');
  await expect(floatValue).toHaveText('0');

  for (const [flag, measurement] of [[false, -2], [true, 0], [false, 1.25]] as const) {
    await test.step(`Записать ${flag} и ${measurement}, затем войти заново`, async () => {
      await setTagValue(page, 'Флаг', flag);
      await setTagValue(page, 'Измерение', measurement);
      await signOut(page);
      await signIn(page);
      await openProject(page, projectName);
      await openDeviceTree(page);
      await openDeviceTags(page, device);
      await expect(booleanValue).toHaveText(flag ? 'True' : 'False');
      await expect.poll(async () => {
        const text = (await floatValue.innerText()).trim();
        return text ? Number(text) : NaN;
      }).toBe(measurement);
    });
  }
});

test('Фильтрация и сортировка тегов', { tag: ['@tags', '@tag06', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(90_000);
  const device = 'Фильтрация тегов';
  const tags = [
    { id: 2, name: 'Zulu контроль', type: 'Float', value: 9 },
    { id: 7, name: 'Alpha датчик', type: 'Float', value: 1.25 },
    { id: 5, name: 'Alpine флаг', type: 'Boolean', value: false },
  ] as const;
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    if (await page.locator('#form_edit').isVisible()) await page.locator('#form_edit .btn_cancel').click();
    if (await page.locator('#form_edit_tag').isVisible()) await page.locator('#form_edit_tag #form_cancel').click();
    await deleteVirtualDeviceIfPresent(page, device);
    await openDeviceTree(page);
    await expect(page.locator('.devices_tree_title').filter({ hasText: new RegExp(`^${device}$`) })).toHaveCount(0);
  });
  await deleteVirtualDeviceIfPresent(page, device);
  await openDeviceTree(page);
  await ensureVirtualDevice(page, device);
  await openDeviceTags(page, device);
  const ownIds: string[] = [];
  for (const tag of tags) {
    const row = await ensureVirtualTag(page, tag);
    const id = await row.getAttribute('rec_id');
    expect(id).toBeTruthy();
    ownIds.push(id!);
    await expect(row.locator('td[id^="v"]')).toHaveText(tag.type === 'Boolean' ? 'False' : '0');
    await setTagValue(page, tag.name, tag.value);
  }
  const allRows = page.locator('#table_option tr[rec_id]');
  const ids = await allRows.evaluateAll(rows => rows.map(r => r.getAttribute('rec_id')).sort());
  await expect(allRows).toHaveCount(4);
  // Фильтруем после нового открытия: добавленные строки могут ещё не иметь ffvo.
  await openDeviceTree(page);
  await openDeviceTags(page, device);
  const visibleRows = page.locator('#table_option tr[rec_id]:visible');
  const visibleNames = () => visibleRows.evaluateAll(rows => rows.map(r => r.children[2].textContent?.trim()));
  const expectShown = async (names: string[]) => {
    await expect.poll(async () => (await visibleNames()).sort()).toEqual(['StatusDevice', ...names].sort());
    await expect(visibleRows.first().locator('td').nth(2)).toHaveText('StatusDevice');
  };
  const allNames = tags.map(t => t.name);
  const reset = async () => {
    for (const id of ['#filter_name', '#filter_adress']) {
      await page.locator(id).fill('');
      await page.locator(id).press('Enter');
    }
    for (const id of ['#filter_type_signal', '#filter_format_value', '#filter_format_value_out']) {
      await page.locator(id).selectOption('0');
    }
    await expectShown(allNames);
  };
  await expectShown(allNames);

  await test.step('Найти тег по части имени и номеру', async () => {
    await page.locator('#filter_name').fill('ALP');
    await page.locator('#filter_name').press('Enter');
    await expectShown(['Alpha датчик', 'Alpine флаг']);
    await page.locator('#filter_adress').fill('5');
    await page.locator('#filter_adress').press('Enter');
    await expectShown(['Alpine флаг']);
    await reset();
  });
  await test.step('Совместить фильтры устройства, чтения и вывода', async () => {
    await page.locator('#filter_type_signal').selectOption('5');
    await expectShown(allNames);
    await page.locator('#filter_format_value').selectOption('1');
    await expectShown(['Alpine флаг']);
    await page.locator('#filter_format_value_out').selectOption('3');
    await expectShown([]);
    await page.locator('#filter_format_value_out').selectOption('1');
    await expectShown(['Alpine флаг']);
    await page.locator('#filter_format_value').selectOption('3');
    await expectShown([]);
    await page.locator('#filter_format_value_out').selectOption('0');
    await expectShown(['Alpha датчик', 'Zulu контроль']);
    await reset();
    await page.locator('#filter_name').fill('Нет совпадений');
    await page.locator('#filter_name').press('Enter');
    await expectShown([]);
    await reset();
  });
  await test.step('Отсортировать по имени и адресу, проверить значения', async () => {
    const sortBy = async (field: string) => {
      const header = page.locator(`#table_option th.header_filter.sort:has(${field})`);
      // Input имени останавливает click; нажимаем доступную границу th реальным кликом.
      const position = await header.evaluate(el => {
        const r = el.getBoundingClientRect();
        for (const point of [{ x: 1, y: 1 }, { x: r.width - 1, y: 1 }, { x: 1, y: r.height - 1 }, { x: r.width - 1, y: r.height - 1 }]) {
          if (document.elementFromPoint(r.x + point.x, r.y + point.y) === el) {
            // click считает position от padding-box, а hit test — от внешней границы.
            return { x: point.x - el.clientLeft, y: point.y - el.clientTop };
          }
        }
        throw new Error('Не найдена доступная граница заголовка сортировки');
      });
      await header.click({ position, timeout: 10_000 });
    };
    await sortBy('#filter_name');
    await expect.poll(visibleNames).toEqual(['StatusDevice', 'Alpha датчик', 'Alpine флаг', 'Zulu контроль']);
    await sortBy('#filter_adress');
    await expect.poll(visibleNames).toEqual(['StatusDevice', 'Zulu контроль', 'Alpine флаг', 'Alpha датчик']);
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expectShown(allNames);
    expect(await allRows.evaluateAll(rows => rows.map(r => r.getAttribute('rec_id')).sort())).toEqual(ids);
    for (const [index, tag] of tags.entries()) {
      const row = page.locator(`#table_option tr[rec_id="${ownIds[index]}"]`);
      await expect(row.locator('td').nth(2)).toHaveText(tag.name);
      await expect(row.locator('td').nth(1)).toHaveText(String(tag.id));
      await expect(row.locator('td[id^="v"]')).toHaveText(String(tag.value === false ? 'False' : tag.value));
    }
  });
});

test.describe('Формат отображения тегов', () => {
  test.use({ timezoneId: 'UTC' });

  test('Формат чисел и дат без изменения значений', { tag: ['@tags', '@tag05', '@base'] }, async ({ page, onCleanup }) => {
    test.setTimeout(120_000);
    const device = 'Формат значений тегов';
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
    const pressure = await ensureVirtualTag(page, { id: 2, name: 'Давление', type: 'Float' });
    const pressureId = await pressure.getAttribute('rec_id');
    const time = await ensureVirtualTag(page, { id: 3, name: 'Момент', type: 'Float' });
    const timeId = await time.getAttribute('rec_id');
    expect(pressureId).toBeTruthy();
    expect(timeId).toBeTruthy();
    const pressureRow = page.locator(`#table_option tr[rec_id="${pressureId}"]`);
    const timeRow = page.locator(`#table_option tr[rec_id="${timeId}"]`);
    const pressureValue = pressureRow.locator('td[id^="v"]');
    const timeValue = timeRow.locator('td[id^="v"]');
    await expect(pressureValue).toHaveText('0');
    await expect(timeValue).toHaveText('0');
    await setTagValue(page, 'Давление', 9.876);
    await setTagValue(page, 'Момент', 1704164645000);

    const configure = async (id: string, output: 'Float' | 'DateTime', mask: string, unit: string) => {
      const row = page.locator(`#table_option tr[rec_id="${id}"]`);
      await row.locator('td.edit').click();
      await expect(form).toBeVisible();
      await expect(form.locator('#format_value option:checked')).toHaveText('Float');
      await form.locator('#format_value_out').selectOption({ label: output });
      await form.locator('#format_value_out_str').fill(mask);
      await form.locator('#unit').fill(unit);
      const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/save_tag/${id}/`, { timeout: 10_000 });
      await form.locator('#form_ok').click();
      expect((await (await saved).json()).error).toBeFalsy();
      await expect(form).toBeHidden();
      await openDeviceTree(page);
      await openDeviceTags(page, device);
      await expect(row).toHaveCount(1);
      await expect(row.locator('td').nth(9)).toHaveText(unit);
      await row.locator('td.edit').click();
      await expect(form).toBeVisible();
      await expect(form.locator('#format_value option:checked')).toHaveText('Float');
      await expect(form.locator('#format_value_out option:checked')).toHaveText(output);
      await expect(form.locator('#format_value_out_str')).toHaveValue(mask);
      await expect(form.locator('#unit')).toHaveValue(unit);
      await form.locator('#form_cancel').click();
    };

    await test.step('Сохранить форматы и единицы измерения', async () => {
      await configure(pressureId!, 'Float', '#.##', 'bar');
      await expect(pressureValue).toHaveText('9.88');
      await configure(timeId!, 'DateTime', 'DD.MM.YYYY HH:MM:SS', 'ms');
      await expect(pressureValue).toHaveText('9.88');
      await expect(timeValue).toHaveAttribute('title', '02.01.2024 03:04:05');
    });
    await test.step('Изменить точность без перезаписи числа', async () => {
      await configure(pressureId!, 'Float', '#.###', 'bar');
      await expect(pressureValue).toHaveText('9.876');
      await expect(timeValue).toHaveAttribute('title', '02.01.2024 03:04:05');
      await configure(pressureId!, 'Float', '#.##', 'bar');
      await expect(pressureValue).toHaveText('9.88');
      await pressureValue.click();
      await page.locator('#form_edit #value_tag').fill('-2.346');
      const written = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/set_value_tag/${pressureId}/`, { timeout: 10_000 });
      await page.locator('#form_edit #btn_set_form_value_tag').click();
      expect((await written).ok()).toBe(true);
      await expect(page.locator('#form_edit')).toHaveCount(0);
      await expect(pressureValue).toHaveText('-2.35');
      await configure(pressureId!, 'Float', '#.###', 'bar');
      await expect(pressureValue).toHaveText('-2.346');
      await setTagValue(page, 'Давление', 0);
      await configure(pressureId!, 'Float', '#.0', 'bar');
      await expect(pressureValue).toHaveText('0.0');
      await expect(timeValue).toHaveAttribute('title', '02.01.2024 03:04:05');
    });
    await test.step('Изменить формат времени и даты без перезаписи', async () => {
      await configure(timeId!, 'Float', '', 'ms');
      await expect(timeValue).toHaveText('1704164645000');
      await configure(timeId!, 'DateTime', 'DD.MM.YY', 'ms');
      await expect(timeValue).toHaveText('02.01.24');
      await expect(pressureValue).toHaveText('0.0');
      await expect(pressureRow.locator('td').nth(9)).toHaveText('bar');
    });
  });
});

test('Изменение типа и значения по умолчанию у тега', { tag: ['@tags', '@tag02', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(90_000);
  const device = 'Настройка типа тега';
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
  const created = await ensureVirtualTag(page, { id: 2, name: 'Параметр', type: 'Float' });
  const id = await created.getAttribute('rec_id');
  expect(id).toBeTruthy();
  const createdControl = await ensureVirtualTag(page, { id: 3, name: 'Контроль', type: 'Float' });
  const controlId = await createdControl.getAttribute('rec_id');
  expect(controlId).toBeTruthy();
  const row = page.locator(`#table_option tr[rec_id="${id}"]`);
  const value = row.locator('td[id^="v"]');
  const control = page.locator(`#table_option tr[rec_id="${controlId}"]`);
  await expect(value).toHaveText('0');
  await expect(control.locator('td[id^="v"]')).toHaveText('0');
  await setTagValue(page, 'Контроль', 9);
  await setTagValue(page, 'Параметр', 9.75);

  const changeAndRead = async (type: 'Float' | 'Boolean', defaultValue: string, unit: string, expected: string) => {
    await row.locator('td.edit').click();
    await expect(form).toBeVisible();
    await form.locator('#format_value').selectOption({ label: type });
    await form.locator('#format_value_out').selectOption({ label: type });
    await form.locator('#default_value').fill(defaultValue);
    await form.locator('#unit').fill(unit);
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/save_tag/${id}/`, { timeout: 10_000 });
    await form.locator('#form_ok').click();
    expect((await (await saved).json()).error).toBeFalsy();
    await expect(form).toBeHidden();
    await openDeviceTree(page);
    await openDeviceTags(page, device);
    await expect(row).toHaveCount(1);
    await expect(row.locator('td').nth(2)).toHaveText('Параметр');
    await expect(row.locator('td').nth(9)).toHaveText(unit);
    await expect(value).toHaveText(expected);
    await expect(control.locator('td').nth(2)).toHaveText('Контроль');
    await expect(control.locator('td[id^="v"]')).toHaveText('9');
    await row.locator('td.edit').click();
    await expect(form).toBeVisible();
    await expect(form.locator('#format_value option:checked')).toHaveText(type);
    await expect(form.locator('#format_value_out option:checked')).toHaveText(type);
    await expect(form.locator('#default_value')).toHaveValue(defaultValue);
    await expect(form.locator('#unit')).toHaveValue(unit);
    await form.locator('#form_cancel').click();
  };

  await test.step('Изменить единицу и значение по умолчанию', async () => {
    await changeAndRead('Float', '-4.5', 'bar', '9.75');
  });
  await test.step('Выбрать логический тип и записать «Ложь»', async () => {
    await changeAndRead('Boolean', '0', 'state', 'True');
    await setTagValue(page, 'Параметр', false);
    await expect(control.locator('td[id^="v"]')).toHaveText('9');
  });
  await test.step('Вернуть числовой тип, записать дробь и ноль', async () => {
    await changeAndRead('Float', '7.25', 'kPa', '0');
    for (const next of [-2.5, 0]) {
      await setTagValue(page, 'Параметр', next);
      await expect(control.locator('td[id^="v"]')).toHaveText('9');
    }
  });
});
