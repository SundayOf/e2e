import type { Locator, Page } from '@playwright/test';
import { expect } from './test';
import { bootstrapData, administrationData as data } from './bootstrap-data';
import { requireOwned, saveOwned } from './owned';
import { openProject, signIn, signInAsAdmin, signOut, waitForIdle } from './scada';

type Kind = 'project' | 'user' | 'group';
export type AdministrationState = { ids: Record<Kind, string> };
const lists = {
  project: { title: 'Проекты', path: '/edit_projects/', name: data.project, key: 'project_id', save: '/save_project//', remove: '/delete_project/' },
  user: { title: 'Пользователи', path: '/edit_users/', name: data.login, key: 'user_id', save: '/save_user//', remove: '/delete_user/' },
  group: { title: 'Группы', path: '/edit_groups_users/', name: data.group, key: 'group_id', save: '/save_group_users//', remove: '/delete_group_users/' },
};

export function newAdministrationState(): AdministrationState {
  expect(data.project, 'Временный проект должен отличаться от подготовленного').not.toBe(bootstrapData.project);
  expect(data.group, 'Временная группа должна отличаться от подготовленной').not.toBe(bootstrapData.group);
  for (const login of [bootstrapData.admin.login, bootstrapData.login]) {
    expect(data.login.toLowerCase(), 'Временный пользователь должен отличаться от подготовленных').not.toBe(login.toLowerCase());
  }
  return { ids: { project: '', user: '', group: '' } };
}

async function list(page: Page, kind: Kind) {
  await waitForIdle(page);
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === lists[kind].path && r.ok(), { timeout: 10_000 });
  await page.locator(`#panel_right [title="${lists[kind].title}"]`).click();
  await (await loaded).finished();
  await expect(page.locator('#table_option')).toBeVisible();
  await waitForIdle(page);
}

async function add(page: Page, kind: Kind) {
  await list(page, kind);
  const occupied = kind === 'user'
    ? page.locator(`#table_option tr[fl="${data.login}"]`)
    : page.locator('#table_option').getByRole('cell', { name: lists[kind].name, exact: true });
  await expect(occupied, 'Существующий объект не изменяем').toHaveCount(0);
  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
}

async function create(page: Page, state: AdministrationState, kind: Kind, form: Locator) {
  state.ids[kind] = await saveOwned(page, lists[kind].save, lists[kind].key, () => form.locator('#form_ok').click());
  await expect(form).toBeHidden();
  await list(page, kind);
  return page.locator(`#table_option tr[rec_id="${state.ids[kind]}"]`);
}

export async function createProject(page: Page, state: AdministrationState) {
  await add(page, 'project');
  const form = page.locator('#form_edit_project');
  await form.locator('#name').fill(data.project);
  const row = await create(page, state, 'project', form);
  await expect(row.getByRole('cell', { name: data.project, exact: true })).toBeVisible();
  await openProject(page, data.project);
}

export async function createUserGroup(page: Page, state: AdministrationState) {
  await add(page, 'group');
  const form = page.locator('#form_edit_group_users');
  await form.locator('#name').fill(data.group);
  const rights = await form.locator('input[id^="enable_edit_"]').evaluateAll(nodes => nodes.map(node => node.id));
  expect(rights).toContain('enable_edit_config');
  for (const id of ['enable_edit_config', ...rights.filter(id => id !== 'enable_edit_config')]) {
    const input = form.locator(`#${id}`);
    if (!await input.isChecked()) await input.locator('..').locator('span').click();
  }
  const row = await create(page, state, 'group', form);
  await expect(row.getByRole('cell', { name: data.group, exact: true })).toBeVisible();
  await row.locator('td.edit').click();
  await expect(form.locator('#name')).toHaveValue(data.group);
  for (const id of rights) await expect(form.locator(`#${id}`)).toBeChecked();
  await form.locator('#form_cancel').click();
}

