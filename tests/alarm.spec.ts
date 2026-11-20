import { expect, test } from './helpers/test';
import { testIdentity } from './helpers/bootstrap-data';
import {
  projectName, ensureAlarmThreshold, ensureProject, ensureTagAlarm, expectNewAlarmEvent,
  openProject, openTagAlarms, setTagValue, signInAsAdmin, signIn, signOut,
} from './helpers/scada';
import { acknowledgeAlarm, alarmEventIds, alarmName, alarmTag, cleanupAlarmTag, prepareAlarmTag, prepareThresholdAlarm } from './helpers/alarm';
import { getAlarmPanelVisibility, setAlarmPanelVisibility } from './helpers/access';

test('Снятие аварии с учётом гистерезиса', { tag: ['@alarm', '@f05', '@base'] }, async ({ page, onCleanup }) => {
  test.setTimeout(90_000);
  await signIn(page);
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

  const row = page.locator('#table_edit_alarms tr').filter({ hasText: alarmName });
  const clearCell = row.locator("td.alarm[onclick=\"os.alarms.edit_if(this,'out');\"]");
  const loaded = page.waitForResponse(response => response.url().includes('/edit_if_alarm/') && response.ok());
  await clearCell.click();
  await loaded;
  const form = page.locator('#form_edit_if_alarm');
  const condition = form.locator('.fields .div_tr');
  await expect(condition).toHaveCount(0);
  await form.locator('.buttons .btn_add').filter({ hasText: 'Добавить' }).click();
  await condition.locator('select').selectOption('less');
  await condition.locator('input').fill('90');
  const saved = page.waitForResponse(response => response.url().includes('/save_if_alarm/') && response.ok());
  await form.locator('#form_ok').click();
  await saved;
  await expect(clearCell).toContainText('v<90');
  await page.locator('#form_edit_alarms_from_tag #form_cancel').click();

  const seen = await page.locator('#table_events tr[event_id]').evaluateAll(rows =>
    rows.map(row => row.getAttribute('event_id') || ''));
  const active = page.locator('#table_alarms tr[status="1"]').filter({ hasText: alarmName });
  await setTagValue(page, alarmTag, 101);
  await expect(active).toBeVisible();
  await expectNewAlarmEvent(page, seen, alarmName, 'Сработала авария. v=101', 'ev_alert');
  for (const value of [100, 90]) {
    await setTagValue(page, alarmTag, value);
    await expect(active).toBeVisible();
  }
  await setTagValue(page, alarmTag, 89);
  await expect(active).toHaveCount(0);
  await expectNewAlarmEvent(page, seen, alarmName, 'Авария устранена. v=89', 'ev_check');
  await setTagValue(page, alarmTag, 100);
  await expect(active).toHaveCount(0);
});

