import { expect, type Page, type Request } from '@playwright/test';

export const scriptMarkers = [
  '<svg data-scada-probe onload=__scadaXss()>',
  '"><svg data-scada-probe onload=__scadaXss()>',
];

export async function watchScriptMarker(page: Page) {
  let calls = 0;
  await page.exposeFunction('__scadaXss', () => { calls++; });
  // Проверяем канал наблюдения до ввода маркеров; binding сохраняется после навигации.
  await page.evaluate('window.__scadaXss()');
  expect(calls).toBe(1);
  calls = 0;
  return async () => {
    await expect.soft(page.locator('svg[data-scada-probe]'), 'Маркер не должен становиться HTML-элементом').toHaveCount(0);
    expect.soft(calls, 'Сохранённое текстовое поле не должно выполнять JavaScript').toBe(0);
  };
}

export async function replayUiPost(page: Pick<Page, 'request'>, request: Request, url: string, body = request.postDataBuffer()) {
  expect(request.method()).toBe('POST');
  if (!body) throw new Error('В исходном запросе отсутствует тело');
  const contentType = await request.headerValue('content-type');
  return page.request.post(url, {
    data: body,
    headers: {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      'X-Requested-With': 'XMLHttpRequest',
    },
    maxRedirects: 0,
  });
}
