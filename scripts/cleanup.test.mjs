import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('Очистка выполняется после таймаута и продолжается после ошибки', () => {
  mkdirSync('reports', { recursive: true });
  const directory = mkdtempSync(resolve('reports/cleanup-check-'));
  const marker = resolve(directory, 'cleaned.txt');
  const continued = resolve(directory, 'continued.txt');
  const report = resolve(directory, 'results.json');
  const fixture = resolve('tests/helpers/test.ts').replaceAll('\\', '/');
  const ownership = resolve('tests/helpers/owned.ts').replaceAll('\\', '/');
  const scada = resolve('tests/helpers/scada.ts').replaceAll('\\', '/');
  writeFileSync(resolve(directory, 'playwright.config.ts'), `
    export default { testDir: '.', testMatch: 'probe.spec.ts', workers: 1, retries: 0,
      reporter: [['json', { outputFile: ${JSON.stringify(report)} }]],
      outputDir: ${JSON.stringify(resolve(directory, 'test-results'))},
      use: { channel: 'chrome', launchOptions: { args: ['--window-position=40,20'] } } };
  `);
  writeFileSync(resolve(directory, 'probe.spec.ts'), `
    import { test, expect } from ${JSON.stringify(fixture)};
    import { requireOwned, saveOwned } from ${JSON.stringify(ownership)};
    import { deleteTag, ensureVirtualDevice, ensureVirtualTag, setTagFormula, setTagValue } from ${JSON.stringify(scada)};
    import { existsSync, writeFileSync } from 'node:fs';
    test('Намеренный таймаут', async ({ page, onCleanup }) => {
      test.setTimeout(1000);
      onCleanup(async () => {
        await page.setContent('<p>cleanup</p>');
        writeFileSync(${JSON.stringify(marker)}, 'cleaned');
      });
      await page.goto('about:blank');
      await new Promise(() => {});
    });
    test('Очистка завершилась после таймаута', async () => {
      expect(existsSync(${JSON.stringify(marker)})).toBe(true);
    });
    test('Ошибка одного действия не останавливает остальную очистку', async ({ onCleanup }) => {
      onCleanup(async () => { writeFileSync(${JSON.stringify(continued)}, 'cleaned'); });
      onCleanup(async () => { throw new Error('Намеренная ошибка очистки'); });
    });
    test('Только успешное создание даёт право на удаление объекта', async ({ page, browser }) => {
      let status = 200;
      let payload: Record<string, unknown> = {};
      await page.route('http://ownership.test/**', route => route.fulfill({ contentType: 'text/html', body: '<table></table>' }));
      await page.route('http://ownership.test/create/', route => route.fulfill({ status, json: payload }));
      await page.goto('http://ownership.test/');
      const submit = () => page.evaluate(() => fetch('/create/', { method: 'POST' }).then(r => r.text()));
      const row = page.locator('tr[rec_id]');
      const showRow = (id: string) => page.setContent('<table><tr rec_id="' + id + '"><td>Объект</td></tr></table>');

      const id = '1'.repeat(32);
      payload = { item_id: id };
      expect(await saveOwned(page, '/create/', 'item_id', submit)).toBe(id);
      await showRow(id);
      await requireOwned(page, row);
      const actor = await page.context().newPage();
      await actor.setContent('<table><tr rec_id="' + id + '"><td>Объект</td></tr></table>');
      await requireOwned(actor, actor.locator('tr[rec_id]'));
      await actor.close();
      const separate = await browser.newContext();
      try {
        const foreign = await separate.newPage();
        await foreign.setContent('<table><tr rec_id="' + id + '"><td>Объект</td></tr></table>');
        await expect(requireOwned(foreign, foreign.locator('tr[rec_id]'))).rejects.toThrow();
      } finally {
        await separate.close();
      }

      for (const rejected of [
        { item_id: '2'.repeat(32), error: 'Отклонено', status: 200 },
        { item_id: '3'.repeat(32), status: 403 },
        { item_id: 'bad', status: 200 },
      ]) {
        await page.setContent('<table></table>');
        status = rejected.status;
        payload = rejected;
        await expect(saveOwned(page, '/create/', 'item_id', submit)).rejects.toThrow();
        await showRow(rejected.item_id);
        await expect(requireOwned(page, row)).rejects.toThrow();
      }

      status = 200;
      const existing = '4'.repeat(32);
      await showRow(existing);
      payload = { item_id: existing };
      await expect(saveOwned(page, '/create/', 'item_id', submit)).rejects.toThrow();
      await expect(requireOwned(page, row)).rejects.toThrow();

      await page.setContent('<table></table>');
      payload = { item_id: '5'.repeat(32), node_id: 'bad' };
      await expect(saveOwned(page, '/create/', ['item_id', 'node_id'], submit)).rejects.toThrow();
      await showRow(String(payload.item_id));
      await expect(requireOwned(page, row)).rejects.toThrow();

      const foreignId = '6'.repeat(32);
      await page.setContent('<span class="devices_tree_title" node_id="' + foreignId + '">Чужое устройство</span>');
      await expect(ensureVirtualDevice(page, 'Чужое устройство')).rejects.toThrow();
      await page.setContent('<table id="table_option"><tr rec_id="' + foreignId + '"><td class="delete" onclick="this.dataset.clicked=1">Удалить</td><td></td><td>Уровень</td></tr></table>');
      await expect(ensureVirtualTag(page, { id: 2, name: 'Уровень', type: 'Float' })).rejects.toThrow();
      await expect(deleteTag(page, 'Уровень')).rejects.toThrow();
      await expect(setTagValue(page, 'Уровень', 1)).rejects.toThrow();
      await expect(setTagFormula(page, 'Уровень', '1')).rejects.toThrow();
      await expect(page.locator('td.delete')).not.toHaveAttribute('data-clicked');
      await expect(page.locator('tr[rec_id]')).toHaveAttribute('rec_id', foreignId);
    });
  `);
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const run = spawnSync(process.execPath, [cli, 'test', '--config', resolve(directory, 'playwright.config.ts'), '--headed'], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
  });
  assert.ifError(run.error);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  const results = JSON.parse(readFileSync(report, 'utf8'));
  const statuses = results.suites.flatMap(s => s.specs).flatMap(s => s.tests).map(t => t.results[0].status);
  assert.deepEqual(statuses, ['timedOut', 'passed', 'failed', 'passed']);
  assert.ok(existsSync(marker));
  assert.ok(existsSync(continued), 'Остальные действия очистки выполняются после ошибки');
});