test.describe('Подтверждение аварий', () => {
  test.beforeEach(async ({ page }, info) => {
    await (info.tags.includes('@mixed') ? signInAsAdmin : signIn)(page);
    await ensureProject(page, projectName);
    await openProject(page, projectName);
  });

  test('Запрет подтверждения аварии без права', { tag: ['@alarm', '@access', '@alm11', '@mixed', '@permissions'] }, async ({ page, onCleanup }) => {
    test.setTimeout(90_000);
    let role: 'admin' | 'operator' | 'none' = 'admin';
    let originalPanel: boolean | undefined;
    onCleanup(async () => {
      if (role === 'operator') {
        await signOut(page);
        role = 'none';
      }
      if (role === 'none') await signInAsAdmin(page);
      try {
        await openProject(page, projectName);
        await cleanupAlarmTag(page);
      } finally {
        if (originalPanel !== undefined) await setAlarmPanelVisibility(page, originalPanel);
      }
    });
    const row = await prepareThresholdAlarm(page);
    await openTagAlarms(page, alarmTag);
    const config = page.locator('#table_edit_alarms tr').filter({ hasText: alarmName });
    await config.locator('td.user').click();
    const users = page.locator('#form_edit_accept_on_users');
    await expect(users.locator(`tr[id="${await testIdentity(page, 'user')}"]`).locator('td').first()).toHaveClass(/\buncheck\b/);
    await users.locator('#form_cancel').click();
    await config.locator('td.group').click();
    const groups = page.locator('#form_edit_accept_on_groups');
    await expect(groups.locator(`tr[id="${await testIdentity(page, 'group')}"]`).locator('td').first()).toHaveClass(/\buncheck\b/);
    await groups.locator('#form_cancel').click();
    await page.locator('#form_edit_alarms_from_tag #form_cancel').click();
    await setTagValue(page, alarmTag, 101);
    await expect(row).toHaveAttribute('status', '1');
    const id = await row.getAttribute('id');
    expect(id).toBeTruthy();
    originalPanel = await getAlarmPanelVisibility(page);
    await setAlarmPanelVisibility(page, true);
    await signOut(page);
    role = 'none';
    await signIn(page);
    role = 'operator';
    await openProject(page, projectName);
    await expect(row).toHaveAttribute('status', '1');
    await expect(row).toBeVisible();
    const rejected = page.waitForResponse(r => new URL(r.url()).pathname === `/check_alarm/${id}/`, { timeout: 10_000 });
    await row.locator('td.check_alarm').click();
    const denial = await rejected;
    expect([200, 403]).toContain(denial.status());
    const projectId = new URL(page.url()).searchParams.get('project_id');
    expect(projectId).toBeTruthy();
    const direct = await page.request.get(`/check_alarm/${id}/?project_id=${projectId}`, { maxRedirects: 0 });
    expect([200, 403]).toContain(direct.status());
    await test.info().attach('Ответ подтверждения без ACL', {
      body: JSON.stringify({ uiStatus: denial.status(), directStatus: direct.status() }), contentType: 'application/json',
    });
    await expect(row).toHaveAttribute('status', '1');
    await signOut(page);
    role = 'none';
    await signInAsAdmin(page);
    role = 'admin';
    await openProject(page, projectName);
    await expect(row).toHaveAttribute('status', '1');
    await acknowledgeAlarm(page, row);
  });

  test('Подтверждение активной аварии и запись в историю', { tag: ['@alarm', '@alm04', '@base'] }, async ({ page, onCleanup }) => {
    test.setTimeout(60_000);
    onCleanup(async () => {
      await cleanupAlarmTag(page);
    });
    const row = await prepareThresholdAlarm(page);
    const seen = await alarmEventIds(page);
    await setTagValue(page, alarmTag, 101);
    await expect(row).toHaveAttribute('status', '1');
    await expectNewAlarmEvent(page, seen, alarmName, 'Сработала авария. v=101', 'ev_alert');
    const id = await row.getAttribute('id');
    const fired = page.locator(`#table_events tr[alarm_id="${id}"]`).filter({ has: page.locator('td.ev_alert') }).first();
    const eventId = await fired.getAttribute('event_id');
    expect(eventId).toBeTruthy();
    await acknowledgeAlarm(page, row);
    await expect(row.locator('td.check_alarm')).toHaveCount(0);
    await expect(page.locator('#table_option tr').filter({ hasText: alarmTag }).locator('td[id^="v"]')).toHaveText('101');
    await expect(page.locator(`#table_events tr[event_id="${eventId}"]`)).toContainText('Сработала авария. v=101');
    await setTagValue(page, alarmTag, 0);
    await expect(row).toHaveCount(0);
    await expectNewAlarmEvent(page, seen, alarmName, 'Авария устранена. v=0', 'ev_check');
  });

  test('Повторное подтверждение новой аварии', { tag: ['@alarm', '@alm05', '@base'] }, async ({ page, onCleanup }) => {
    test.setTimeout(60_000);
    onCleanup(async () => {
      await cleanupAlarmTag(page);
    });
    const row = await prepareThresholdAlarm(page);
    const firstBaseline = await alarmEventIds(page);
    await setTagValue(page, alarmTag, 101);
    await expect(row).toHaveAttribute('status', '1');
    await expectNewAlarmEvent(page, firstBaseline, alarmName, 'Сработала авария. v=101', 'ev_alert');
    await acknowledgeAlarm(page, row);
    await setTagValue(page, alarmTag, 0);
    await expect(row).toHaveCount(0);
    await expectNewAlarmEvent(page, firstBaseline, alarmName, 'Авария устранена. v=0', 'ev_check');
    const secondBaseline = await alarmEventIds(page);
    await setTagValue(page, alarmTag, 101);
    await expect(row).toHaveAttribute('status', '1');
    await expect(row.locator('td.check_alarm')).toBeVisible();
    await expectNewAlarmEvent(page, secondBaseline, alarmName, 'Сработала авария. v=101', 'ev_alert');
    await acknowledgeAlarm(page, row);
  });
});
