import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

const created = new WeakMap<BrowserContext, Set<string>>();

export function rememberCreated(page: Page, id: unknown): string {
  expect(id, 'Сервер вернул ID созданного объекта').toMatch(/^[a-f\d]{32}$/i);
  const ids = created.get(page.context()) ?? new Set<string>();
  ids.add(id as string);
  created.set(page.context(), ids);
  return id as string;
}

export async function saveOwned(page: Page, path: string, key: string | [string, ...string[]], submit: () => Promise<unknown>) {
  const initial = await page.locator('[rec_id], [node_id], [item_id]').evaluateAll(nodes =>
    nodes.flatMap(node => ['rec_id', 'node_id', 'item_id'].map(name => node.getAttribute(name))).filter(Boolean));
  const [response] = await Promise.all([
    page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith(path)),
    submit(),
  ]);
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.error).toBeFalsy();
  const ids = (typeof key === 'string' ? [key] : key).map(field => result[field]);
  for (const id of ids) {
    expect(id, 'Сервер вернул ID созданного объекта').toMatch(/^[a-f\d]{32}$/i);
    expect(initial, 'Создание не должно возвращать ID существующего объекта').not.toContain(id);
  }
  return ids.map(id => rememberCreated(page, id))[0];
}

export async function requireOwned(page: Page, row: Locator, attribute = 'rec_id') {
  const id = await row.getAttribute(attribute);
  expect(id && created.get(page.context())?.has(id), 'Изменять и удалять можно только созданный этим тестом объект').toBe(true);
}
