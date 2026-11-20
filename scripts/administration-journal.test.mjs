import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { AdministrationJournal } from '../tests/helpers/administration-journal.ts';

const scope = { baseURL: 'http://localhost:8080', admin: 'operator' };
const empty = { project: '', user: '', group: '' };
const owned = { project: '1'.repeat(32), user: '2'.repeat(32), group: '3'.repeat(32) };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'administration-journal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('Journal survives reopening and isolates servers and administrator accounts', t => {
  const directory = fixture(t);
  const journal = new AdministrationJournal(directory, scope);
  assert.deepEqual(journal.read(), empty);
  journal.write(owned);
  assert.deepEqual(new AdministrationJournal(directory, scope).read(), owned);
  assert.deepEqual(new AdministrationJournal(directory, { ...scope, baseURL: 'https://localhost:8080' }).read(), empty);
  assert.deepEqual(new AdministrationJournal(directory, { ...scope, admin: 'other' }).read(), empty);
  assert.equal(journal.file, new AdministrationJournal(directory, { ...scope, baseURL: 'http://localhost:8080/', admin: 'OPERATOR' }).file);
  const other = new AdministrationJournal(directory, { ...scope, baseURL: 'http://other:8080' });
  other.write(owned);
  journal.write({ ...owned, user: '' });
  assert.deepEqual(journal.read(), { ...owned, user: '' });
  journal.write(empty);
  assert.equal(existsSync(journal.file), false);
  assert.deepEqual(other.read(), owned);
});

test('Invalid IDs, damaged metadata and foreign scope are rejected without changing the journal', t => {
  const journal = new AdministrationJournal(fixture(t), scope);
  journal.write(owned);
  const original = readFileSync(journal.file, 'utf8');
  assert.throws(() => journal.write({ ...owned, user: '10' }), /ID/);
  assert.equal(readFileSync(journal.file, 'utf8'), original);
  for (const damaged of ['{', JSON.stringify({ ...JSON.parse(original), scope: { ...JSON.parse(original).scope, admin: 'other' } }), JSON.stringify({ ...JSON.parse(original), ids: { project: '1'.repeat(32) } })]) {
    writeFileSync(journal.file, damaged);
    assert.throws(() => journal.read());
    assert.equal(readFileSync(journal.file, 'utf8'), damaged);
  }
});

test('Forced process termination leaves recorded ownership available for recovery', t => {
  const directory = fixture(t);
  const module = new URL('../tests/helpers/administration-journal.ts', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { AdministrationJournal } from ${JSON.stringify(module)};
    const journal = new AdministrationJournal(${JSON.stringify(directory)}, ${JSON.stringify(scope)});
    journal.write(${JSON.stringify(owned)});
    process.kill(process.pid, 'SIGKILL');
  `], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(child.error);
  assert.notEqual(child.status, 0);
  assert.deepEqual(new AdministrationJournal(directory, scope).read(), owned);
});
