import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import HistoryReporter, { pruneHistory, archiveResults, recoverRuns, acquireLock, isFullBase, setPinned, runName, historyState } from './report-history.mjs';

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

test('Fully skipped runs are not marked as passed', () => {
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

test('Run names reflect the section or suite', () => {
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

test('Completed results survive interruption and retries replace the previous attempt', t => {
  const root = fixture(t);
  const dir = run(root, 1, { status: 'running' });
  const reporter = new HistoryReporter({ root, runDir: dir });
  const tests = ['Первый', 'Второй', 'Третий'].map((title, id) => ({
    id: String(id), title, tags: [], expectedStatus: 'passed', parent: { project: () => ({ name: 'user' }) },
  }));
  reporter.onBegin({ allTests: () => tests });
  const artifact = join(dir, 'results', 'снимок.png');
  mkdirSync(join(dir, 'results'));
  writeFileSync(artifact, 'image');
  reporter.onTestBegin(tests[0], { retry: 0 });
  reporter.onTestEnd(tests[0], { status: 'failed', retry: 0, duration: 100, errors: [{ message: 'Первая попытка' }], attachments: [] });
  reporter.onTestBegin(tests[0], { retry: 1 });
  reporter.onTestEnd(tests[0], { status: 'passed', retry: 1, duration: 50, errors: [], attachments: [{ name: 'Снимок', path: artifact }] });
  reporter.onTestBegin(tests[1], { retry: 0 });
  const saved = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  assert.deepEqual(saved.tests.map(test => test.status), ['passed', 'running', 'notRun']);
  assert.equal(saved.tests[0].retry, 1);
  assert.deepEqual(saved.tests[0].errors, []);
  assert.equal(saved.tests[0].duration, 50);
  recoverRuns(root);
  const state = historyState(root).runs[0];
  assert.equal(state.status, 'interrupted');
  assert.equal(state.reportUrl, null);
  assert.deepEqual(state.tests.map(test => test.status), ['passed', 'interrupted', 'notRun']);
  assert.equal(state.tests[0].project, 'user');
  assert.match(state.tests[0].attachments[0].url, /\/attachments\/0\/0$/);
  assert.ok(existsSync(artifact));
});

test('Retention keeps the latest, pinned and five full base runs', t => {
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

test('Age and size limits remove old unprotected results', t => {
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

test('Linked directories are not traversed or deleted', t => {
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

test('Verified attachments are deduplicated and extra files are kept', async t => {
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

test('Missing or corrupt attachments prevent result deletion', async t => {
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

test('An active lock prevents concurrent runs and recovery preserves interrupted status', async t => {
  const root = fixture(t);
  const release = await acquireLock(root);
  await assert.rejects(acquireLock(root), /active|актив/i);
  await release();
  const dir = run(root, 1, { status: 'running' });
  recoverRuns(root);
  assert.equal(JSON.parse(readFileSync(join(dir, 'run.json'))).status, 'interrupted');
  assert.ok(existsSync(join(dir, 'payload')));
});

test('Only a dead process lock is removed after forced termination', async t => {
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

test('Only known managed runs can be pinned', t => {
  const root = fixture(t);
  const dir = run(root, 1);
  setPinned(root, 'latest', true);
  assert.ok(existsSync(join(dir, '.keep')));
  setPinned(root, 'latest', false);
  assert.equal(existsSync(join(dir, '.keep')), false);
  assert.throws(() => setPinned(root, '../outside', true), /Unknown report/);
});

test('Full base detection matches the exact test set for each role', () => {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  for (const project of ['user', 'admin']) {
    const discovery = spawnSync(process.execPath, [cli, 'test', '--project', project, '--grep', '@base', '--list', '--reporter=json'], { encoding: 'utf8' });
    assert.equal(discovery.status, 0, discovery.stderr);
    const tests = [];
    const collect = suites => { for (const suite of suites) { for (const spec of suite.specs || []) { for (const test of spec.tests) tests.push({ id: spec.id, tags: spec.tags, projectName: test.projectName }); } collect(suite.suites || []); } };
    collect(JSON.parse(discovery.stdout).suites);
    assert.ok(tests.length > 1);
    assert.equal(isFullBase(tests, resolve('playwright.config.ts')), true, project);
    assert.equal(isFullBase(tests.slice(0, 1), resolve('playwright.config.ts')), false);
  }
});
