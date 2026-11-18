import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

export const test = base.extend<{
  onCleanup: (action: () => Promise<void>) => void;
}>({
  onCleanup: [async ({ page }, use) => {
    const actions: (() => Promise<void>)[] = [];
    try {
      await use(action => { actions.push(action); });
    } finally {
      // Зависимость от page сохраняет браузер открытым до конца отдельного бюджета очистки.
      const errors: unknown[] = [];
      for (const action of actions.reverse()) {
        try {
          await action();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Ошибки очистки');
    }
  }, { timeout: 30_000 }],
});
