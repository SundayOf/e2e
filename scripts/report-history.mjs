import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';

const require = createRequire(import.meta.url);
const { yauzl } = require('playwright-core/lib/utilsBundle');

const marker = 'scada-playwright-html-v1';
const day = 86400000;
const executionContext = `${process.platform}:${hostname()}:${process.platform === 'linux' ? readlinkSync('/proc/self/ns/net') : 'host'}`;
const idPattern = /^\d{8}T\d{9}Z-[a-f0-9]{8}$/;
const defaultSettings = Object.freeze({ maxRuns: 20, passedDays: 7, failedDays: 30, keepBase: 5, maxBytes: 2 * 1024 ** 3, autoCleanup: true, protectLatest: true });
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
function save(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2));
  renameSync(temp, file);
}
export function inside(root, target) {
  const path = relative(resolve(root), resolve(target));
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error(`Unsafe report path: ${target}`);
  let current = resolve(root);
  for (let ancestor = current; ; ancestor = dirname(ancestor)) {
    if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) throw new Error(`Linked report root: ${ancestor}`);
    if (dirname(ancestor) === ancestor) break;
  }
  for (const part of path.split(sep)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Linked report path: ${current}`);
  }
}
function files(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Linked report artifact: ${path}`);
    if (entry.isDirectory()) result.push(...files(path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unsupported report artifact: ${path}`);
  }
  return result;
}

function directorySize(directory) {
  let bytes = 0;
  let unreadable = false;
  const visit = directory => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') unreadable = true; return; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) { unreadable = true; continue; }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        try { bytes += lstatSync(path).size; }
        catch (error) { if (error.code !== 'ENOENT') unreadable = true; }
      } else unreadable = true;
    }
  };
  visit(directory);
  return { bytes, unreadable };
}
function runs(root) {
  const directory = join(root, 'runs');
  if (!existsSync(directory)) return [];
  inside(root, directory);
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !idPattern.test(entry.name)) continue;
    const dir = join(directory, entry.name);
    try {
      inside(root, join(dir, 'run.json'));
      const data = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
      if (data.managedBy !== marker || data.id !== entry.name || !Number.isFinite(data.started)) continue;
      if (data.selection !== undefined && (!Array.isArray(data.selection) || data.selection.some(title => typeof title !== 'string'))) continue;
      if (data.name !== undefined && typeof data.name !== 'string') continue;
      result.push({ ...data, dir, pinned: existsSync(join(dir, '.keep')) });
    } catch { /* Unknown/damaged metadata is never a deletion target. */ }
  }
  return result.sort((a, b) => b.started - a.started || b.id.localeCompare(a.id));
}

export async function acquireLock(root) {
  mkdirSync(root, { recursive: true });
  const lock = join(root, '.active.json');
  inside(root, lock);
  // The OS releases this local mutex on process death; no stale-file takeover race.
  const key = process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root);
  const port = 40000 + parseInt(hash(key).slice(0, 8), 16) % 20000;
  const server = createServer(socket => socket.destroy());
  await new Promise((accept, reject) => {
    server.once('error', error => reject(new Error(`Report run is active or mutex port ${port} is unavailable: ${error.message}`)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, accept);
  });
  server.unref();
  const token = randomUUID();
  const temporary = join(root, `.lock-${token}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify({ pid: process.pid, token, port, context: executionContext }), { flag: 'wx' });
    try { linkSync(temporary, lock); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous;
      try { previous = JSON.parse(readFileSync(lock, 'utf8')); } catch { /* Unknown owner must be inspected manually. */ }
      if (previous?.context !== executionContext) throw new Error('Shared report lock has an unknown/foreign owner; inspect .active.json before removing it.');
      // TCP ownership excludes every live writer in this execution context.
      rmSync(lock);
      linkSync(temporary, lock);
    }
  } catch (error) { server.close(); throw error; }
  finally { rmSync(temporary, { force: true }); }
  return async () => {
    if (existsSync(lock)) {
      const owner = JSON.parse(readFileSync(lock, 'utf8'));
      if (owner.token === token) rmSync(lock);
    }
    if (server.listening) await new Promise(accept => server.close(accept));
  };
}

export function recoverRuns(root) {
  for (const item of runs(root)) {
    if (item.status !== 'running') continue;
    const { dir, pinned, ...data } = item;
    save(join(dir, 'run.json'), { ...data, status: 'interrupted', ended: Date.now() });
  }
}

