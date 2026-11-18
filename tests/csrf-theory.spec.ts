import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { browserJsonPost, startOriginPage } from './helpers/csrf';

test('Изменение профиля с чужой страницы: учебный пример', { tag: ['@scenario', '@csrf-theory'] }, async ({ page, context, browser }) => {
  let name = 'Оператор';
  let sessionActive = false;
  let posts = 0;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (request.url === '/login') {
      sessionActive = true;
      response.setHeader('Set-Cookie', 'demo_session=operator; Path=/; HttpOnly; SameSite=Strict');
      response.end('Вход выполнен');
    } else if (request.url === '/logout') {
      sessionActive = false;
      response.setHeader('Set-Cookie', 'demo_session=; Path=/; Max-Age=0');
      response.end('Выход выполнен');
    } else if (request.url === '/profile' && request.method === 'POST') {
      posts++;
      if (!sessionActive || !request.headers.cookie?.split('; ').includes('demo_session=operator')) {
        response.writeHead(401).end();
        return;
      }
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        name = JSON.parse(body).name;
        response.end('OK');
      });
    } else {
      response.end(name);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let attacker: Awaited<ReturnType<typeof startOriginPage>> | undefined;
  let otherSite: Awaited<ReturnType<typeof startOriginPage>> | undefined;
  try {
    const target = `http://localhost:${(server.address() as AddressInfo).port}`;
    attacker = await startOriginPage('localhost');
    otherSite = await startOriginPage('127.0.0.1');
    const body = JSON.stringify({ name: 'Новое имя' });
    await page.goto(`${target}/login`);
    const foreign = await context.newPage();
    await foreign.goto(otherSite.url);
    await browserJsonPost(foreign, `${target}/profile`, body, 'no-cors');
    expect(posts).toBe(1);
    await page.goto(`${target}/profile`);
    await expect(page.locator('body')).toHaveText('Оператор');
    await foreign.goto(attacker.url);
    expect(new URL(foreign.url()).origin).not.toBe(new URL(target).origin);
    await browserJsonPost(foreign, `${target}/profile`, body, 'no-cors');
    await page.goto(`${target}/profile`);
    await expect(page.locator('body')).toHaveText('Новое имя');

    name = 'Оператор';
    const anonymous = await browser.newContext();
    try {
      const visitor = await anonymous.newPage();
      await visitor.goto(attacker.url);
      await browserJsonPost(visitor, `${target}/profile`, body, 'no-cors');
      expect(posts).toBe(3);
      await page.reload();
      await expect(page.locator('body')).toHaveText('Оператор');
    } finally {
      await anonymous.close();
    }
    await page.goto(`${target}/logout`);
    await browserJsonPost(foreign, `${target}/profile`, body, 'no-cors');
    expect(posts).toBe(4);
    await page.goto(`${target}/profile`);
    await expect(page.locator('body')).toHaveText('Оператор');
  } finally {
    await attacker?.close();
    await otherSite?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
