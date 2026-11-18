import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';

export async function startOriginPage(host: string) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Проверка Origin</title>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://${host}:${(server.address() as AddressInfo).port}/csrf.html`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

export async function browserJsonPost(page: Page, url: string, body: string, mode: 'same-origin' | 'no-cors' | 'cors', ajax = false) {
  return page.evaluate(async args => {
    try {
      const response = await fetch(args.url, {
        method: 'POST', mode: args.mode, credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...(args.ajax ? { 'X-Requested-With': 'XMLHttpRequest' } : {}) }, body: args.body,
        signal: AbortSignal.timeout(10_000),
      });
      return { status: response.status, type: response.type };
    } catch (error) {
      if (error instanceof TypeError) return { status: 0, type: 'blocked', reason: error.message };
      throw error;
    }
  }, { url, body, mode, ajax });
}
