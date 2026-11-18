import { expect, type Locator, type Page } from '@playwright/test';
import { projectName, testUser } from './scada';
import { bootstrapData, bootstrapIdentity } from './bootstrap-data';

export const testUserRow = (page: Page) => page.locator(`#table_option tr[fl="${testUser().toLowerCase()}"]`);

export async function openTestUsers(page: Page) {
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_users/' && r.ok(), { timeout: 10_000 });
  await page.locator('#panel_right [title="Пользователи"]').click();
  await (await loaded).finished();
  await expect(testUserRow(page)).toBeVisible();
}

export async function openTestUserForm(page: Page) {
  await openTestUsers(page);
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname.startsWith('/edit_user/') && r.ok(), { timeout: 10_000 });
  await testUserRow(page).locator('td.edit').click();
  await (await loaded).finished();
  const form = page.locator('#form_edit_user');
  await expect(form).toBeVisible();
  return form;
}

export async function readEditRights(form: Locator) {
  return form.locator('input[id^="enable_edit_"]').evaluateAll(inputs =>
    Object.fromEntries(inputs.map(el => [el.id, (el as HTMLInputElement).checked])) as Record<string, boolean>);
}

export async function saveTestUserForm(page: Page) {
  const form = page.locator('#form_edit_user');
  await expect(form.locator('#change_password')).not.toBeChecked();
  const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith('/save_user/') && r.ok(), { timeout: 10_000 });
  await form.locator('#form_ok').click();
  expect((await (await saved).json()).error).toBeFalsy();
  await expect(form).toBeHidden();
}

export async function restoreTestUserProfile(page: Page, original: { name: string; rights: Record<string, boolean> }) {
  const form = await openTestUserForm(page);
  const set = async (key: string, checked: boolean) => {
    const input = form.locator(`#${key}`);
    if (await input.isChecked() !== checked) await input.locator('..').locator('span').click();
    expect(await input.isChecked()).toBe(checked);
  };
  // Открываем скрытые флаги, затем снимаем мастер устройства, который блокирует дочерние флаги.
  await set('enable_edit_config', true);
  await set('enable_edit_devices', false);
  for (const [key, checked] of Object.entries(original.rights)) {
    if (key !== 'enable_edit_config' && key !== 'enable_edit_devices') await set(key, checked);
  }
  await set('enable_edit_devices', original.rights.enable_edit_devices);
  await set('enable_edit_config', original.rights.enable_edit_config);
  await form.locator('#name').fill(original.name);
  await saveTestUserForm(page);
  await openTestUserForm(page);
  await expect(form.locator('#name')).toHaveValue(original.name);
  expect(await readEditRights(form)).toEqual(original.rights);
  await form.locator('#form_cancel').click();
}

export async function openMyProfile(page: Page) {
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_my_data/', { timeout: 10_000 });
  await page.locator('#userInfo').click();
  const response = await loaded;
  expect(response.ok(), `Открытие профиля: HTTP ${response.status()}`).toBe(true);
  await response.finished();
  const form = page.locator('#form_edit_my_data');
  await expect(form).toBeVisible();
  return form;
}

export async function saveMyProfileName(page: Page, name: string) {
  const form = await openMyProfile(page);
  await expect(form.locator('#change_password')).not.toBeChecked();
  await form.locator('#name').fill(name);
  const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/save_my_data/' && r.ok(), { timeout: 10_000 });
  await form.locator('#form_ok').click();
  const response = await saved;
  expect((await response.json()).error).toBeFalsy();
  await expect(form).toBeHidden();
  await openMyProfile(page);
  await expect(form.locator('#name')).toHaveValue(name);
  await form.locator('#form_cancel').click();
  return response.request();
}

async function openTestGroup(page: Page) {
  await openTestUsers(page);
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname.startsWith('/edit_user_on_groups/') && r.ok(), { timeout: 10_000 });
  await testUserRow(page).locator('td.group').click();
  await (await loaded).finished();
  const form = page.locator('#form_edit_user_on_groups');
  const group = form.locator('tr').filter({ has: page.getByRole('cell', { name: bootstrapData.group, exact: true }) }).locator('td').first();
  await expect(group).toBeVisible();
  return { form, group };
}

export async function getTestGroup(page: Page) {
  const { form, group } = await openTestGroup(page);
  const enabled = await group.evaluate(el => el.classList.contains('check'));
  await form.locator('#form_cancel').click();
  return enabled;
}

