import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');

function discover(...args) {
  const result = spawnSync(process.execPath, [cli, 'test', ...args, '--list', '--reporter=json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const tests = [];
  const collect = suites => {
    for (const suite of suites) {
      for (const spec of suite.specs || []) tests.push(...spec.tests.map(test => ({ title: spec.title, project: test.projectName })));
      collect(suite.suites || []);
    }
  };
  collect(JSON.parse(result.stdout).suites);
  return tests;
}

test('File tests run without environment setup or teardown', () => {
  const tests = discover('tests/files.spec.ts');
  assert.equal(tests.filter(test => test.project === 'admin').length, 2);
  assert.equal(tests.filter(test => test.project === 'user').length, 2);
  assert.equal(tests.length, 4);
});

test('Permission changes require an explicit separate run', () => {
  assert.deepEqual(discover('tests/rights.spec.ts', '--pass-with-no-tests'), []);
  const tests = discover('--config', 'playwright.permissions.config.ts', 'tests/rights.spec.ts');
  assert.equal(tests.length, 5);
  assert.ok(tests.every(test => test.project === 'permissions'));
});

test('Creation checks run independently under the selected role', () => {
  const tests = discover('tests/administration.spec.ts', '--project', 'user');
  assert.equal(tests.length, 3);
  assert.ok(tests.every(test => test.project === 'user'));
});
