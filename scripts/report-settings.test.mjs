import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { getSettings, updateSettings, planHistory, deleteRuns, historyState } from './report-history.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'report-settings-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'runs'));
  return root;
}
function seed(root, n, extra = {}) {
  const id = `20261114T000000000Z-${n.toString(16).padStart(8, '0')}`;
  const dir = join(root, 'runs', id);
  mkdirSync(dir);
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ managedBy: 'scada-playwright-html-v1', id, started: Date.now() - (10 - n) * 1000, status: 'passed', kind: 'selection', ...extra }));
  return { id, dir };
}

test('Saving settings validates values without deleting data', t => {
  const root = fixture(t);
  const old = seed(root, 1);
  const settings = { ...getSettings(root), maxRuns: 1, passedDays: 2, failedDays: 3, keepBase: 0, maxBytes: 0, autoCleanup: false, protectLatest: false };
  updateSettings(root, settings);
  assert.deepEqual(getSettings(root), settings);
  assert.ok(existsSync(old.dir));
  assert.throws(() => updateSettings(root, { ...settings, passedDays: -1 }));
  assert.throws(() => updateSettings(root, { ...settings, autoCleanup: 'yes' }));
  assert.throws(() => updateSettings(root, { ...settings, maxBytes: null }));
});

test('Zero disables limits and cleanup preview deletes nothing', t => {
  const root = fixture(t);
  seed(root, 1, { started: 0 });
  seed(root, 2);
  updateSettings(root, { ...getSettings(root), maxRuns: 0, passedDays: 0, failedDays: 0, keepBase: 0, maxBytes: 0 });
  assert.deepEqual(planHistory(root).removed, []);
  updateSettings(root, { ...getSettings(root), maxRuns: 1 });
  const plan = planHistory(root);
  assert.equal(plan.removed.length, 1);
  assert.equal(historyState(root).runs.length, 2);
});

test('Manual deletion protects pinned and active runs and rejects unknown IDs', t => {
  const root = fixture(t);
  const pinned = seed(root, 1);
  writeFileSync(join(pinned.dir, '.keep'), 'keep');
  const active = seed(root, 2, { status: 'running' });
  const latest = seed(root, 3);
  assert.throws(() => deleteRuns(root, [latest.id, '../outside']));
  assert.ok(existsSync(latest.dir));
  assert.throws(() => deleteRuns(root, [pinned.id]));
  assert.throws(() => deleteRuns(root, [active.id]));
  deleteRuns(root, [latest.id]);
  assert.equal(existsSync(latest.dir), false);
});

test('Corrupt metadata does not break the catalog or enter cleanup', t => {
  const root = fixture(t);
  const damaged = seed(root, 1, { selection: 'wrong type' });
  const valid = seed(root, 2, { selection: ['Открытие руководства'] });
  assert.deepEqual(historyState(root).runs.map(run => run.id), [valid.id]);
  assert.deepEqual(planHistory(root, { maxRuns: 1 }).removed, []);
  assert.ok(existsSync(damaged.dir));
});

test('Storage usage separates saved reports from active run files', t => {
  const root = fixture(t);
  const saved = seed(root, 1);
  const active = seed(root, 2, { status: 'running' });
  writeFileSync(join(saved.dir, 'report.html'), Buffer.alloc(100));
  writeFileSync(join(active.dir, 'trace.zip'), Buffer.alloc(1000));
  const state = historyState(root);
  assert.equal(state.savedBytes, state.runs.find(run => run.id === saved.id).bytes);
  assert.equal(state.temporaryBytes, state.runs.find(run => run.id === active.id).bytes);
  assert.equal(state.bytes, state.savedBytes + state.temporaryBytes);
  const manifest = JSON.parse(readFileSync(join(active.dir, 'run.json'), 'utf8'));
  writeFileSync(join(active.dir, 'run.json'), JSON.stringify({ ...manifest, status: 'passed' }));
  assert.equal(historyState(root).temporaryBytes, 0);
});
