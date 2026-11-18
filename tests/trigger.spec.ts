import { expect, test } from './helpers/test';
import { ensureProject, expectTagValueUnchanged, openProject, setTagValue, signIn, projectName } from './helpers/scada';
import { openViewList, viewRow } from './helpers/view';
import { cleanupTrigger, editTriggerThreshold, openTriggerTags, prepareTrigger } from './helpers/trigger';

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
});

test('Изменение порога триггера', { tag: ['@trigger', '@trg02', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const device = 'Датчик порога', name = 'Порог уровня';
  onCleanup(async () => {
    await cleanupTrigger(page, device, name);
  });
  await prepareTrigger(page, device, name);
  let dest = await openTriggerTags(page, device);
  await setTagValue(page, 'Source', 1);
  await expect(dest).toHaveText('1');
  await setTagValue(page, 'Source', 0);
  await setTagValue(page, 'Dest', 0);
  await openViewList(page, 'Триггеры');
  await editTriggerThreshold(page, name, '10');
  await openViewList(page, 'Триггеры');
  await expect(viewRow(page, name).locator('td.alarm')).toContainText('v>10');
  dest = await openTriggerTags(page, device);
  await expectTagValueUnchanged(dest, '0', () => setTagValue(page, 'Source', 1));
  await setTagValue(page, 'Source', 11);
  await expect(dest).toHaveText('1');
});

test('Отсутствие повторной записи при активном триггере', { tag: ['@trigger', '@trg03', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const device = 'Датчик перехода', name = 'Переход уровня';
  onCleanup(async () => {
    await cleanupTrigger(page, device, name);
  });
  await prepareTrigger(page, device, name);
  const dest = await openTriggerTags(page, device);
  await setTagValue(page, 'Source', 1);
  await expect(dest).toHaveText('1');
  await setTagValue(page, 'Dest', 0);
  await expectTagValueUnchanged(dest, '0', () => setTagValue(page, 'Source', 2));
});

test('Повторная запись при новом срабатывании триггера', { tag: ['@trigger', '@trg04', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(60_000);
  const device = 'Датчик возврата', name = 'Повтор уровня';
  onCleanup(async () => {
    await cleanupTrigger(page, device, name);
  });
  await prepareTrigger(page, device, name);
  const dest = await openTriggerTags(page, device);
  await setTagValue(page, 'Source', 1);
  await expect(dest).toHaveText('1');
  await setTagValue(page, 'Dest', 0);
  await expectTagValueUnchanged(dest, '0', () => setTagValue(page, 'Source', 0));
  await setTagValue(page, 'Source', 1);
  await expect(dest).toHaveText('1');
});
