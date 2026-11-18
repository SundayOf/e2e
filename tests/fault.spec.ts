import { expect, test, type WebSocketRoute } from '@playwright/test';
import { ensureProject, openProject, projectName, signIn } from './helpers/scada';

test('Потеря связи и восстановление после обновления страницы', { tag: ['@fault', '@base'] }, async ({ page }) => {
  test.setTimeout(40_000);
  let socket: WebSocketRoute | undefined;
  let disconnect = false;
  await page.routeWebSocket(url => url.hostname === new URL(page.url()).hostname, route => {
    if (disconnect) return route.close();
    socket = route;
    route.connectToServer();
  });

  await signIn(page);
  await ensureProject(page, projectName);
  await openProject(page, projectName);

  const overlay = page.locator('#connected_server_fade');
  await expect(overlay).toHaveCount(0);
  if (!socket) throw new Error('SCADA WebSocket was not opened');
  disconnect = true;
  await socket.close();
  await expect(overlay).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#connected_server_msg')).toContainText('Соединение с сервером');

  disconnect = false;
  await page.reload();
  await expect(overlay).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { os: { wsocket: { ws: WebSocket } } }).os.wsocket.ws.readyState)).toBe(WebSocket.OPEN);
  await expect(page.locator('#prjName').getByText(projectName, { exact: true })).toBeVisible();
});
