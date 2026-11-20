import { stat } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { projectName, ensureProject, openProject, signInAsAdmin } from './helpers/scada';

test('Скачивание готовой резервной копии', { tag: ['@files', '@backup', '@admin', '@scenario'] }, async ({ page }) => {
  await signInAsAdmin(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);
  const loaded = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/edit_backup/');
  await page.locator('#panel_right [title="Резервные копии"]').click();
  await loaded;
  const heading = page.locator('#header_main > div:first-child');
  await expect(heading).toContainText('Резервных копий:');
  test.skip(/Резервных копий:\s*0\b/.test(await heading.innerText()), 'На стенде нет существующей резервной копии для скачивания');

  const row = page.locator('#table_option tr[rec_id$=".bcp"]').first();
  await expect(row, 'Для проверки нужна существующая резервная копия .bcp').toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await row.locator('td.upload').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.bcp$/);
  expect(await download.failure()).toBeNull();
  expect((await stat(await download.path())).size).toBeGreaterThan(0);
});
