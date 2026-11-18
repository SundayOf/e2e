import { expect, test } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';

let root: string;
let server: Server;
let url: string;
const oldId = '20261114T000000000Z-00000001';
const latestId = '20261114T000000000Z-00000002';

test.beforeAll(async () => {
  mkdirSync('reports', { recursive: true });
  root = mkdtempSync(resolve('reports/report-ui-data-'));
  for (const [index, id] of [oldId, latestId].entries()) {
    const dir = join(root, 'runs', id);
    mkdirSync(join(dir, 'html', 'extra'), { recursive: true });
    writeFileSync(join(dir, 'run.json'), JSON.stringify({
      managedBy: 'scada-playwright-html-v1', id, started: Date.now() - (2 - index) * 1000,
      status: index === 0 ? 'failed' : 'passed', kind: 'selection', total: 1,
      revision: index === 0 ? 'a1b2c3d' : 'e4f5a6b',
      name: index === 0 ? 'Настройки' : 'Руководство',
      selection: [index === 0 ? 'Сохранение шрифта' : 'Открытие руководства'],
    }));
    writeFileSync(join(dir, 'html', 'index.html'), '<h1>Проверка сохранённого отчёта</h1>');
    writeFileSync(join(dir, 'html', 'extra', 'заметка.txt'), 'Сохранённый файл');
  }
  const { createReportServer } = await import(pathToFileURL(resolve('scripts/report-server.mjs')).href);
  server = createReportServer({ root });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Report server did not start');
  url = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>(accept => server.close(() => accept()));
  if (root) {
    const path = relative(resolve('reports'), resolve(root));
    if (!path || path.startsWith('..') || isAbsolute(path)) throw new Error('Unexpected report fixture path');
    rmSync(root, { recursive: true, force: true });
  }
});

test('Настройки хранения, закрепление и удаление отчётов', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator('.run')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Прогоны SCADA' })).toHaveCount(0);
  await expect(page.getByText('Прочие файлы', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Настройки', exact: true })).toBeVisible();
  const oldManifest = join(root, 'runs', oldId, 'run.json');
  const original = readFileSync(oldManifest, 'utf8');
  writeFileSync(oldManifest, JSON.stringify({ ...JSON.parse(original), status: 'running' }));
  const initialState = await (await page.request.get(`${url}/api/state`)).json();
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ ...initialState.settings, maxBytes: initialState.bytes * 2 }));
  const allFilter = page.getByRole('button', { name: /^Все/ });
  await allFilter.focus();
  await page.waitForResponse(response => response.url() === `${url}/api/state` && response.request().method() === 'GET');
  await expect(page.locator('#temporary-size')).not.toHaveText('0.0 КиБ');
  await expect(allFilter).toBeFocused();
  const widths = await page.evaluate(() => ({
    saved: document.querySelector('#storage-saved')!.getBoundingClientRect().width,
    temporary: document.querySelector('#storage-temporary')!.getBoundingClientRect().width,
    track: document.querySelector('#storage-progress')!.getBoundingClientRect().width,
  }));
  expect(widths.saved).toBeGreaterThan(0);
  expect(widths.temporary).toBeGreaterThan(0);
  expect((widths.saved + widths.temporary) / widths.track).toBeCloseTo(0.5, 2);
  writeFileSync(oldManifest, original);
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(page.locator('#temporary-size')).toHaveText('0.0 КиБ');
  for (const [theme, background] of [['dark-mode', 'rgb(18, 18, 18)'], ['light-mode', 'rgb(255, 255, 255)']]) {
    await page.evaluate(value => localStorage.setItem('theme', value), theme);
    await page.reload();
    await expect(page.locator('body')).toHaveCSS('background-color', background);
  }

  await page.getByRole('button', { name: 'С ошибками' }).click();
  await expect(page.locator('.run')).toHaveCount(1);
  await page.getByRole('button', { name: /^Все/ }).click();
  await page.getByRole('searchbox').fill('руководства');
  await expect(page.locator('.run')).toHaveCount(1);
  await expect(page.locator('.run')).toHaveAttribute('data-id', latestId);
  await page.getByRole('searchbox').fill('  РУКОВОДСТВА  ');
  await expect(page.locator('.run')).toHaveCount(1);
  await page.getByRole('searchbox').fill(oldId);
  await expect(page.locator('.run')).toHaveAttribute('data-id', oldId);
  await page.getByRole('searchbox').fill('a1b2c3d');
  await expect(page.locator('.run')).toHaveAttribute('data-id', oldId);
  await page.getByRole('searchbox').fill('Настройки');
  await expect(page.locator('.run')).toHaveAttribute('data-id', oldId);
  await page.getByRole('button', { name: 'Успешные' }).click();
  await expect(page.getByText('Прогоны не найдены', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Все/ }).click();
  await expect(page.locator('.run')).toHaveAttribute('data-id', oldId);
  await page.getByRole('searchbox').fill('Несуществующий отчёт');
  await expect(page.locator('.run')).toHaveCount(0);
  await page.getByRole('searchbox').clear();
  await expect(page.locator('.run')).toHaveCount(2);
  await expect(page.getByPlaceholder('Найти отчёт')).toBeVisible();

  await page.getByRole('button', { name: 'Настройки хранения', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Хранение отчётов' });
  await settings.getByLabel('Количество прогонов').fill('1');
  await settings.getByLabel('Сохранять последних полных баз').fill('0');
  await settings.getByLabel('Лимит места, ГиБ').fill('0.01');
  await settings.getByLabel('Автоматическая очистка после прогона').uncheck();
  await settings.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(settings).toBeHidden();
  expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')).maxRuns).toBe(1);
  await expect(page.locator('.run')).toHaveCount(2);
  await page.getByRole('button', { name: 'Настройки хранения', exact: true }).click();
  await expect(settings.getByLabel('Лимит места, ГиБ')).toHaveValue('0.01');
  await expect(settings.getByLabel('Автоматическая очистка после прогона')).not.toBeChecked();
  await settings.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(settings).toBeHidden();

  const old = page.locator(`[data-id="${oldId}"]`);
  await old.getByRole('button', { name: 'Закрепить', exact: true }).click();
  await expect(old.getByRole('button', { name: 'Удалить', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Очистить', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('удалять нечего');
  await old.getByRole('button', { name: 'Открепить', exact: true }).click();
  await page.getByRole('button', { name: 'Очистить', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Удалить прогон?' });
  await expect(confirmation).toContainText('Настройки');
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.locator('.run')).toHaveCount(2);
  await page.getByRole('button', { name: 'Очистить', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.locator('.run')).toHaveCount(1);

  const latest = page.locator(`[data-id="${latestId}"]`);
  await latest.locator('summary').click();
  await expect(latest.getByRole('link', { name: /заметка.txt/ })).toBeVisible();
  await latest.getByRole('button', { name: 'Удалить', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByText('Прогоны не найдены', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