async function projectAccess(page: Page, state: AdministrationState, kind: 'user' | 'group') {
  await list(page, 'project');
  await page.locator(`#table_option tr[rec_id="${state.ids.project}"] td.${kind}`).click();
  const plural = kind === 'user' ? 'users' : 'groups';
  const form = page.locator(`#form_edit_accept_on_${plural}`);
  const cell = form.locator(`tr[id="${state.ids[kind]}"]`).locator('td').first();
  await expect(cell).toBeVisible();
  if (!await cell.evaluate(el => el.classList.contains('check'))) await cell.click();
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/save_project_on_${plural}/` && r.request().method() === 'POST');
  await form.locator('#form_ok').click();
  expect((await (await saved).json()).error).toBeFalsy();
  await list(page, 'project');
  await page.locator(`#table_option tr[rec_id="${state.ids.project}"] td.${kind}`).click();
  await expect(cell).toHaveClass(/\bcheck\b/);
  await form.locator('#form_cancel').click();
}

export async function createUser(page: Page, state: AdministrationState) {
  expect(data.password, 'Задайте PASSWORD в .env для временного пользователя').not.toBe('');
  await add(page, 'user');
  const form = page.locator('#form_edit_user');
  await form.locator('#login').fill(data.login);
  await form.locator('#name').fill(data.name);
  await form.locator('#password1').fill(data.password);
  await form.locator('#password2').fill(data.password);
  await form.locator('#def_project_id').selectOption(state.ids.project);
  const editProfile = form.locator('#enable_edit');
  if (!await editProfile.isChecked()) await editProfile.locator('..').locator('span').click();
  const row = await create(page, state, 'user', form);
  await expect(row).toHaveAttribute('fl', data.login);
  await row.locator('td.edit').click();
  await expect(form.locator('#def_project_id')).toHaveValue(state.ids.project);
  await expect(form.locator('#enable_edit')).toBeChecked();
  for (const input of await form.locator('input[id^="enable_edit_"]').all()) await expect(input).not.toBeChecked();
  await form.locator('#form_cancel').click();

  const membership = page.locator('#form_edit_user_on_groups');
  const openMembership = async () => {
    await list(page, 'user');
    await row.locator('td.group').click();
    await expect(membership).toBeVisible();
  };
  await openMembership();
  const cell = membership.locator(`tr[id="${state.ids.group}"]`).locator('td').first();
  await cell.click();
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/save_user_on_groups/${state.ids.user}/` && r.request().method() === 'POST');
  await membership.locator('#form_ok').click();
  expect((await (await saved).json()).error).toBeFalsy();
  await expect(membership).toBeHidden();
  await openMembership();
  await expect(cell).toHaveClass(/\bcheck\b/);
  await membership.locator('#form_cancel').click();
  await projectAccess(page, state, 'user');
  await projectAccess(page, state, 'group');
  await signOut(page);
  await signIn(page, data);
  await openProject(page, data.project);
  for (const title of ['Дерево проекта', 'Пользователи', 'Группы', 'Карты']) await expect(page.locator(`#panel_right [title="${title}"]`)).toBeVisible();
}

export async function cleanupAdministration(page: Page, state: AdministrationState) {
  if (!Object.values(state.ids).some(Boolean)) return;
  if (await page.locator('#my_confirm').isVisible()) await page.locator('#btn_cancel_confirm').click();
  for (const id of ['form_edit_accept_on_users', 'form_edit_accept_on_groups', 'form_edit_user_on_groups', 'form_edit_user', 'form_edit_group_users', 'form_edit_project']) {
    const form = page.locator(`#${id}`);
    if (await form.isVisible()) await form.locator('.header > .close_form').click();
  }
  await page.goto('/');
  if (await page.locator('#logout').isVisible()) await signOut(page);
  await signInAsAdmin(page);
  const errors: unknown[] = [];
  for (const kind of ['user', 'group', 'project'] as const) {
    const id = state.ids[kind];
    if (!id) continue;
    try {
      await list(page, kind);
      const row = page.locator(`#table_option tr[rec_id="${id}"]`);
      if (await row.count()) {
        await requireOwned(page, row);
        if (kind === 'project') {
          await page.goto('/');
          await list(page, kind);
          await expect(row).toHaveCount(1);
        }
        const response = await page.request.post(lists[kind].remove, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          data: JSON.stringify({ ids: [id] }),
        });
        expect(response.ok()).toBe(true);
        const result = await response.json();
        expect(result.error, `Удаление: ${lists[kind].title}`).toBeFalsy();
        expect(result.ids.map(String)).toEqual([id]);
      }
      await list(page, kind);
      await expect(row).toHaveCount(0);
      state.ids[kind] = '';
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Не удалось очистить временные объекты');
}
