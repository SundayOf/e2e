import { expect, test } from './helpers/test';
import {
  projectName, ensureAlarmThreshold, ensureProject, ensureTagAlarm,
  expectNewAlarmEvent, openProject, openTagAlarms, setTagValue, signInAsTest,
} from './helpers/scada';
import { alarmName, alarmTag, cleanupAlarmTag, prepareAlarmTag } from './helpers/alarm';

test('Снятие аварии при возврате к порогу', { tag: ['@alarm', '@admin', '@base'] }, async ({ page, onCleanup }) => {
  await signInAsTest(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  onCleanup(async () => {
    await cleanupAlarmTag(page);
  });
  await prepareAlarmTag(page);
  await setTagValue(page, alarmTag, 0);
  await openTagAlarms(page, alarmTag);
  await ensureTagAlarm(page, alarmName);
  await ensureAlarmThreshold(page, alarmName, 'more', '100');
  await page.locator('#form_edit_alarms_from_tag #form_cancel').click();

  const seen = await page.locator('#table_events tr[event_id]').evaluateAll(rows =>
    rows.map(row => row.getAttribute('event_id') || ''));
  const active = page.locator('#table_alarms tr[status="1"]').filter({ hasText: alarmName });
  await setTagValue(page, alarmTag, 101);
  await expect(active).toBeVisible();
  await expectNewAlarmEvent(page, seen, alarmName, 'Сработала авария. v=101', 'ev_alert');
  await setTagValue(page, alarmTag, 100);
  await expect(active).toHaveCount(0);
  await expectNewAlarmEvent(page, seen, alarmName, 'Авария устранена. v=100', 'ev_check');
});
