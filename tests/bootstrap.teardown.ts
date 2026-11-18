import { test } from './helpers/test';
import { cleanupBootstrap } from './helpers/bootstrap';

test.use({ actionTimeout: 10_000 });

test('Удалить тестового пользователя, группу и проект', { tag: '@bootstrap' }, async ({ page, onCleanup }, info) => {
  onCleanup(() => cleanupBootstrap(page, info));
});
