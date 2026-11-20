import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createReportServer } from './report-server.mjs';
import { acquireLock } from './report-history.mjs';

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'report-api-'));
  const server = createReportServer({ root });
  await new Promise(accept => server.listen(0, '127.0.0.1', accept));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(accept => server.close(accept));
    rmSync(root, { recursive: true, force: true });
  });
  const state = await (await fetch(`${base}/api/state`)).json();
  const post = (path, data, headers = {}) => fetch(`${base}/api/${path}`, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', 'X-Report-Token': state.token, ...headers },
    body: JSON.stringify(data),
  });
  return { root, base, state, post };
}

function seed(root, n) {
  const id = `20261114T000000000Z-${n.toString(16).padStart(8, '0')}`;
  const dir = join(root, 'runs', id);
  mkdirSync(join(dir, 'html'), { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ managedBy: 'scada-playwright-html-v1', id, started: n, status: 'passed', kind: 'selection' }));
  writeFileSync(join(dir, 'html', 'index.html'), '<h1>Отчёт</h1>');
  return { id, dir };
}

test('The API saves settings and requires a current cleanup preview', async t => {
  const { root, post, state } = await fixture(t);
  const old = seed(root, 1);
  seed(root, 2);
  assert.equal((await post('settings', { ...state.settings, maxRuns: 1, passedDays: 0 })).status, 200);
  assert.ok(existsSync(old.dir));
  const plan = await (await post('cleanup-preview', {})).json();
  assert.deepEqual(plan.candidates.map(run => run.id), [old.id]);
  assert.equal((await post('pin', { id: old.id, pinned: true })).status, 200);
  assert.equal((await post('cleanup', { token: plan.token })).status, 409);
  assert.ok(existsSync(old.dir));
  await post('pin', { id: old.id, pinned: false });
  const current = await (await post('cleanup-preview', {})).json();
  assert.equal((await post('cleanup', { token: current.token })).status, 200);
  assert.equal(existsSync(old.dir), false);
});

test('The API rejects foreign requests, invalid settings and changes during a run', async t => {
  const { root, post, state } = await fixture(t);
  assert.equal((await post('settings', state.settings, { Origin: 'http://example.com' })).status, 403);
  assert.equal((await post('settings', state.settings, { 'X-Report-Token': 'wrong' })).status, 403);
  assert.equal((await post('settings', { ...state.settings, maxRuns: -1 })).status, 400);
  const release = await acquireLock(root);
  try { assert.equal((await post('settings', state.settings)).status, 409); }
  finally { await release(); }
});

test('The server serves reports and downloads without exposing internal paths', async t => {
  const { root, base } = await fixture(t);
  const run = seed(root, 1);
  mkdirSync(join(run.dir, 'html', 'extra'));
  writeFileSync(join(run.dir, 'html', 'extra', 'заметка.html'), '<script>alert(1)</script>');
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(`${base}/runs/${run.id}/html/index.html`)).status, 200);
  const download = await fetch(`${base}/runs/${run.id}/html/extra/${encodeURIComponent('заметка.html')}`);
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  const encoded = await fetch(`${base}/runs/${run.id}/html/%65xtra/${encodeURIComponent('заметка.html')}`);
  assert.match(encoded.headers.get('content-disposition'), /^attachment;/);
  assert.equal(encoded.headers.get('content-security-policy'), 'sandbox');
  mkdirSync(join(run.dir, 'html', 'data'));
  writeFileSync(join(run.dir, 'html', 'data', 'attachment.html'), '<script>alert(1)</script>');
  const attachment = await fetch(`${base}/runs/${run.id}/html/data/attachment.html`);
  assert.equal(attachment.headers.get('content-security-policy'), 'sandbox');
  assert.equal((await fetch(`${base}/settings.json`)).status, 404);
  assert.equal((await fetch(`${base}/runs/${run.id}/html/..%2f..%2f..%2fsettings.json`)).status, 400);
});
