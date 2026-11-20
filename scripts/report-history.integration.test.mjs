import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { inside } from './report-history.mjs';

test('Three headed runs preserve history, failure traces and files without duplicate results', t => {
  mkdirSync('reports', { recursive: true });
  const directory = mkdtempSync(resolve('reports/html-history-check-'));
  t.after(() => {
    inside(resolve('reports'), directory);
    rmSync(directory, { recursive: true, force: true });
  });
  const historyRoot = join(directory, 'history');
  const history = join(historyRoot, 'runs');
  const config = join(directory, 'playwright.config.ts');
  writeFileSync(config, `
    import base from ${JSON.stringify(resolve('playwright.config.ts').replaceAll('\\', '/'))};
    import { basename, join } from 'node:path';
    const root = ${JSON.stringify(historyRoot)};
    const reportHistory = { ...base.metadata.reportHistory, root,
      runDir: join(root, 'runs', basename(base.metadata.reportHistory.runDir)) };
    export default { ...base, testDir: ${JSON.stringify(directory)}, testMatch: 'probe.spec.ts',
      metadata: { reportHistory }, outputDir: join(reportHistory.runDir, 'results'),
      reporter: process.argv.includes('--list') ? [['list']] : [
        ['list'], ['html', { outputFolder: join(reportHistory.runDir, 'html'), open: 'never' }],
        [${JSON.stringify(resolve('scripts/report-history.mjs'))}, reportHistory],
      ], retries: 0, workers: 1, timeout: 10000 };
  `);
  writeFileSync(join(directory, 'probe.spec.ts'), `
    import { test, expect } from '@playwright/test';
    import { writeFileSync } from 'node:fs';
    test('Report probe using a local page', async ({ page }, testInfo) => {
      await test.step('Открыть локальную страницу для проверки отчёта', async () => {
        await page.setContent('<h1>Проверка HTML-отчёта</h1><p>Это искусственный пример, не ошибка SCADA.</p>');
        await expect(page.getByRole('heading')).toHaveText('Проверка HTML-отчёта');
      });
      writeFileSync(testInfo.outputPath('Контрольная заметка.txt'), 'Не прикреплённый файл должен сохраниться');
      if (process.env.SCADA_REPORT_PROBE_FAIL === '1') {
        await test.step('Намеренно вызвать ошибку для проверки скриншота и трассы', async () => {
          expect('Намеренная ошибка инфраструктурной проверки').toBe('Успешный результат');
        });
      }
    });
  `);
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const listing = spawnSync(process.execPath, [cli, 'test', '--config', config, '--list'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(listing.status, 0, listing.stderr);
  assert.equal(existsSync(history), false, 'Discovery must not create history directories');
  for (const failure of [false, true, false]) {
    const env = { ...process.env, SCADA_REPORT_PROBE_FAIL: failure ? '1' : '0' };
    delete env._SCADA_REPORT_RUN_ID;
    delete env.npm_lifecycle_event;
    const result = spawnSync(process.execPath, [cli, 'test', '--config', config, '--headed', '--workers=1'], {
      encoding: 'utf8', timeout: 45000, env,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    assert.ifError(result.error);
    assert.equal(result.status, failure ? 1 : 0, result.stdout + result.stderr);
  }
  const created = readdirSync(history).sort();
  assert.equal(created.length, 3);
  const data = created.map(id => JSON.parse(readFileSync(join(history, id, 'run.json'), 'utf8')));
  assert.deepEqual(data.map(r => r.status), ['passed', 'failed', 'passed']);
  for (const id of created) {
    const dir = join(history, id);
    assert.equal(existsSync(join(dir, 'results')), false);
    assert.ok(existsSync(join(dir, 'html', 'index.html')));
    assert.ok(existsSync(join(dir, 'html', 'extra')));
  }
  const failed = join(history, created[1], 'html', 'data');
  const attachments = readdirSync(failed);
  assert.equal(attachments.filter(f => f.endsWith('.zip')).length, 1);
  assert.ok(attachments.some(f => f.endsWith('.png')));
  assert.ok(existsSync(join(history, created[1], 'html', 'trace')));
  assert.equal(existsSync(join(historyRoot, '.active.json')), false);
  console.log(`Verified history runs: ${created.join(', ')}`);
});
