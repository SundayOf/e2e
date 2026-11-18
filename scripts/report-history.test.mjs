import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import HistoryReporter, { pruneHistory, archiveResults, recoverRuns, acquireLock, isFullBase, setPinned, runName } from './report-history.mjs';

const { yazl } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
async function completeHtml(dir) {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from('{"files":[]}'), 'report.json');
  const chunks = [];
  const done = new Promise(accept => { zip.outputStream.on('data', chunk => chunks.push(chunk)); zip.outputStream.on('end', accept); });
  zip.end();
  await done;
  writeFileSync(join(dir, 'html', 'index.html'), `<template id="playwrightReportBase64">data:application/zip;base64,${Buffer.concat(chunks).toString('base64')}</template>`);
}

const marker = 'scada-playwright-html-v1';
const now = Date.UTC(2026, 10, 14);

test('Полностью пропущенный запуск не помечается пройденным', () => {
  const reporter = new HistoryReporter({});
  reporter.total = 1;
  reporter.onTestEnd({}, { status: 'skipped', attachments: [] });
  reporter.onEnd({ status: 'passed' });
  assert.equal(reporter.status, 'skipped');
  reporter.total = 2;
  reporter.onEnd({ status: 'passed' });
  assert.equal(reporter.status, 'passed');
  reporter.onEnd({ status: 'failed' });
  assert.equal(reporter.status, 'failed');
});