async function validateHtml(dir) {
  const html = readFileSync(join(dir, 'html', 'index.html'), 'utf8');
  const payload = html.match(/<template id="playwrightReportBase64">data:application\/zip;base64,([A-Za-z0-9+/=]+)<\/template>\s*$/);
  if (!payload) throw new Error('HTML report is incomplete; raw results preserved.');
  const zip = await new Promise((accept, reject) => yauzl.fromBuffer(Buffer.from(payload[1], 'base64'), { lazyEntries: true }, (error, archive) => error ? reject(error) : accept(archive)));
  const entries = new Map();
  await new Promise((accept, reject) => {
    zip.on('error', reject);
    zip.on('end', accept);
    zip.on('entry', entry => zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      stream.on('error', reject);
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        try { entries.set(entry.fileName, JSON.parse(Buffer.concat(chunks).toString('utf8'))); zip.readEntry(); }
        catch (error) { reject(error); }
      });
    }));
    zip.readEntry();
  });
  const report = entries.get('report.json');
  if (!Array.isArray(report?.files) || report.files.some(file => !entries.has(`${file.fileId}.json`))) throw new Error('HTML report payload is incomplete; raw results preserved.');
}

export async function archiveResults(dir, output, attachments) {
  inside(dir, output);
  if (!existsSync(join(dir, 'html', 'index.html'))) throw new Error('HTML report is missing; raw results preserved.');
  await validateHtml(dir);
  const sources = existsSync(output) ? files(output) : [];
  const attached = new Set();
  for (const source of new Set(attachments)) {
    const bytes = readFileSync(source);
    // Playwright 1.64 HTML reporter names file attachments by SHA-1 + extension.
    const target = join(dir, 'html', 'data', hash(bytes, 'sha1') + extname(source));
    inside(dir, target);
    if (hash(readFileSync(target)) !== hash(bytes)) throw new Error(`HTML attachment verification failed: ${target}`);
    attached.add(resolve(source));
  }
  for (const source of sources) {
    if (attached.has(resolve(source))) continue;
    const target = join(dir, 'html', 'extra', relative(output, source));
    inside(dir, target);
    mkdirSync(resolve(target, '..'), { recursive: true });
    copyFileSync(source, target);
    if (hash(readFileSync(source)) !== hash(readFileSync(target))) throw new Error(`Extra artifact verification failed: ${target}`);
  }
  if (existsSync(output)) {
    inside(dir, output);
    files(output);
    rmSync(output, { recursive: true });
  }
}

export function getSettings(root) {
  const file = join(root, 'settings.json');
  inside(root, file);
  return existsSync(file) ? validateSettings(JSON.parse(readFileSync(file, 'utf8'))) : { ...defaultSettings };
}

function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== Object.keys(defaultSettings).length) throw new Error('Неверный формат настроек.');
  for (const [key, fallback] of Object.entries(defaultSettings)) {
    if (typeof fallback === 'boolean') {
      if (typeof value[key] !== 'boolean') throw new Error(`Неверное значение ${key}.`);
    } else if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error(`Значение ${key} должно быть целым числом от нуля.`);
  }
  return { ...value };
}

export function updateSettings(root, settings) {
  const value = validateSettings(settings);
  const file = join(root, 'settings.json');
  inside(root, file);
  save(file, value);
  return value;
}

export function planHistory(root, overrides = {}) {
  const { now = Date.now(), ...custom } = overrides;
  const settings = { ...getSettings(root), ...custom };
  const { maxRuns, maxBytes, passedDays, failedDays, keepBase, protectLatest } = settings;
  const history = runs(root);
  const protectedIds = new Set([...(protectLatest ? [history[0]?.id] : []), ...history.filter(r => r.kind === 'base').slice(0, keepBase).map(r => r.id)]);
  const measured = history.map((item, index) => {
    const { bytes, unreadable } = directorySize(item.dir);
    const protectedRun = protectedIds.has(item.id) || item.pinned || item.status === 'running' || unreadable;
    return { ...item, index, bytes, protectedRun };
  });
  const removed = new Set();
  for (const item of measured) {
    const days = item.status === 'passed' ? passedDays : failedDays;
    if (!item.protectedRun && ((maxRuns > 0 && item.index >= maxRuns) || (days > 0 && now - item.started > days * day))) removed.add(item.id);
  }
  let bytes = measured.filter(r => !removed.has(r.id)).reduce((sum, r) => sum + r.bytes, 0);
  for (const item of [...measured].reverse()) {
    if (maxBytes === 0 || bytes <= maxBytes) break;
    if (item.protectedRun || removed.has(item.id)) continue;
    removed.add(item.id);
    bytes -= item.bytes;
  }
  return { removed: [...removed], bytes, overBudget: maxBytes > 0 && bytes > maxBytes };
}

