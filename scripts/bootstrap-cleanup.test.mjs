import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('Очистка сохраняет исходные проекты и файлы', () => {
  mkdirSync('reports', { recursive: true });
  const directory = mkdtempSync(resolve('reports/bootstrap-check-'));
  const source = name => JSON.stringify(resolve(name).replaceAll('\\', '/'));
  writeFileSync(resolve(directory, 'playwright.config.ts'), `
    import config from ${source('playwright.config.ts')};
    export default { ...config, testDir: ${JSON.stringify(directory)},
      projects: [{ name: 'Проверка очистки', testMatch: 'probe.spec.ts' }] };
  `);
  writeFileSync(resolve(directory, 'probe.spec.ts'), `
    import { test, expect } from ${source('tests/helpers/test.ts')};
    import { prepareBootstrap, cleanupBootstrap, readBootstrap } from ${source('tests/helpers/bootstrap.ts')};
    import { bootstrapData, bootstrapStatePath } from ${source('tests/helpers/bootstrap-data.ts')};
    import { ensureMnemonic } from ${source('tests/helpers/mnemonic.ts')};
    import { ensureMenuLink } from ${source('tests/helpers/menu.ts')};
    import { openFileManager } from ${source('tests/helpers/files.ts')};
    import { signInAsTest } from ${source('tests/helpers/scada.ts')};
    import { requireOwned } from ${source('tests/helpers/owned.ts')};
    import { unlinkSync } from 'node:fs';

    test('Свой проект удаляется, исходные проекты и файлы сохраняются', async ({ page, onCleanup }, info) => {
      test.setTimeout(90_000);
      onCleanup(() => cleanupBootstrap(page, info));
      await signInAsTest(page);
      await openFileManager(page);
      const files = () => page.locator('#main .devices_tree_title[item_id]').evaluateAll(nodes =>
        nodes.map(node => ({ id: node.getAttribute('item_id'), name: node.textContent?.trim() })));
      const initial = await files();
      const loadedProjects = page.waitForResponse(r => new URL(r.url()).pathname === '/edit_projects/' && r.ok());
      await page.locator('#panel_right [title="Проекты"]').click();
      await (await loadedProjects).finished();
      await expect(page.locator('#header_main > div:first-child')).toContainText('Проекты');
      const projects = () => page.locator('#table_option tr[rec_id]').evaluateAll(rows =>
        rows.map(row => row.getAttribute('rec_id')).sort());
      const initialProjects = await page.locator('#table_option tr[rec_id]')
        .filter({ hasNot: page.getByRole('cell', { name: bootstrapData.project, exact: true }) })
        .evaluateAll(rows => rows.map(row => row.getAttribute('rec_id')).sort());
      if (initialProjects.length) await expect(requireOwned(page, page.locator('#table_option tr[rec_id]').first())).rejects.toThrow();
      await prepareBootstrap(page, info);
      const previous = readBootstrap(info)!.ids;
      unlinkSync(bootstrapStatePath());
      await prepareBootstrap(page, info);
      const state = readBootstrap(info)!;
      const projectId = state.ids.project;
      for (const kind of ['project', 'user', 'group'] as const) expect(state.ids[kind]).not.toBe(previous[kind]);

      const scene = await ensureMnemonic(page, 'Контроль очистки проекта');
      const sceneId = await scene.getAttribute('rec_id');
      await requireOwned(page, scene);
      await ensureMnemonic(page, 'Контроль очистки проекта');
      await ensureMenuLink(page, 'Схема очистки', 'Контроль очистки проекта');
      await ensureMenuLink(page, 'Схема очистки', 'Контроль очистки проекта');
      expect(sceneId).toMatch(/^[a-f\\d]{32}$/i);
      await info.attach('Схема перед удалением проекта', {
        body: JSON.stringify({ projectId, sceneId }), contentType: 'application/json',
      });
      unlinkSync(bootstrapStatePath());
      await cleanupBootstrap(page, info);
      expect(Object.values(readBootstrap(info)!.ids)).toEqual(['', '', '']);
      await expect(page.locator('#table_option tr[rec_id="' + projectId + '"]')).toHaveCount(0);
      expect(await projects()).toEqual(initialProjects);
      await openFileManager(page);
      expect(await files()).toEqual(initial);
    });
  `);
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const run = spawnSync(process.execPath, [cli, 'test', '--config', resolve(directory, 'playwright.config.ts'), '--headed', '--workers=1'], {
    encoding: 'utf8', timeout: 180_000,
  });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
