import { test } from './helpers/test';
import { cleanupAdministration, createUserGroup, createProject, createUser, newAdministrationState, recoverAdministration } from './helpers/administration';
import { signIn } from './helpers/scada';

test.use({ actionTimeout: 10_000 });

test('Создание проекта, группы и пользователя с доступом', { tag: ['@base', '@access', '@project', '@groups', '@users'] }, async ({ page, onCleanup }, info) => {
  test.setTimeout(90_000);
  const state = newAdministrationState();
  onCleanup(async () => {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('Перед очисткой.png'), timeout: 3000 }).catch(() => {});
    await cleanupAdministration(page, state);
  });
  await recoverAdministration(page, state);
  await signIn(page);
  await test.step('Создать проект', () => createProject(page, state));
  await test.step('Создать группу и проверить её права', () => createUserGroup(page, state));
  await test.step('Создать пользователя и проверить доступ', () => createUser(page, state));
});