export function deleteRuns(root, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || ids.some(id => typeof id !== 'string')) throw new Error('Не выбраны прогоны.');
  const history = runs(root);
  const selected = [...new Set(ids)].map(id => {
    const item = history.find(r => r.id === id);
    if (!item) throw new Error(`Прогон не найден: ${id}`);
    if (item.pinned || item.status === 'running') throw new Error('Закреплённый или выполняющийся прогон удалить нельзя.');
    inside(root, item.dir);
    files(item.dir);
    return item;
  });
  for (const item of selected) rmSync(item.dir, { recursive: true });
}

export function pruneHistory(root, overrides) {
  const plan = planHistory(root, overrides);
  if (plan.removed.length) deleteRuns(root, plan.removed);
  return plan;
}

export function historyState(root) {
  const history = runs(root).map(item => {
    let { bytes, unreadable } = directorySize(item.dir);
    const extra = join(item.dir, 'html', 'extra');
    const downloads = [];
    try {
      if (existsSync(extra)) for (const file of files(extra)) {
        const name = relative(extra, file).split(sep).join('/');
        if (name === '.last-run.json') continue;
        downloads.push({ name, bytes: lstatSync(file).size, url: `/runs/${item.id}/html/extra/${name.split('/').map(encodeURIComponent).join('/')}` });
      }
    } catch { unreadable = true; }
    const { dir, ...data } = item;
    return { ...data, bytes, unreadable, downloads, reportUrl: existsSync(join(item.dir, 'html', 'index.html')) ? `/runs/${item.id}/html/index.html` : null };
  });
  const savedBytes = history.filter(item => item.status !== 'running').reduce((sum, item) => sum + item.bytes, 0);
  const temporaryBytes = history.filter(item => item.status === 'running').reduce((sum, item) => sum + item.bytes, 0);
  return { settings: getSettings(root), runs: history, bytes: savedBytes + temporaryBytes, savedBytes, temporaryBytes, unreadable: history.some(item => item.unreadable) };
}

export function writeIndex(root) {
  for (const name of ['index.html', 'app.css', 'app.js']) {
    const target = join(root, name);
    inside(root, target);
    const source = fileURLToPath(new URL(`./report-ui/${name}`, import.meta.url));
    if (existsSync(target) && readFileSync(target).equals(readFileSync(source))) continue;
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      copyFileSync(source, temporary);
      renameSync(temporary, target);
    } finally { rmSync(temporary, { force: true }); }
  }
}

export async function startRun(options) {
  const release = await acquireLock(options.root);
  process.once('exit', release);
  try {
    recoverRuns(options.root);
    mkdirSync(options.runDir, { recursive: true });
    inside(options.root, options.runDir);
    let revision = '';
    try {
      revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) revision += ' + изменения';
    } catch { /* Docker may not include Git. */ }
    save(join(options.runDir, 'run.json'), { managedBy: marker, id: options.runDir.split(sep).at(-1), started: Date.now(), status: 'running', kind: options.kind, revision });
    writeIndex(options.root);
  } catch (error) { await release(); throw error; }
}

export function isFullBase(tests, configFile) {
  tests = tests.filter(t => !t.tags.some(tag => tag.replace(/^@/, '') === 'bootstrap'));
  if (!tests.length || tests.some(t => !t.tags.some(tag => tag.replace(/^@/, '') === 'base'))) return false;
  const discovery = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', configFile, '--grep', '@base', '--list', '--reporter=json'], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 ** 2 });
  if (discovery.status !== 0) throw new Error('Cannot classify full-base report: test discovery failed.');
  const ids = [];
  const collect = suites => { for (const suite of suites) { for (const spec of suite.specs || []) { if (spec.tags?.some(tag => tag.replace(/^@/, '') === 'base')) for (const item of spec.tests) ids.push(spec.id); } collect(suite.suites || []); } };
  collect(JSON.parse(discovery.stdout).suites);
  return tests.length === ids.length && tests.every(t => ids.includes(t.id));
}