test('Названия запусков отражают раздел или тип набора', () => {
  const table = title => ({ title, tags: ['@tags', '@tagtable', '@base'] });
  assert.equal(runName([table('Первый'), table('Второй')], 'selection'), 'Таблицы тегов');
  assert.equal(runName([table('Один кейс')], 'selection'), 'Один кейс');
  assert.equal(runName([table('Первый')], 'base'), 'Полная база');
  assert.equal(runName([], 'selection'), 'Выборочные проверки');
  assert.equal(runName([table('Первый'), { title: 'Другой раздел', tags: ['@files'] }], 'selection'), 'Выборочные проверки');
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'scada-report-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'runs'));
  return root;
}
function run(root, number, extra = {}, age = 0) {
  const id = `20261114T000000000Z-${number.toString(16).padStart(8, '0')}`;
  const dir = join(root, 'runs', id);
  mkdirSync(dir);
  const manifest = { managedBy: marker, id, started: now - age, status: 'passed', kind: 'selection', ...extra };
  writeFileSync(join(dir, 'run.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'payload'), Buffer.alloc(100));
  return dir;
}

test('Очистка ограничивает количество, сохраняя последний, закреплённый и пять base', t => {
  const root = fixture(t);
  const dirs = Array.from({ length: 28 }, (_, i) => run(root, i, { kind: i < 6 ? 'base' : 'selection' }, (28 - i) * 1000));
  writeFileSync(join(dirs[6], '.keep'), 'bug');
  const unknown = join(root, 'runs', 'user-data');
  mkdirSync(unknown);
  pruneHistory(root, { now, maxRuns: 2 });
  assert.equal(existsSync(dirs[0]), false);
  for (const i of [1, 2, 3, 4, 5, 6, 26, 27]) assert.ok(existsSync(dirs[i]));
  assert.ok(existsSync(unknown));
});

test('Возраст и бюджет удаляют старые незащищённые результаты', t => {
  const root = fixture(t);
  const day = 86400000;
  const expired = run(root, 1, {}, 8 * day);
  const failed = run(root, 2, { status: 'failed' }, 8 * day);
  const latest = run(root, 3);
  pruneHistory(root, { now });
  assert.equal(existsSync(expired), false);
  assert.ok(existsSync(failed));
  const result = pruneHistory(root, { now, maxBytes: 1 });
  assert.equal(existsSync(failed), false);
  assert.ok(existsSync(latest));
  assert.ok(result.overBudget);
});

test('Каталог-ссылка не удаляется и не обходится', t => {
  const root = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'scada-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'important'), 'keep');
  const target = run(root, 1, {}, 40 * 86400000);
  symlinkSync(outside, join(target, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  run(root, 2);
  pruneHistory(root, { now, maxBytes: 1 });
  assert.ok(existsSync(target));
  assert.equal(readFileSync(join(outside, 'important'), 'utf8'), 'keep');
});

test('Проверенные вложения не дублируются, прочие файлы сохраняются', async t => {
  const root = fixture(t);
  const dir = run(root, 1);
  const output = join(dir, 'results');
  mkdirSync(output);
  mkdirSync(join(dir, 'html', 'data'), { recursive: true });
  await completeHtml(dir);
  const source = join(output, 'trace.zip');
  const bytes = Buffer.from('trace contents');
  writeFileSync(source, bytes);
  const name = createHash('sha1').update(bytes).digest('hex') + '.zip';
  writeFileSync(join(dir, 'html', 'data', name), bytes);
  writeFileSync(join(output, 'download.ttf'), 'font');
  await archiveResults(dir, output, [source]);
  assert.equal(existsSync(output), false);
  assert.equal(readFileSync(join(dir, 'html', 'extra', 'download.ttf'), 'utf8'), 'font');
  assert.equal(existsSync(join(dir, 'html', 'extra', 'trace.zip')), false);
});

test('Отсутствующее/повреждённое вложение блокирует удаление результатов', async t => {
  const root = fixture(t);
  const dir = run(root, 1);
  const output = join(dir, 'results');
  mkdirSync(output);
  mkdirSync(join(dir, 'html'));
  writeFileSync(join(dir, 'html', 'index.html'), 'report');
  const source = join(output, 'trace.zip');
  writeFileSync(source, 'trace');
  await assert.rejects(archiveResults(dir, output, [source]), /incomplete/);
  assert.ok(existsSync(source));
  await completeHtml(dir);
  await assert.rejects(archiveResults(dir, output, [source]));
  assert.ok(existsSync(source));
  mkdirSync(join(dir, 'html', 'data'));
  const name = createHash('sha1').update('trace').digest('hex') + '.zip';
  writeFileSync(join(dir, 'html', 'data', name), 'damaged');
  await assert.rejects(archiveResults(dir, output, [source]), /verification/);
  assert.ok(existsSync(source));
});

test('Активная блокировка запрещает второй запуск, восстановление сохраняет interrupted', async t => {
  const root = fixture(t);
  const release = await acquireLock(root);
  await assert.rejects(acquireLock(root), /active|актив/i);
  await release();
  const dir = run(root, 1, { status: 'running' });
  recoverRuns(root);
  assert.equal(JSON.parse(readFileSync(join(dir, 'run.json'))).status, 'interrupted');
  assert.ok(existsSync(join(dir, 'payload')));
});

test('После принудительного завершения снимается только блокировка умершего процесса', async t => {
  const root = fixture(t);
  const dir = join(root, 'runs', '20261114T000000000Z-00000001');
  const module = new URL('./report-history.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { startRun } from ${JSON.stringify(module)};
    await startRun(${JSON.stringify({ root, runDir: dir, kind: 'selection' })});
    process.kill(process.pid, 'SIGKILL');
  `], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(child.error && new Error(`${child.error.message}\n${child.stdout}\n${child.stderr}`));
  assert.notEqual(child.status, 0);
  assert.ok(existsSync(join(root, '.active.json')), child.stdout + child.stderr);
  const release = await acquireLock(root);
  recoverRuns(root);
  assert.equal(JSON.parse(readFileSync(join(dir, 'run.json'))).status, 'interrupted');
  await release();
  assert.equal(existsSync(join(root, '.active.json')), false);
  writeFileSync(join(root, '.active.json'), '{');
  await assert.rejects(acquireLock(root), /unknown\/foreign/);
  assert.equal(readFileSync(join(root, '.active.json'), 'utf8'), '{');
  writeFileSync(join(root, '.active.json'), JSON.stringify({ context: 'another-container', pid: 123 }));
  await assert.rejects(acquireLock(root), /unknown\/foreign/);
});

test('Закрепление доступно только собственному известному прогону', t => {
  const root = fixture(t);
  const dir = run(root, 1);
  setPinned(root, 'latest', true);
  assert.ok(existsSync(join(dir, '.keep')));
  setPinned(root, 'latest', false);
  assert.equal(existsSync(join(dir, '.keep')), false);
  assert.throws(() => setPinned(root, '../outside', true), /Unknown report/);
});

test('Полная база определяется точным набором тестов, независимо от npm/npx', () => {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const discovery = spawnSync(process.execPath, [cli, 'test', '--grep', '@base', '--list', '--reporter=json'], { encoding: 'utf8' });
  assert.equal(discovery.status, 0, discovery.stderr);
  const tests = [];
  const collect = suites => { for (const suite of suites) { for (const spec of suite.specs || []) { for (const test of spec.tests) tests.push({ id: spec.id, tags: spec.tags }); } collect(suite.suites || []); } };
  collect(JSON.parse(discovery.stdout).suites);
  assert.ok(tests.length > 1);
  assert.equal(isFullBase(tests, resolve('playwright.config.ts')), true);
  assert.equal(isFullBase(tests.filter(test => !test.tags.includes('bootstrap')), resolve('playwright.config.ts')), true);
  assert.equal(isFullBase(tests.slice(0, 1), resolve('playwright.config.ts')), false);
});
