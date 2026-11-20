import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { acquireLock, deleteRuns, historyState, inside, planHistory, recoverRuns, setPinned, updateSettings, writeIndex } from './report-history.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.zip': 'application/zip', '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };

function preview(root) {
  const plan = planHistory(root);
  const state = historyState(root);
  const candidates = state.runs.filter(run => plan.removed.includes(run.id));
  const token = createHash('sha256').update(JSON.stringify({ settings: state.settings, ids: candidates.map(run => [run.id, run.bytes, run.pinned]) })).digest('hex');
  return { token, candidates, freedBytes: candidates.reduce((sum, run) => sum + run.bytes, 0), overBudget: plan.overBudget };
}

async function body(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 65536) throw new Error('Слишком большой запрос.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createReportServer({ root = resolve('reports/history') } = {}) {
  root = resolve(root);
  mkdirSync(root, { recursive: true });
  writeIndex(root);
  const sessionToken = randomUUID();
  const server = createServer(async (request, response) => {
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    try {
      const host = request.headers.host;
      if (!host || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${host}`).hostname)) return json(403, { error: 'Недопустимый адрес сервера.' });
      const url = new URL(request.url, `http://${host}`);
      if (url.pathname === '/api/state' && request.method === 'GET') {
        let state = historyState(root);
        if (state.runs.some(run => run.status === 'running')) {
          let release;
          try { release = await acquireLock(root); } catch { /* The writer still owns the history. */ }
          if (release) {
            try { recoverRuns(root); state = historyState(root); }
            finally { await release(); }
          }
        }
        return json(200, { ...state, token: sessionToken });
      }
      if (url.pathname.startsWith('/api/')) {
        if (request.method !== 'POST') return json(405, { error: 'Метод не поддерживается.' });
        if (request.headers.origin !== `http://${host}` || request.headers['x-report-token'] !== sessionToken || request.headers['content-type'] !== 'application/json') return json(403, { error: 'Запрос отклонён. Обновите страницу.' });
        const data = await body(request);
        let release;
        try { release = await acquireLock(root); }
        catch { return json(409, { error: 'История занята другим процессом. Дождитесь завершения прогона.' }); }
        try {
          recoverRuns(root);
          switch (url.pathname) {
            case '/api/settings': updateSettings(root, data); break;
            case '/api/pin':
              if (typeof data.pinned !== 'boolean' || typeof data.id !== 'string') throw new Error('Не выбран прогон.');
              setPinned(root, data.id, data.pinned); break;
            case '/api/delete': deleteRuns(root, data.ids); break;
            case '/api/cleanup-preview': return json(200, preview(root));
            case '/api/cleanup': {
              const plan = preview(root);
              if (data.token !== plan.token) return json(409, { error: 'Список изменился. Повторите просмотр очистки.' });
              if (plan.candidates.length) deleteRuns(root, plan.candidates.map(run => run.id));
              break;
            }
            default: return json(404, { error: 'Действие не найдено.' });
          }
          json(200, { ok: true });
        } finally { await release(); }
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) return json(405, { error: 'Метод не поддерживается.' });
      let file;
      let rawAttachment = false;
      if (['/', '/index.html', '/app.css', '/app.js'].includes(url.pathname)) {
        file = join(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      } else {
        const pathname = decodeURIComponent(url.pathname);
        const attachmentRoute = pathname.match(/^\/runs\/(\d{8}T\d{9}Z-[a-f0-9]{8})\/attachments\/\d+\/\d+$/);
        if (attachmentRoute) {
          const run = historyState(root).runs.find(run => run.id === attachmentRoute[1]);
          const attachment = run?.tests?.flatMap(test => test.attachments).find(attachment => attachment.url === pathname);
          if (!attachment) return json(404, { error: 'Файл не найден.' });
          file = resolve(root, 'runs', run.id, attachment.path);
          inside(join(root, 'runs', run.id, 'results'), file);
          rawAttachment = true;
        } else {
          if (!/^\/runs\/\d{8}T\d{9}Z-[a-f0-9]{8}\/html\//.test(pathname)) return json(404, { error: 'Файл не найден.' });
          file = resolve(root, `.${pathname}`);
          inside(join(root, 'runs', pathname.split('/')[2], 'html'), file);
        }
      }
      inside(root, file);
      if (!existsSync(file) || !statSync(file).isFile()) return json(404, { error: 'Файл не найден.' });
      const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      const canonical = relative(root, file).split(sep).join('/');
      if (rawAttachment || /^runs\/[^/]+\/html\/(extra|data)\//i.test(canonical)) headers['Content-Security-Policy'] = 'sandbox';
      if (rawAttachment || /^runs\/[^/]+\/html\/extra\//i.test(canonical)) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(file.split(/[\\/]/).at(-1)).replace(/'/g, '%27')}`;
      response.writeHead(200, headers);
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      if (!response.headersSent) json(400, { error: error.message });
      else response.destroy();
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const port = Number(option('--port', '9323'));
  const host = option('--host', '127.0.0.1');
  const root = resolve(option('--root', 'reports/history'));
  const server = createReportServer({ root });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`http://127.0.0.1:${server.address().port}`));
}