export function runName(tests, kind) {
  if (kind === 'base') return 'Полная база';
  if (!tests.length) return 'Выборочные проверки';
  if (tests.length === 1) return tests[0].title;
  const sections = [
    ['tagtable', 'Таблицы тегов'], ['formula', 'Формулы'], ['tags', 'Теги'],
    ['alarm', 'Аварии'], ['trigger', 'Триггеры'], ['trend', 'Тренды'],
    ['tree', 'Дерево проекта'], ['layout', 'Компоновщики'], ['mnemonic', 'Мнемосхемы'],
    ['menu', 'Меню'], ['files', 'Файлы'], ['settings', 'Настройки'],
    ['camera', 'Камеры'], ['map', 'Карты'], ['access', 'Доступ'],
    ['guide', 'Руководство'], ['project', 'Проект'], ['jobs', 'Отчёты и планировщики'],
  ];
  const tags = tests.map(test => new Set(test.tags.map(tag => tag.replace(/^@/, ''))));
  return sections.find(([tag]) => tags.every(set => set.has(tag)))?.[1] || 'Выборочные проверки';
}

export function setPinned(root, id, pinned) {
  const history = runs(root);
  const item = id === 'latest' ? history[0] : history.find(r => r.id === id);
  if (!item) throw new Error(`Unknown report: ${id}`);
  const file = join(item.dir, '.keep');
  inside(root, file);
  if (pinned) writeFileSync(file, 'Protected from automatic retention\n');
  else rmSync(file, { force: true });
  return item.id;
}

export default class HistoryReporter {
  constructor(options) { this.options = options; this.attachments = []; this.skipped = 0; }
  version() { return 'v2'; }
  onConfigure(config) { this.output = config.projects[0].outputDir; this.configFile = config.configFile; }
  onBegin(suite) {
    const tests = suite.allTests();
    this.total = tests.length;
    this.selection = tests.map(t => t.title);
    this.kind = isFullBase(tests, this.configFile) ? 'base' : 'selection';
    this.name = runName(tests, this.kind);
    const manifest = join(this.options.runDir, 'run.json');
    if (existsSync(manifest)) {
      const data = JSON.parse(readFileSync(manifest, 'utf8'));
      save(manifest, { ...data, name: this.name, kind: this.kind, total: this.total, selection: this.selection });
    }
  }
  onTestEnd(test, result) {
    this.attachments.push(...result.attachments.filter(a => a.path).map(a => a.path));
    if (result.status === 'skipped') this.skipped++;
  }
  onEnd(result) {
    this.status = result.status === 'passed' && this.total > 0 && this.skipped === this.total ? 'skipped' : result.status;
  }
  async onExit() {
    const { root, runDir } = this.options;
    const manifest = join(runDir, 'run.json');
    if (!existsSync(manifest)) return;
    const data = JSON.parse(readFileSync(manifest, 'utf8'));
    try { await archiveResults(runDir, this.output, this.attachments); }
    catch (error) { data.archiveError = error.message; console.error(`[reports] ${error.message}`); }
    save(manifest, { ...data, status: this.status || 'interrupted', ended: Date.now(), total: this.total, kind: this.kind || 'selection', name: this.name, selection: this.selection });
    const result = getSettings(root).autoCleanup ? pruneHistory(root) : { removed: [], bytes: historyState(root).bytes };
    console.log(`[reports] ${relative(process.cwd(), runDir)}; removed=${result.removed.length}; ${(result.bytes / 1024 ** 2).toFixed(1)} MiB${result.overBudget ? ' — protected data exceeds budget' : ''}`);
    console.log(`[reports] Open archived report: npx playwright show-report "${relative(process.cwd(), join(runDir, 'html'))}"`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, id] = process.argv.slice(2);
  const root = resolve('reports/history');
  if (!['pin', 'unpin', 'prune'].includes(command)) throw new Error('Use pin <run-id|latest>, unpin <run-id|latest> or prune');
  const release = await acquireLock(root);
  try {
    recoverRuns(root);
    if (command === 'prune') console.log(pruneHistory(root));
    else console.log(`${command}: ${setPinned(root, id, command === 'pin')}`);
  } finally { await release(); }
}
