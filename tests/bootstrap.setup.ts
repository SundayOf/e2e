import { test } from './helpers/test';
import { cleanupBootstrap, prepareBootstrap, readBootstrap } from './helpers/bootstrap';

test.use({ actionTimeout: 10_000 });

test('Создать проект, пользователя и группу', { tag: '@bootstrap' }, async ({ page, onCleanup }, info) => {
  test.setTimeout(90_000);
  onCleanup(async () => {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('Подготовка перед очисткой.png'), timeout: 3000 }).catch(() => {});
    if (!readBootstrap(info)?.ready) await cleanupBootstrap(page, info);
  });
  await prepareBootstrap(page, info);
});
