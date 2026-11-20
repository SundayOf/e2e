import { expect, test } from './helpers/test';
import { getTestGroup, openMyProfile, openTestUserForm, readEditRights, restoreTestUserProfile, saveMyProfileName, setTestGroup } from './helpers/access';
import { openProject, projectName, signIn, signInAsAdmin, signOut } from './helpers/scada';
import { replayUiPost } from './helpers/security';

for (const field of [
  { id: 'enable_edit_config', title: 'настройка проекта' },
  { id: 'enable_edit_right', title: 'управление правами' },
]) {
  test(`Запрет выдачи себе права «${field.title}» через профиль`, { tag: ['@security', '@access', '@rights', '@sec05', '@mixed', '@permissions'] }, async ({ page, onCleanup }) => {
    test.setTimeout(90_000);
    let role: 'admin' | 'operator' | 'none' = 'none';
    let initialGroup: boolean | undefined;
    let original: { name: string; rights: Record<string, boolean> } | undefined;
    const marker = 'Проверка профиля';
    onCleanup(async () => {
      for (const selector of ['#form_edit_my_data', '#form_edit_user']) {
        const form = page.locator(selector);
        if (await form.isVisible()) await form.locator('#form_cancel').click();
      }
      if (role === 'operator') {
        await signOut(page);
        role = 'none';
      }
      if (role === 'none') await signInAsAdmin(page);
      try {
        if (original) await restoreTestUserProfile(page, original);
      } finally {
        if (initialGroup !== undefined) {
          await setTestGroup(page, initialGroup);
          expect(await getTestGroup(page)).toBe(initialGroup);
        }
      }
    });
    await signInAsAdmin(page);
    role = 'admin';
    initialGroup = await getTestGroup(page);
    const form = await openTestUserForm(page);
    const rights = await readEditRights(form);
    const name = await form.locator('#name').inputValue();
    expect(Object.keys(rights)).toContain(field.id);
    expect(Object.values(rights).every(value => !value), 'Личные права исходной роли должны быть выключены').toBe(true);
    expect(name).not.toBe(marker);
    original = { name, rights };
    await form.locator('#form_cancel').click();
    await setTestGroup(page, false);
    expect(await getTestGroup(page)).toBe(false);
    await signOut(page);
    role = 'none';
    await signIn(page);
    role = 'operator';
    await openProject(page, projectName);
    await expect(page.locator('#panel_right [title="Пользователи"]')).toBeHidden();
    const source = await test.step('Разрешённое изменение профиля сохраняется без группы', () => saveMyProfileName(page, marker));
    const payload = JSON.parse(source.postData() || '{}');
    if (payload.change_password || payload.password) throw new Error('Остановлено: запрос профиля изменяет пароль');
    expect(payload).not.toHaveProperty(field.id);
    await saveMyProfileName(page, original.name);
    await test.step('Повторить разрешённый запрос изменения имени', async () => {
      const positive = await replayUiPost(page, source, source.url());
      expect(positive.ok()).toBe(true);
      expect((await positive.json()).error).toBeFalsy();
      const saved = await openMyProfile(page);
      await expect(saved.locator('#name')).toHaveValue(marker);
      await saved.locator('#form_cancel').click();
    });
    await saveMyProfileName(page, original.name);
    const response = await test.step('Добавить один недоступный флаг к корректному запросу', () =>
      replayUiPost(page, source, source.url(), Buffer.from(JSON.stringify({ ...payload, [field.id]: 1 }))));
    await test.info().attach('Ответ на добавление поля права', { body: `${field.id}: ${response.status()}`, contentType: 'text/plain' });
    expect.soft(response.status(), 'Лишнее поле не должно приводить к ошибке сервера').toBeLessThan(500);
    await signOut(page);
    role = 'none';
    await signInAsAdmin(page);
    role = 'admin';
    await test.step('Проверить имя и права от имени администратора', async () => {
      const saved = await openTestUserForm(page);
      expect.soft(await readEditRights(saved)).toEqual(original!.rights);
      expect([original!.name, marker]).toContain(await saved.locator('#name').inputValue());
      await saved.locator('#form_cancel').click();
    });
    await signOut(page);
    role = 'none';
    await signIn(page);
    role = 'operator';
    await openProject(page, projectName);
    await expect(page.locator('#panel_right [title="Пользователи"]')).toBeHidden();
  });
}
