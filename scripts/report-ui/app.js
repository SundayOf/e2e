const $ = selector => document.querySelector(selector);
const labels = { passed: 'Пройден', failed: 'Ошибка', timedout: 'Таймаут', interrupted: 'Прерван', running: 'Выполняется', skipped: 'Пропущен' };
const filters = [
  ['all', 'Все', () => true],
  ['passed', 'Успешные', run => run.status === 'passed'],
  ['failed', 'С ошибками', run => ['failed', 'timedout'].includes(run.status)],
  ['interrupted', 'Прерванные', run => run.status === 'interrupted'],
  ['skipped', 'Пропущенные', run => run.status === 'skipped'],
  ['pinned', 'Закреплённые', run => run.pinned],
];
let state;
let filter = 'all';
let pendingAction;
let refreshId = 0;
let snapshot;

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
function syncTheme() {
  const theme = localStorage.getItem('theme');
  const dark = theme === 'dark-mode' || (theme !== 'light-mode' && systemTheme.matches);
  document.documentElement.classList.toggle('dark-mode', dark);
}
syncTheme();
systemTheme.addEventListener('change', syncTheme);
window.addEventListener('storage', syncTheme);
window.addEventListener('pageshow', syncTheme);
window.addEventListener('focus', syncTheme);

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function size(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} ГиБ`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} МиБ`;
  return `${(bytes / 1024).toFixed(1)} КиБ`;
}

function runTitle(run) {
  if (run.kind === 'base') return 'Полная база';
  if (run.name) return run.name;
  if (run.selection?.length === 1) return run.selection[0];
  return 'Выборочные проверки';
}

function notice(text, error = false) {
  $('#notice').textContent = text;
  $('#notice').className = error ? 'error' : '';
}

async function request(path, data) {
  const options = data === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Report-Token': state.token },
    body: JSON.stringify(data),
  };
  const response = await fetch(`/api/${path}`, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос.');
  return result;
}

async function refresh() {
  const id = ++refreshId;
  const next = await request('state');
  if (id !== refreshId) return;
  const nextSnapshot = JSON.stringify(next);
  if (nextSnapshot === snapshot) return;
  snapshot = nextSnapshot;
  state = next;
  $('#settings').disabled = false;
  $('#cleanup').disabled = false;
  render();
}

function button(text, action, className) {
  const node = element('button', text, className);
  node.addEventListener('click', async () => {
    node.disabled = true;
    try { await action(); }
    catch (error) { notice(error.message, true); }
    finally { node.disabled = false; }
  });
  return node;
}

function render() {
  if (!state) return;
  const focused = document.activeElement?.dataset.focus;
  $('#filters').replaceChildren(...filters.map(([key, title, matches]) => {
    const node = button(title, () => { filter = key; render(); }, key === filter ? 'active' : '');
    node.setAttribute('aria-pressed', String(key === filter));
    node.dataset.focus = `filter-${key}`;
    node.append(element('span', state.runs.filter(matches).length, 'count'));
    return node;
  }));
  const max = state.settings.maxBytes;
  $('#storage-label').textContent = `${size(state.bytes)} / ${max ? size(max) : 'без лимита'}`;
  const scale = Math.max(max, state.bytes, 1);
  $('#storage-saved').style.width = `${state.savedBytes / scale * 100}%`;
  $('#storage-temporary').style.width = `${state.temporaryBytes / scale * 100}%`;
  $('#saved-size').textContent = size(state.savedBytes);
  $('#temporary-size').textContent = size(state.temporaryBytes);
  $('#storage-progress').setAttribute('aria-valuemax', String(max || scale));
  $('#storage-progress').setAttribute('aria-valuenow', String(Math.min(state.bytes, max || scale)));
  $('#storage-progress').setAttribute('aria-valuetext', `Отчёты: ${size(state.savedBytes)}. Временные: ${size(state.temporaryBytes)}.`);
  $('#storage-progress').className = max && state.bytes > max ? 'over' : '';
  $('#storage-progress').title = state.unreadable ? 'Некоторые файлы недоступны; размер неполный.' : 'Место, занятое историей отчётов';
  const query = $('#search').value.trim().toLowerCase();
  const matches = filters.find(([key]) => key === filter)[2];
  const visible = state.runs.filter(run => matches(run) && `${runTitle(run)} ${run.id} ${(run.selection || []).join(' ')} ${run.revision || ''}`.toLowerCase().includes(query));
  const expanded = new Set([...document.querySelectorAll('.run details[open]')].map(node => node.closest('.run').dataset.id));
  $('#runs').replaceChildren(...visible.map(runCard));
  for (const card of document.querySelectorAll('.run')) if (expanded.has(card.dataset.id)) card.querySelector('details').open = true;
  if (!visible.length) $('#runs').append(element('div', 'Прогоны не найдены', 'empty'));
  if (focused) {
    const target = [...document.querySelectorAll('[data-focus]')].find(node => node.dataset.focus === focused);
    (target || $('#search')).focus({ preventScroll: true });
  }
}

