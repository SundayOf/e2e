import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect } from './test';
import { bootstrapData as data, bootstrapStatePath } from './bootstrap-data';
import { ensureProject, openProject, signIn, signInAsTest, signOut } from './scada';
import { setTestGroup } from './access';

type Kind = 'project' | 'user' | 'group';
type State = { owner: string; origin: string; knownIds: string[]; ids: Record<Kind, string>; ready: boolean };
const lists = {
  project: { title: 'Проекты', path: '/edit_projects/', name: data.project, key: 'project_id', save: '/save_project//', remove: '/delete_project/' },
  user: { title: 'Пользователи', path: '/edit_users/', name: data.login, key: 'user_id', save: '/save_user//', remove: '/delete_user/' },
  group: { title: 'Группы', path: '/edit_groups_users/', name: data.group, key: 'group_id', save: '/save_group_users//', remove: '/delete_group_users/' },
};

const stateFile = bootstrapStatePath;
const saveState = (info: TestInfo, state: State) => {
  mkdirSync(dirname(stateFile()), { recursive: true });
  const json = JSON.stringify(state, null, 2);
  writeFileSync(stateFile(), json);
  writeFileSync(join((info.config.metadata.reportHistory as { runDir: string }).runDir, 'bootstrap.json'), json);
};
export function readBootstrap(info: TestInfo): State | undefined {
  if (!existsSync(stateFile())) return;
  const state: State = JSON.parse(readFileSync(stateFile(), 'utf8'));
  expect(state.owner).toBe('bootstrap-v1');
  expect(state.origin).toBe(new URL(data.baseURL).origin);
  for (const id of Object.values(state.ids)) if (id) {
    expect(id).toMatch(/^[a-f\d]{32}$/i);
    expect(state.knownIds).not.toContain(id);
  }
  return state;
}

async function list(page: Page, kind: Kind) {
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === lists[kind].path && r.ok(), { timeout: 10_000 });
  await page.locator(`#panel_right [title="${lists[kind].title}"]`).click();
  await (await loaded).finished();
  await expect(page.locator('#table_option')).toBeVisible();
  await idle(page);
}

async function idle(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { os: { vars: { keyup: { timer: number | false } } } }).os.vars.keyup.timer === false)).toBe(true);
  await expect(page.locator('#div_msg')).toBeHidden();
}

async function closeForms(page: Page) {
  if (await page.locator('#my_confirm').isVisible()) await page.locator('#btn_cancel_confirm').click();
  for (const id of ['form_edit_accept_on_users', 'form_edit_accept_on_groups', 'form_edit_user_on_groups', 'form_edit_user', 'form_edit_group_users', 'form_edit_project']) {
    const form = page.locator(`#${id}`);
    if (await form.isVisible()) await form.locator('.header > .close_form').click();
  }
}

async function create(page: Page, info: TestInfo, state: State, kind: Kind, form: Locator) {
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === lists[kind].save && r.request().method() === 'POST', { timeout: 10_000 });
  await form.locator('#form_ok').click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.error).toBeFalsy();
  const id = result[lists[kind].key];
  expect(id).toMatch(/^[a-f\d]{32}$/i);
  expect(state.knownIds).not.toContain(id);
  state.ids[kind] = id;
  saveState(info, state);
  await expect(form).toBeHidden();
}

async function projectAccess(page: Page, state: State, kind: 'user' | 'group') {
  await list(page, 'project');
  await page.locator(`#table_option tr[rec_id="${state.ids.project}"] td.${kind}`).click();
  const plural = kind === 'user' ? 'users' : 'groups';
  const form = page.locator(`#form_edit_accept_on_${plural}`);
  const row = form.locator(`#table_data_on_${plural} tr[id="${state.ids[kind]}"]`);
  const cell = row.locator('td').first();
  await expect(row).toBeVisible();
  if (!await cell.evaluate(el => el.classList.contains('check'))) await cell.click();
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === `/save_project_on_${plural}/` && r.request().method() === 'POST');
  await form.locator('#form_ok').click();
  expect((await (await saved).json()).error).toBeFalsy();
  await list(page, 'project');
  await page.locator(`#table_option tr[rec_id="${state.ids.project}"] td.${kind}`).click();
  await expect(cell).toHaveClass(/\bcheck\b/);
  await form.locator('#form_cancel').click();
}

