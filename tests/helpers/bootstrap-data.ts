import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { expect, type Page } from '@playwright/test';

const env = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};

export const bootstrapData = {
  baseURL: env.BASE_URL || process.env.BASE_URL || 'http://localhost:8080',
  admin: { login: env.ADMIN || process.env.ADMIN || '', password: env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '' },
  project: env.PROJECT || process.env.PROJECT || 'autotest',
  login: env.USER || process.env.USER || 'autotest',
  password: env.PASSWORD || process.env.PASSWORD || '',
  group: env.TEST_GROUP || process.env.TEST_GROUP || 'test_group',
};

export const administrationData = {
  project: 'Проверка доступа', group: 'Операторы проверки',
  login: 'e2e_operator', password: bootstrapData.password, name: 'Оператор проверки',
};

export async function testIdentity(page: Page, kind: 'user' | 'group'): Promise<string> {
  const path = kind === 'user' ? '/edit_users/' : '/edit_groups_users/';
  const response = await page.request.get(path, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  expect(response.ok(), 'Список подготовленных пользователей или групп доступен').toBe(true);
  const ids = await page.evaluate(({ html, kind, login, group }) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('tr[rec_id]')).filter(row => kind === 'user'
      ? row.getAttribute('fl') === login.toLowerCase()
      : row.querySelector('td:nth-child(2)')?.textContent?.trim() === group)
      .map(row => row.getAttribute('rec_id'));
  }, { html: await response.text(), kind, login: bootstrapData.login, group: bootstrapData.group });
  expect(ids, `Нужен один подготовленный объект: ${kind === 'user' ? bootstrapData.login : bootstrapData.group}`).toHaveLength(1);
  expect(ids[0], 'ID подготовленного объекта').toMatch(/^(?:[a-f\d]{32}|\d+)$/i);
  return ids[0]!;
}