function runCard(run) {
  const card = element('article', undefined, 'run');
  card.dataset.id = run.id;
  const header = element('div', undefined, 'run-header');
  const symbol = run.status === 'passed' ? '✓' : run.status === 'running' ? '◷' : run.status === 'skipped' ? '−' : '×';
  const icon = element('span', symbol, `status-icon ${run.status}`);
  if (['failed', 'timedout'].includes(run.status)) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z');
    svg.append(path);
    icon.replaceChildren(svg);
  }
  icon.title = labels[run.status] || run.status;
  const main = element('div', undefined, 'run-main');
  const title = runTitle(run);
  const name = element(run.reportUrl ? 'a' : 'span', title, 'run-title');
  if (run.reportUrl) name.href = run.reportUrl;
  name.dataset.focus = `${run.id}-open`;
  const meta = element('div', undefined, 'run-meta');
  for (const text of [new Date(run.started).toLocaleString('ru-RU'), labels[run.status] || run.status, run.total === undefined ? null : `Тестов: ${run.total}`, size(run.bytes)]) {
    if (text) meta.append(element('span', text));
  }
  if (run.pinned) meta.append(element('span', 'Закреплён', 'pinned'));
  main.append(name, meta);
  const actions = element('div', undefined, 'run-actions');
  const pin = button(run.pinned ? 'Открепить' : 'Закрепить', async () => {
    await request('pin', { id: run.id, pinned: !run.pinned });
    await refresh();
  });
  pin.dataset.focus = `${run.id}-pin`;
  actions.append(pin);
  const remove = button('Удалить', () => confirmDeletion([run], () => request('delete', { ids: [run.id] })));
  remove.dataset.focus = `${run.id}-delete`;
  remove.disabled = run.pinned || run.status === 'running';
  if (remove.disabled) remove.title = run.pinned ? 'Сначала открепите прогон' : 'Прогон ещё выполняется';
  actions.append(remove);
  header.append(icon, main, actions);
  const details = element('details');
  const summary = element('summary', 'Сведения');
  summary.dataset.focus = `${run.id}-details`;
  details.append(summary);
  const content = element('div', undefined, 'details-body');
  content.append(element('code', run.id));
  if (run.revision) content.append(element('p', `Версия: ${run.revision}`));
  if (run.archiveError) content.append(element('p', `Архивирование: ${run.archiveError}`, 'failed'));
  if (run.unreadable) content.append(element('p', 'Часть файлов недоступна. Автоочистка этот прогон не удалит.', 'failed'));
  if (run.selection?.length && (run.selection.length > 1 || run.selection[0] !== title)) {
    const list = element('ul');
    for (const title of run.selection) list.append(element('li', title));
    content.append(list);
  }
  if (run.downloads.length) {
    content.append(element('strong', 'Сохранённые файлы'));
    const list = element('ul');
    for (const file of run.downloads) {
      const link = element('a', `${file.name} (${size(file.bytes)})`);
      link.href = file.url;
      link.dataset.focus = `${run.id}-file-${file.name}`;
      link.download = file.name.split('/').at(-1);
      const row = element('li');
      row.append(link);
      list.append(row);
    }
    content.append(list);
  }
  details.append(content);
  card.append(header, details);
  return card;
}

function confirmDeletion(runs, action, text) {
  $('#confirm-title').textContent = runs.length === 1 ? 'Удалить прогон?' : `Удалить прогоны: ${runs.length}?`;
  $('#confirm-text').textContent = text || `Будут удалены отчёты и файлы этих прогонов: ${size(runs.reduce((sum, run) => sum + run.bytes, 0))}.`;
  $('#confirm-list').replaceChildren(...runs.map(run => element('li', `${new Date(run.started).toLocaleString('ru-RU')} · ${runTitle(run)}`)));
  $('#confirm-dialog .form-error').textContent = '';
  pendingAction = action;
  $('#confirm-dialog').showModal();
}

$('#search').addEventListener('input', () => render());
$('#refresh').addEventListener('click', () => refresh().catch(error => notice(error.message, true)));
for (const close of document.querySelectorAll('dialog .close, dialog .cancel')) close.addEventListener('click', () => close.closest('dialog').close());

$('#settings').addEventListener('click', () => {
  const form = $('#settings-form');
  for (const [key, value] of Object.entries(state.settings)) {
    if (key === 'maxBytes') form.elements.maxGiB.value = (value / 1024 ** 3).toFixed(2);
    else if (typeof value === 'boolean') form.elements[key].checked = value;
    else form.elements[key].value = value;
  }
  form.querySelector('.form-error').textContent = '';
  $('#settings-dialog').showModal();
});

$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = {};
  for (const [key, value] of Object.entries(state.settings)) {
    if (key === 'maxBytes') values[key] = Math.round(Number(form.elements.maxGiB.value) * 1024 ** 3);
    else if (typeof value === 'boolean') values[key] = form.elements[key].checked;
    else values[key] = Number(form.elements[key].value);
  }
  const save = form.querySelector('[type=submit]');
  save.disabled = true;
  try {
    await request('settings', values);
    await refresh();
    $('#settings-dialog').close();
    notice('Настройки сохранены.');
  } catch (error) { form.querySelector('.form-error').textContent = error.message; }
  finally { save.disabled = false; }
});

$('#cleanup').addEventListener('click', async () => {
  try {
    const plan = await request('cleanup-preview', {});
    if (!plan.candidates.length) {
      notice(plan.overBudget ? 'Лимит занят защищёнными прогонами. Открепите ненужные отчёты или измените настройки.' : 'По текущим настройкам удалять нечего.');
      return;
    }
    confirmDeletion(plan.candidates, () => request('cleanup', { token: plan.token }), `Будет освобождено ${size(plan.freedBytes)}. Закреплённые прогоны сохранятся.`);
  } catch (error) { notice(error.message, true); }
});

$('#confirm-action').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  try {
    await pendingAction();
    $('#confirm-dialog').close();
    await refresh();
    notice('Удалено.');
  } catch (error) { $('#confirm-dialog .form-error').textContent = error.message; }
  finally { $('#confirm-action').disabled = false; }
});

refresh().catch(error => notice(error.message, true));
setInterval(() => {
  if (!document.hidden && !document.querySelector('dialog[open]')) refresh().catch(error => notice(error.message, true));
}, 3000);