export async function prepareBootstrap(page: Page, info: TestInfo) {
  await cleanupBootstrap(page, info);
  const state: State = { owner: 'bootstrap-v1', origin: new URL(data.baseURL).origin, knownIds: [], ids: { project: '', user: '', group: '' }, ready: false };
  saveState(info, state);
  for (const kind of ['project', 'user', 'group'] as const) {
    await list(page, kind);
    const rows = page.locator('#table_option tr[rec_id]');
    state.knownIds.push(...await rows.evaluateAll(nodes => nodes.map(node => node.getAttribute('rec_id')!)));
    if (kind === 'user') await expect(page.locator(`#table_option tr[fl="${data.login}"]`), 'Существующего пользователя не изменяем').toHaveCount(0);
    else await expect(rows.filter({ has: page.getByRole('cell', { name: lists[kind].name, exact: true }) }), 'Существующие объекты не принимаем за свои').toHaveCount(0);
  }
  saveState(info, state);
  await list(page, 'project');
  const createdProject = page.waitForResponse(r => new URL(r.url()).pathname === lists.project.save && r.request().method() === 'POST');
  await ensureProject(page, data.project);
  const projectResponse = await createdProject;
  expect(projectResponse.ok()).toBe(true);
  const projectResult = await projectResponse.json();
  expect(projectResult.error).toBeFalsy();
  expect(projectResult.project_id).toMatch(/^[a-f\d]{32}$/i);
  expect(state.knownIds).not.toContain(projectResult.project_id);
  state.ids.project = projectResult.project_id;
  saveState(info, state);

  await list(page, 'group');
  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
  const group = page.locator('#form_edit_group_users');
  await group.locator('#name').fill(data.group);
  const rights = await group.locator('input[id^="enable_edit_"]').evaluateAll(nodes => nodes.map(node => node.id));
  expect(rights).toContain('enable_edit_config');
  for (const id of ['enable_edit_config', ...rights.filter(id => id !== 'enable_edit_config')]) {
    const input = group.locator(`#${id}`);
    if (!await input.isChecked()) await input.locator('..').locator('span').click();
  }
  await create(page, info, state, 'group', group);
  await list(page, 'group');
  await page.locator(`#table_option tr[rec_id="${state.ids.group}"] td.edit`).click();
  for (const id of rights) await expect(group.locator(`#${id}`)).toBeChecked();
  await group.locator('#form_cancel').click();

  await list(page, 'user');
  await page.locator('#header_main .btn_add').filter({ hasText: '+Добавить' }).click();
  const user = page.locator('#form_edit_user');
  await user.locator('#login').fill(data.login);
  await user.locator('#name').fill(data.name);
  await user.locator('#password1').fill(data.password);
  await user.locator('#password2').fill(data.password);
  await user.locator('#def_project_id').selectOption(state.ids.project);
  const editProfile = user.locator('#enable_edit');
  if (!await editProfile.isChecked()) await editProfile.locator('..').locator('span').click();
  for (const input of await user.locator('input[id^="enable_edit_"]').all()) await expect(input).not.toBeChecked();
  await create(page, info, state, 'user', user);
  await list(page, 'user');
  await page.locator(`#table_option tr[rec_id="${state.ids.user}"] td.edit`).click();
  await expect(user.locator('#def_project_id')).toHaveValue(state.ids.project);
  await expect(user.locator('#enable_edit')).toBeChecked();
  for (const input of await user.locator('input[id^="enable_edit_"]').all()) await expect(input).not.toBeChecked();
  await user.locator('#form_cancel').click();
  await setTestGroup(page, true);
  await projectAccess(page, state, 'user');
  await projectAccess(page, state, 'group');
  await signOut(page);
  await signIn(page);
  await openProject(page, data.project);
  for (const title of ['Дерево проекта', 'Пользователи', 'Группы', 'Карты']) await expect(page.locator(`#panel_right [title="${title}"]`)).toBeVisible();
  state.ready = true;
  saveState(info, state);
}

export async function cleanupBootstrap(page: Page, info: TestInfo) {
  expect(data.admin.login.toLowerCase(), 'Администратор и тестовый пользователь должны различаться').not.toBe(data.login);
  const state: State = { owner: 'bootstrap-v1', origin: new URL(data.baseURL).origin, knownIds: [], ids: { project: '', user: '', group: '' }, ready: false };
  saveState(info, state);
  await closeForms(page);
  await page.goto('/');
  if (await page.locator('#logout').isVisible()) await signOut(page);
  await signInAsTest(page);
  for (const kind of ['user', 'group', 'project'] as const) {
    await list(page, kind);
    const rows = page.locator('#table_option tr[rec_id]');
    const reserved = kind === 'user'
      ? page.locator(`#table_option tr[rec_id][fl="${data.login}"]`)
      : rows.filter({ has: page.getByRole('cell', { name: lists[kind].name, exact: true }) });
    const ids = await reserved.evaluateAll(nodes => nodes.map(node => node.getAttribute('rec_id')!));
    for (const id of ids) {
      expect(id).toMatch(/^(?:[a-f\d]{32}|\d+)$/i);
      const row = page.locator(`#table_option tr[rec_id="${id}"]`);
      if (await row.count()) {
        if (kind === 'user') await expect(row).toHaveAttribute('fl', data.login);
        else await expect(row.getByRole('cell', { name: lists[kind].name, exact: true })).toBeVisible();
        if (kind === 'project') await page.goto('/');
        const response = await page.request.post(lists[kind].remove, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          data: JSON.stringify({ ids: [id] }),
        });
        expect(response.ok()).toBe(true);
        const result = await response.json();
        expect(result.error, `Удаление: ${lists[kind].title}`).toBeFalsy();
        expect(result.ids.map(String)).toEqual([id]);
        await expect.poll(async () => {
          const fresh = await page.request.get(lists[kind].path, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
          expect(fresh.ok()).toBe(true);
          return (await fresh.text()).includes(`rec_id="${id}"`);
        }, { message: `Удалённый объект исчез из списка: ${lists[kind].title}` }).toBe(false);
      }
      await list(page, kind);
      await expect(row).toHaveCount(0);
    }
    state.ids[kind] = '';
    saveState(info, state);
  }
}
