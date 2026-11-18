import { expect, test, type Page, type Request } from '@playwright/test';
import { openMyProfile, openTestUserForm, readEditRights, restoreTestUserProfile, saveMyProfileName } from './helpers/access';
import { signIn, signInAsTest, signOut } from './helpers/scada';
import { browserJsonPost, startOriginPage } from './helpers/csrf';

for (const variant of [
  { title: 'другого Origin того же сайта', sameSite: true },
  { title: 'другого сайта', sameSite: false },
]) {
  test(`Защита профиля от страницы ${variant.title}`, { tag: ['@security', '@access', '@csrf', '@sec07', '@pentest', '@scenario'] }, async ({ page, context }) => {
    test.setTimeout(90_000);
    const marker = 'Проверка запроса';
    let role: 'admin' | 'operator' | 'none' = 'none';
    let original: { name: string; rights: Record<string, boolean> } | undefined;
    let attacker: Page | undefined;
    let originServer: Awaited<ReturnType<typeof startOriginPage>> | undefined;
    try {
      await signInAsTest(page);
      role = 'admin';
      const adminForm = await openTestUserForm(page);
      original = { name: await adminForm.locator('#name').inputValue(), rights: await readEditRights(adminForm) };
      expect(original.name).not.toBe(marker);
      await adminForm.locator('#form_cancel').click();
      await signOut(page);
      role = 'none';
      await signIn(page);
      role = 'operator';
      const source = await saveMyProfileName(page, marker);
      const payload = JSON.parse(source.postData() || '{}');
      if (payload.change_password || payload.password) throw new Error('Запрос изменяет пароль');
      const ordinary = ['login', 'name', 'e_mail', 'phone', 'default_mnemonic', 'is_access_code', 'default_type_access_code', 'change_password', 'password', 'default_project_id', 'telegram_chat_id', 'max_user_id'];
      expect(Object.keys(payload).filter(key => !ordinary.includes(key)), 'Чужой странице не передаются секретные маркеры').toEqual([]);
      const body = JSON.stringify(payload);
      await saveMyProfileName(page, original.name);
      await test.step('Проверить изменение имени со своей страницы', async () => {
        for (const ajax of [false, true]) {
          expect((await browserJsonPost(page, source.url(), body, 'same-origin', ajax)).status).toBe(200);
          const form = await openMyProfile(page);
          await expect(form.locator('#name')).toHaveValue(marker);
          await form.locator('#form_cancel').click();
          await saveMyProfileName(page, original!.name);
        }
      });
      const target = new URL(source.url());
      if (target.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(target.hostname)) throw new Error('Сценарий настроен только для локального HTTP-стенда');
      const host = variant.sameSite ? target.hostname : target.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
      originServer = await startOriginPage(host);
      const origin = new URL(originServer.url);
      attacker = await context.newPage();
      await attacker.goto(origin.href);
      expect(new URL(attacker.url()).origin).not.toBe(target.origin);
      let sent: Request | undefined;
      attacker.on('request', request => {
        if (request.method() === 'POST' && request.url() === source.url()) sent = request;
      });
      const result = await test.step('Отправить браузерный POST без токена и доступа к ответу', () => browserJsonPost(attacker!, source.url(), body, 'no-cors'));
      if (!sent) throw new Error('Браузер не отправил проверяемый POST');
      const headers = await sent.allHeaders();
      if (headers.origin) expect(headers.origin).toBe(origin.origin);
      expect(headers['x-requested-with']).toBeUndefined();
      let form = await openMyProfile(page);
      const simpleName = await form.locator('#name').inputValue();
      await form.locator('#form_cancel').click();
      expect.soft(simpleName, 'Простой запрос чужой страницы не должен менять имя').toBe(original.name);
      await signOut(page);
      role = 'none';
      await signInAsTest(page);
      role = 'admin';
      const simpleSaved = await openTestUserForm(page);
      await expect(simpleSaved.locator('#name')).toHaveValue(simpleName);
      await simpleSaved.locator('#form_cancel').click();
      await signOut(page);
      role = 'none';
      await signIn(page);
      role = 'operator';
      await saveMyProfileName(page, original.name);
      let preflight = false;
      attacker.on('request', request => {
        if (request.method() === 'OPTIONS' && request.url() === source.url()) preflight = true;
      });
      const ajax = await test.step('Заголовок XHR требует разрешения CORS со стороны сервера', () => browserJsonPost(attacker!, source.url(), body, 'cors', true));
      form = await openMyProfile(page);
      const observed = await form.locator('#name').inputValue();
      await form.locator('#form_cancel').click();
      await signOut(page);
      role = 'none';
      await signInAsTest(page);
      role = 'admin';
      const saved = await openTestUserForm(page);
      await expect(saved.locator('#name')).toHaveValue(observed);
      await saved.locator('#form_cancel').click();
      await test.info().attach('Проверка границы Origin', {
        body: JSON.stringify({ sameSite: variant.sameSite, requestOriginObserved: Boolean(headers.origin), cookieObserved: Boolean(headers.cookie), simpleResponseType: result.type, simpleNameChanged: simpleName !== original.name, ajaxResponseType: ajax.type, preflightObserved: preflight, nameChanged: observed !== original.name }),
        contentType: 'application/json',
      });
      expect(observed, 'XHR чужой страницы не должен менять профиль после отдельного сброса').toBe(original.name);
    } finally {
      await attacker?.close();
      await originServer?.close();
      for (const selector of ['#form_edit_my_data', '#form_edit_user']) {
        const form = page.locator(selector);
        if (await form.isVisible()) await form.locator('#form_cancel').click();
      }
      if (role === 'operator') {
        await signOut(page);
        role = 'none';
      }
      if (role === 'none') await signInAsTest(page);
      if (original) await restoreTestUserProfile(page, original);
    }
  });
}
