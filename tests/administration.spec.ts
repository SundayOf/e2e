import { test } from './helpers/test';
import { cleanupAdministration, createUserGroup, createProject, createUser, newAdministrationState } from './helpers/administration';
import { signIn } from './helpers/scada';

test.use({ actionTimeout: 10_000 });

for (const kind of ['project', 'group', 'user'] as const) {
  const titles = {
    project: 'Создание и удаление проекта',
    group: 'Создание группы с правами',
    user: 'Создание пользователя и выдача доступа к проекту',
  };
  const sections = { project: '@project', group: '@groups', user: '@users' };
  test(titles[kind], { tag: ['@base', '@access', sections[kind]] }, async ({ page, onCleanup }, info) => {
    test.setTimeout(90_000);
    const state = newAdministrationState();
    onCleanup(async () => {
      if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('Перед очисткой.png'), timeout: 3000 }).catch(() => {});
      await cleanupAdministration(page, state);
    });
    await signIn(page);
    if (kind !== 'group') await createProject(page, state);
    if (kind !== 'project') await createUserGroup(page, state);
    if (kind === 'user') await createUser(page, state);
  });
}