export async function setTestGroup(page: Page, enabled: boolean) {
  const { form, group } = await openTestGroup(page);
  if (await group.evaluate(el => el.classList.contains('check')) === enabled) {
    await form.locator('#form_cancel').click();
    return;
  }
  await group.click();
  const saved = page.waitForResponse(r => new URL(r.url()).pathname.startsWith('/save_user_on_groups/') && r.ok(), { timeout: 10_000 });
  await form.locator('#form_ok').click();
  expect((await (await saved).json()).error).toBeFalsy();
  // Не перезагружаем список: G02 сравнивает результат POST с последующим GET.
  await expect(form).toBeHidden();
  await expect(testUserRow(page).locator('td.group')).toHaveText(enabled ? '1' : '');
}

async function openTagAcl(page: Page, tag: Locator, kind: 'user' | 'group') {
  const plural = kind === 'user' ? 'users' : 'groups';
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === `/edit_tag_on_${plural}/` && r.ok(), { timeout: 10_000 });
  await tag.locator(`td.${kind}`).click();
  await (await loaded).finished();
  const form = page.locator(`#form_edit_accept_on_${plural}`);
  const cell = form.locator(`tr[id="${bootstrapIdentity(kind)}"]`).locator('td').first();
  await expect(cell).toBeVisible();
  return { form, cell };
}

export async function expectTagAcl(page: Page, tag: Locator, kind: 'user' | 'group', allowed: boolean) {
  const { form, cell } = await openTagAcl(page, tag, kind);
  await expect(cell).toHaveClass(allowed ? /\bcheck\b/ : /\buncheck\b/);
  await form.locator('#form_cancel').click();
}

export async function allowTagGroupWrite(page: Page, tag: Locator) {
  const { form, cell } = await openTagAcl(page, tag, 'group');
  if (!(await cell.evaluate(el => el.classList.contains('check')))) await cell.click();
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/save_tag_on_groups/' && r.ok(), { timeout: 10_000 });
  await form.locator('#form_ok').click();
  expect((await (await saved).json()).error).toBeFalsy();
  await expectTagAcl(page, tag, 'group', true);
}

async function openAlarmPanelOption(page: Page) {
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_users/' && r.ok(), { timeout: 10_000 });
  await page.locator('#panel_right [title="Пользователи"]').click();
  await loaded;
  const open = async () => {
    const response = page.waitForResponse(r => new URL(r.url()).pathname.startsWith('/edit_option_projects/') && r.ok(), { timeout: 10_000 });
    await testUserRow(page).locator('td.option').click();
    await (await response).finished();
  };
  await open();
  const form = page.locator('#form_edit_option_projects');
  await expect(form).toBeVisible();
  const project = form.locator('#table_option_projects tr').filter({ has: page.getByRole('cell', { name: projectName, exact: true }) });
  const cell = project.locator('td, th').nth(2);
  return { form, cell, open };
}

export async function getAlarmPanelVisibility(page: Page) {
  const { form, cell } = await openAlarmPanelOption(page);
  const value = await cell.evaluate(el => el.classList.contains('check'));
  await form.locator('#form_cancel').click();
  return value;
}

export async function setAlarmPanelVisibility(page: Page, enabled: boolean) {
  const { form, cell, open } = await openAlarmPanelOption(page);
  const original = await cell.evaluate(el => el.classList.contains('check'));
  const decoratedCheck = await cell.getAttribute('class') === 'check tbl';
  if (original === enabled) {
    await form.locator('#form_cancel').click();
    return original;
  }
  await cell.click();
  // UI сравнивает className с "check": сохранённый "check tbl" требует второго клика для снятия.
  if (!enabled && decoratedCheck) {
    await expect(cell).toHaveClass('check');
    await cell.click();
  }
  if (enabled) await expect(cell).toHaveClass(/\bcheck\b/);
  else await expect(cell).not.toHaveClass(/\bcheck\b/);
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/save_option_projects/' && r.ok(), { timeout: 10_000 });
  await form.locator('#form_ok').click();
  const result = await saved;
  expect((await result.json()).error).toBeFalsy();
  await expect(form).toBeHidden();
  await open();
  if (enabled) await expect(cell).toHaveClass(/\bcheck\b/);
  else await expect(cell).not.toHaveClass(/\bcheck\b/);
  await form.locator('#form_cancel').click();
  return original;
}
