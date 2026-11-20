import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { inside } from './report-history.mjs';

function fixture(t) {
  mkdirSync('reports', { recursive: true });
  const directory = mkdtempSync(resolve('reports/administration-recovery-'));
  t.after(() => { inside(resolve('reports'), directory); rmSync(directory, { recursive: true, force: true }); });
  const config = join(directory, 'playwright.config.ts');
  const ready = join(directory, 'ready.json');
  const report = join(directory, 'report.json');
  writeFileSync(config, `
    import base from ${JSON.stringify(resolve('playwright.config.ts').replaceAll('\\', '/'))};
    export default { testDir: '.', testMatch: 'probe.spec.ts',
      projects: [{ name: 'user', metadata: { role: 'user' } }],
      use: base.use, workers: 1, retries: 0, timeout: 60000,
      outputDir: ${JSON.stringify(join(directory, 'results'))},
      reporter: [['json', { outputFile: ${JSON.stringify(report)} }]] };
  `);
  writeFileSync(join(directory, 'probe.spec.ts'), `
    import { test, expect } from ${JSON.stringify(resolve('tests/helpers/test.ts').replaceAll('\\', '/'))};
    import { cleanupAdministration, createProject, createUserGroup, createUser, newAdministrationState, recoverAdministration } from ${JSON.stringify(resolve('tests/helpers/administration.ts').replaceAll('\\', '/'))};
    import { bootstrapData } from ${JSON.stringify(resolve('tests/helpers/bootstrap-data.ts').replaceAll('\\', '/'))};
    import { signIn } from ${JSON.stringify(resolve('tests/helpers/scada.ts').replaceAll('\\', '/'))};
    import { renameSync, writeFileSync } from 'node:fs';
    test('Create objects and restore interrupted cleanup', async ({ page, onCleanup }) => {
      const state = newAdministrationState();
      onCleanup(() => cleanupAdministration(page, state));
      await recoverAdministration(page, state);
      if (process.env.E2E_RECOVERY_ONLY === '1') return;
      await signIn(page);
      const phase = process.env.E2E_RECOVERY_PHASE;
      const pause = () => {
        writeFileSync(${JSON.stringify(ready + '.tmp')}, JSON.stringify({ file: state.journal.file,
          record: { version: 1, scope: { origin: new URL(bootstrapData.baseURL).origin, admin: bootstrapData.admin.login.toLowerCase() }, ids: state.ids } }));
        renameSync(${JSON.stringify(ready + '.tmp')}, ${JSON.stringify(ready)});
        // Pause only this diagnostic worker so the parent can kill the process tree at an exact boundary.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      };
      const write = state.journal.write.bind(state.journal);
      state.journal.write = ids => {
        const before = state.journal.read();
        if (phase === 'before-journal' && !before.project && ids.project) pause();
        write(ids);
        if ((phase === 'project-saved' && !before.project && ids.project) ||
            (phase === 'group-saved' && !before.group && ids.group) ||
            (phase === 'user-saved' && !before.user && ids.user) ||
            (phase === 'user-deleted' && before.user && !ids.user) ||
            (phase === 'group-deleted' && before.group && !ids.group) ||
            (phase === 'project-deleted' && before.project && !ids.project)) pause();
      };
      await createProject(page, state);
      await createUserGroup(page, state);
      await createUser(page, state);
      if (process.env.E2E_RECOVERY_FAULT === '1') {
        const ids = { ...state.ids };
        const post = page.request.post.bind(page.request);
        page.request.post = async (url, options) => {
          if (url === '/delete_user/') throw new Error('Injected deletion failure');
          return post(url, options);
        };
        try {
          await expect(cleanupAdministration(page, state)).rejects.toThrow();
          expect(state.journal.read()).toEqual(ids);
        } finally { page.request.post = post; }
      }
      if (phase === 'access-saved') pause();
    });
  `);
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const env = { ...process.env };
  delete env.E2E_RECOVERY_PHASE;
  delete env.E2E_RECOVERY_ONLY;
  const args = [cli, 'test', '--config', config, '--headed', '--workers=1'];
  const run = async (phase = '', only = false, fault = false) => {
    rmSync(ready, { force: true });
    rmSync(report, { force: true });
    const child = spawn(process.execPath, args, { env: { ...env, E2E_RECOVERY_PHASE: phase, E2E_RECOVERY_ONLY: only ? '1' : '0', E2E_RECOVERY_FAULT: fault ? '1' : '0' } });
    child.stdout.resume();
    child.stderr.resume();
    const exited = new Promise((accept, reject) => { child.once('exit', accept); child.once('error', reject); });
    const stop = () => {
      if (process.platform === 'win32') {
        const killed = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
        assert.equal(killed.status, 0, 'Failed to terminate the diagnostic process tree');
      } else child.kill('SIGKILL');
    };
    try {
      if (phase) {
        const deadline = Date.now() + 45000;
        while (!existsSync(ready) && child.exitCode === null && child.signalCode === null && Date.now() < deadline) await setTimeout(50);
        assert.ok(existsSync(ready), `The diagnostic run did not reach ${phase}`);
        const receipt = JSON.parse(readFileSync(ready, 'utf8'));
        inside(resolve('reports/state'), receipt.file);
        stop();
        await exited;
        return receipt;
      }
      await Promise.race([exited, setTimeout(90000, null, { ref: false }).then(() => { throw new Error('Recovery run timed out'); })]);
      assert.ok(existsSync(report), 'Diagnostic report is missing');
      const data = JSON.parse(readFileSync(report, 'utf8'));
      return data.suites.flatMap(suite => suite.specs).flatMap(spec => spec.tests).flatMap(test => test.results);
    } finally {
      if (child.exitCode === null && child.signalCode === null) { stop(); await exited; }
    }
  };
  return { run };
}

test('Administration cleanup recovers after forced termination at creation and deletion boundaries', { timeout: 600000 }, async t => {
  const { run } = fixture(t);
  let pending;
  try {
    for (const phase of ['project-saved', 'group-saved', 'user-saved', 'access-saved', 'user-deleted', 'group-deleted', 'project-deleted', 'before-journal']) {
      pending = await run(phase);
      if (phase === 'before-journal') {
        const rejected = await run();
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0].status, 'failed');
        assert.match(rejected[0].error.message, /Существующий объект не изменяем/);
        console.log('Verified boundary: an object created before journal persistence is rejected; diagnostic receipt is used only to clean up.');
        // This receipt proves creation only to the diagnostic harness; ordinary recovery must refuse it.
        writeFileSync(pending.file, JSON.stringify(pending.record));
      }
      const recovered = await run();
      assert.deepEqual(recovered.map(result => result.status), ['passed'], `Recovery failed after ${phase}`);
      assert.equal(existsSync(pending.file), false, 'Successful cleanup must remove the journal');
      pending = undefined;
      console.log(`Verified ${phase}: process tree killed; next run recovered and cleaned its objects.`);
    }
  } finally {
    if (pending) {
      if (!existsSync(pending.file)) writeFileSync(pending.file, JSON.stringify(pending.record));
      const cleaned = await run('', true);
      assert.deepEqual(cleaned.map(result => result.status), ['passed'], 'Diagnostic objects still need cleanup');
    }
  }
});

test('Failed user deletion preserves the group and project until the next cleanup attempt', { timeout: 120000 }, async t => {
  const { run } = fixture(t);
  const results = await run('', false, true);
  assert.deepEqual(results.map(result => result.status), ['passed'], 'Dependent objects must remain after a failed deletion');
});
