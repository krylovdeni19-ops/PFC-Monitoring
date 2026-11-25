const $ = id => document.getElementById(id);
const address = $('reader');
const status = $('status');
const search = $('search');
let rows = [];
const stockFilter = $('stock-filter');
address.value = localStorage.getItem('pfc-reader-url') || '';
$('read-settings').open = !address.value;
$('connect').onsubmit = event => {
  event.preventDefault();
  if (document.documentElement.dataset.pfcExtension !== 'ready') {
    status.textContent = 'Установите расширение ПФЦ 0.6.1 и обновите страницу.';
    return;
  }
  localStorage.setItem('pfc-reader-url', address.value);
  status.textContent = 'Читаем остатки. Если Google запросит вход, подтвердите его в открывшейся вкладке.';
  window.dispatchEvent(new CustomEvent('pfc:connect', {detail: address.value}));
};
function renderStock() {
  const term = search.value.trim().toLocaleLowerCase('ru');
  const found = rows.filter(row => (!stockFilter.value || row[1] === stockFilter.value) &&
    [0, 2, 3].some(index => String(row[index]).toLocaleLowerCase('ru').includes(term)));
  const count = found.reduce((total, row) => total + (Number(row[4]) || 0), 0);
  $('count').textContent = 'Строк: ' + found.length + ' · Всего: ' + count + ' шт.';
  const body = document.createDocumentFragment();
  for (const row of found) {
    const tr = document.createElement('tr');
    row.forEach((field, index) => {
      const cell = tr.insertCell();
      if (index !== 1) {
        cell.textContent = field;
        return;
      }
      const pill = document.createElement('span');
      pill.className = field === 'С товаром' ? 'pill occupied' : 'pill';
      pill.textContent = field;
      cell.append(pill);
    });
    body.append(tr);
  }
  document.querySelector('#stock tbody').replaceChildren(body);
}
search.addEventListener('input', renderStock);
stockFilter.addEventListener('change', renderStock);
window.addEventListener('pfc:status', event => { status.textContent = event.detail; });
function acceptStock(data) {
  if (!Array.isArray(data) || !data.every(row => Array.isArray(row) && row.length === 8 &&
      row.every(field => typeof field === 'string' || typeof field === 'number'))) {
    return false;
  }
  rows = data;
  $('stock').hidden = false;
  $('summary').hidden = false;
  status.textContent = 'МХ в отчёте: ' + new Set(rows.map(row => row[0])).size;
  renderSummary();
  mapLoaded = true;
  renderWarehouseMap();
  renderStock();
  return true;
}
window.addEventListener('pfc:result', event => { acceptStock(event.detail); });
$('import-stock').onsubmit = event => {
  event.preventDefault();
  const field = $('stock-data');
  try {
    const packet = JSON.parse(field.value);
    if (packet?.type !== 'pfc-stock-v1' || !acceptStock(packet.rows)) throw new Error();
    field.value = '';
    event.currentTarget.closest('details').open = false;
  } catch {
    status.textContent = 'Формат не распознан. Скопируйте данные целиком со страницы Apps Script.';
  }
};

const writer = $('writer');
const scanAddresses = $('scan-addresses');
scanAddresses.value = localStorage.getItem('pfc-scan-addresses') || '';
writer.value = localStorage.getItem('pfc-writer-url') || '';
writer.addEventListener('change', () => localStorage.setItem('pfc-writer-url', writer.value.trim()));

function renderSummary() {
  const cells = new Map();
  const barcodes = new Set();
  let total = 0;
  let latest = '';
  let latestKey = '';
  for (const [mx, result, barcode, , quantity, , , checkedAt] of rows) {
    cells.set(mx, result);
    if (barcode) barcodes.add(barcode);
    total += Number(quantity) || 0;
    const match = String(checkedAt).match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}:\d{2}:\d{2})$/);
    if (match) {
      const key = match[3] + match[2] + match[1] + match[4];
      if (key > latestKey) { latestKey = key; latest = checkedAt; }
    }
  }
  const occupied = [...cells.values()].filter(result => result === 'С товаром').length;
  const summary = $('summary');
  summary.replaceChildren();
  for (const [name, value] of [['МХ в отчёте', cells.size], ['С товаром', occupied],
    ['Пустых МХ', cells.size - occupied], ['Баркодов', barcodes.size], ['Всего штук', total]]) {
    const card = document.createElement('div');
    const number = document.createElement('strong');
    number.textContent = value.toLocaleString('ru');
    card.append(number, document.createTextNode(name));
    summary.append(card);
  }
  if (latest) {
    const time = document.createElement('p');
    time.textContent = 'Последняя проверка по МСК: ' + latest;
    summary.append(time);
  }
}

function sendWarehouse(action, detail) {
  window.dispatchEvent(new CustomEvent(action, {detail}));
}

function showScanError(message) {
  const error = $('scan-error');
  error.textContent = message;
  error.hidden = !message;
}
const scanZone = $('scan-zone');
scanZone.value = localStorage.getItem('pfc-scan-zone') || (scanAddresses.value.trim() ? 'custom' : 'standard');
function updateScanZone() {
  scanAddresses.disabled = scanZone.value !== 'custom';
  localStorage.setItem('pfc-scan-zone', scanZone.value);
}
scanZone.addEventListener('change', updateScanZone);
updateScanZone();

function startWarehouse(retry) {
  showScanError('');
  if (document.documentElement.dataset.pfcWarehouse !== 'ready') {
    $('progress').textContent = 'Установите расширение ПФЦ 0.8.2 и обновите страницу.';
    return;
  }
  if (!address.validity.valid) {
    location.hash = 'settings';
    $('read-settings').open = true;
  }
  if (!writer.value.trim() || !writer.validity.valid) {
    location.hash = 'settings';
    $('scan-settings').open = true;
  }
  if (!address.reportValidity() || !writer.value.trim() || !writer.reportValidity()) {
    $('scan-settings').open = true;
    $('progress').textContent = 'Укажите ссылки чтения и записи Apps Script.';
    return;
  }
  localStorage.setItem('pfc-writer-url', writer.value.trim());
  localStorage.setItem('pfc-reader-url', address.value.trim());
  localStorage.setItem('pfc-scan-addresses', scanAddresses.value);
  $('progress').textContent = 'Запускаем обход…';
  sendWarehouse('pfc:scan', {reader: address.value, writer: writer.value, addresses: scanAddresses.value, zone: scanZone.value, retry});
}
$('scan').onclick = () => startWarehouse(false);
$('retry-scan').onclick = () => startWarehouse(true);
$('retry-save').onclick = () => sendWarehouse('pfc:scan-save');

function pollWarehouse() {
  if (document.documentElement.dataset.pfcWarehouse === 'ready') sendWarehouse('pfc:scan-state');
}
window.addEventListener('pfc:scan-error', event => showScanError(event.detail));
window.addEventListener('pfc:scan-progress', ({detail: job}) => {
  if (!job) return;
  const active = ['scan', 'save'].includes(job.phase);
  $('scan').disabled = active;
  const indicator = $('run-progress');
  indicator.hidden = !active;
  indicator.max = job.total || 1;
  indicator.value = job.checked;
  $('retry-scan').hidden = job.phase !== 'done' || !job.failed.length;
  $('retry-save').hidden = !['error', 'interrupted'].includes(job.phase) || (!job.savedCells && !job.resumable);
  $('retry-save').textContent = job.resumable ? 'Продолжить обход' : 'Повторить запись';
  const tally = 'Проверено: ' + job.checked + ' из ' + job.total +
    ' · Успешно: ' + job.savedCells + ' · Проблемных: ' + job.failed.length;
  const label = {
    scan: 'Проверяем ' + (job.current || 'МХ'), save: 'Записываем обход в Google Таблицу',
    done: job.savedCells ? 'Обход записан' : 'Обход завершён. Новых результатов нет', error: 'Операция остановилась', interrupted: 'Обход прерван'
  };
  $('progress').textContent = label[job.phase] + '. ' + tally + (job.error ? '. ' + job.error : '');
  const issues = $('issues');
  issues.hidden = !job.failed.length;
  issues.querySelector('ul').replaceChildren(...job.failed.map(item => {
    const li = document.createElement('li');
    li.textContent = item.mx + ' · ' + item.error;
    return li;
  }));
});
setInterval(pollWarehouse, 1500);
pollWarehouse();

function autoLoad() {
  if (!address.value || document.documentElement.dataset.pfcWarehouse !== 'ready') return;
  status.textContent = 'Загружаем последний сохранённый отчёт…';
  sendWarehouse('pfc:connect', {url: address.value, background: true});
}
window.addEventListener('load', autoLoad, {once: true});

function possibleMovement(item) {
  return item.now === item.was &&
    item.cells.some(cell => cell.now > cell.was) &&
    item.cells.some(cell => cell.now < cell.was);
}

function summarizeChanges(products) {
  let gained = 0;
  let lost = 0;
  let moves = 0;
  for (const item of products) {
    const delta = item.now - item.was;
    gained += Math.max(0, delta);
    lost += Math.max(0, -delta);
    if (possibleMovement(item)) moves++;
  }
  return {gained, lost, net: gained - lost, moves};
}

function formatChange(value) {
  const absolute = Math.abs(value).toLocaleString('ru-RU');
  return value > 0 ? '+' + absolute : value < 0 ? '−' + absolute : absolute;
}

let displayedComparison;

function selectChanges(products, search, kind) {
  const query = search.trim().toLocaleLowerCase('ru');
  return products.filter(item => {
    if (kind === 'gain' && item.now <= item.was) return false;
    if (kind === 'loss' && item.now >= item.was) return false;
    if (kind === 'move' && !possibleMovement(item)) return false;
    return [item.barcode, item.name, ...item.cells.map(cell => cell.mx)]
      .some(value => String(value).toLocaleLowerCase('ru').includes(query));
  });
}

function renderChanges(report) {
  displayedComparison = report;
  $('changes-tools').hidden = true;
  $('changes-visible').textContent = '';
  const status = $('changes-status');
  const body = $('changes-rows');
  const missing = $('changes-missing');
  body.replaceChildren();
  $('changes-totals').hidden = true;
  missing.hidden = true;
  $('changes-table').hidden = true;
  if (!report || report.unavailable || report.error) {
    status.textContent = report?.error || (report?.unavailable
      ? 'В журнале пока нет одного обхода, где подтверждены все 136 МХ.'
      : 'Для сравнения обновите расширение и приложение чтения.');
    return;
  }
  status.textContent = (report.manual ? 'Выбранный обход: ' : 'Обход по ') + report.to + ' МСК · Сопоставлено МХ: ' + report.checked +
    (report.from ? (report.manual ? ' · Сравнение с ' : ' · Предыдущие замеры по ') + report.from + ' МСК' : '') +
    ' · Товаров с изменениями: ' + report.products.length;
  missing.hidden = !report.missing.length;
  missing.textContent = 'МХ без пары для сравнения: ' + report.missing.join(', ');
  if (report.checked > 0) {
    const {gained, lost, net, moves} = summarizeChanges(report.products);
    $('changes-gained').textContent = formatChange(gained);
    $('changes-lost').textContent = formatChange(-lost);
    $('changes-net').textContent = formatChange(net);
    $('changes-moves').textContent = moves.toLocaleString('ru-RU');
    $('changes-totals').hidden = false;
  }
  $('changes-tools').hidden = !report.products.length;
  const filtered = selectChanges(report.products, $('changes-search').value, $('changes-kind').value);
  $('changes-visible').textContent = 'Показано: ' + filtered.length + ' из ' + report.products.length;
  $('changes-export').disabled = !filtered.length;
  $('changes-table').hidden = !filtered.length;
  for (const item of filtered) {
    const row = body.insertRow();
    const delta = item.now - item.was;
    for (const value of [item.barcode, item.name, item.was, item.now, delta > 0 ? '+' + delta : delta]) {
      row.insertCell().textContent = value;
    }
    const list = document.createElement('details');
    const title = document.createElement('summary');
    title.textContent = possibleMovement(item) ? 'Возможное перемещение' : 'МХ: ' + item.cells.length;
    list.append(title);
    for (const cell of item.cells) {
      const line = document.createElement('div');
      line.textContent = cell.mx + ' · ' + cell.was + ' → ' + cell.now;
      list.append(line);
    }
    row.insertCell().append(list);
  }
}

function changesCsv(report, products) {
  const escape = value => {
    const text = String(value ?? '');
    const safe = typeof value === 'string' && /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/u.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const records = [['Ранний замер МСК', 'Поздний замер МСК', 'Баркод', 'Название', 'Было', 'Стало',
    'Разница', 'Изменения по МХ', 'Возможное перемещение']];
  for (const item of products) {
    records.push([report.from, report.to, item.barcode, item.name, item.was, item.now, item.now - item.was,
      item.cells.map(cell => cell.mx + ': ' + cell.was + ' → ' + cell.now).join(', '),
      possibleMovement(item) ? 'Да' : '']);
  }
  return '\uFEFF' + records.map(row => row.map(escape).join(';')).join('\r\n');
}

for (const [id, event] of [['changes-search', 'input'], ['changes-kind', 'change']]) {
  $(id).addEventListener(event, () => renderChanges(displayedComparison));
}
$('changes-export').onclick = () => {
  if (!displayedComparison?.products) return;
  const selected = selectChanges(displayedComparison.products, $('changes-search').value, $('changes-kind').value);
  if (!selected.length) return;
  const file = new Blob([changesCsv(displayedComparison, selected)], {type: 'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'pfc-izmeneniya.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

let automaticReport;
let scanHistory = [];
const historyMode = $('history-mode');
const historyFrom = $('history-from');
const historyTo = $('history-to');

function compareSavedScans(before, after) {
  const previous = new Map(before.cells);
  const latest = new Map(after.cells);
  const expected = before.palletRun && after.palletRun
    ? Array.from({length: 350}, (_, i) => '01.01.' + String(i + 1).padStart(2, '0'))
    : [...new Set([...previous.keys(), ...latest.keys()])];
  const missing = expected
    .filter(mx => !previous.has(mx) || !latest.has(mx)).sort();
  const products = new Map();
  let checked = 0;
  for (const [mx, current] of latest) {
    if (!previous.has(mx)) continue;
    checked++;
    const oldByCode = new Map(previous.get(mx).map(item => [item[0], item]));
    const newByCode = new Map(current.map(item => [item[0], item]));
    for (const barcode of new Set([...oldByCode.keys(), ...newByCode.keys()])) {
      const oldItem = oldByCode.get(barcode);
      const newItem = newByCode.get(barcode);
      const was = oldItem?.[2] ?? 0;
      const now = newItem?.[2] ?? 0;
      if (!products.has(barcode)) products.set(barcode, {
        barcode, name: (newItem || oldItem)[1], was: 0, now: 0, cells: []
      });
      const product = products.get(barcode);
      product.was += was;
      product.now += now;
      if (was !== now) product.cells.push({mx, was, now});
    }
  }
  const changed = [...products.values()].filter(item => item.cells.length)
    .sort((a, b) => Math.abs(b.now - b.was) - Math.abs(a.now - a.was));
  return {manual: true, from: before.stamp, to: after.stamp, checked, missing, products: changed};
}

function renderHistory() {
  const manual = historyMode.value === 'manual';
  $('history-selection').hidden = !manual;
  if (!manual) {
    renderChanges(automaticReport);
    return;
  }
  const earlier = scanHistory.findIndex(item => item.id === historyFrom.value);
  const later = scanHistory.findIndex(item => item.id === historyTo.value);
  if (later < 0 || earlier <= later) {
    renderChanges({error: 'Выберите два разных обхода. Первый должен быть раньше второго.'});
    return;
  }
  renderChanges(compareSavedScans(scanHistory[earlier], scanHistory[later]));
}

$('history-form').addEventListener('submit', event => event.preventDefault());
for (const field of [historyMode, historyFrom, historyTo]) field.addEventListener('change', renderHistory);
window.addEventListener('pfc:changes', ({detail: report}) => {
  automaticReport = report;
  scanHistory = report?.snapshots ?? [];
  $('history-form').hidden = scanHistory.length < 2;
  if (scanHistory.length < 2) historyMode.value = 'auto';
  for (const [select, fallback] of [[historyFrom, 1], [historyTo, 0]]) {
    const selected = select.value;
    select.replaceChildren(...scanHistory.map(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.stamp + (item.palletRun ? ' · Паллеты: ' + item.cells.length + '/350' : ' · МХ: ' + item.cells.length);
      return option;
    }));
    select.value = scanHistory.some(item => item.id === selected)
      ? selected : scanHistory[fallback]?.id ?? '';
  }
  renderHistory();
});

const mapZone = $('map-zone');
let mapLoaded = false;
let mapCells = new Map();
const addressPart = number => String(number).padStart(2, '0');

function warehouseGroups() {
  if (mapZone.value === 'pallets') {
    return Array.from({length: 14}, (_, group) => {
      const start = group * 25 + 1;
      return {
        title: 'Места ' + start + '–' + (start + 24),
        locations: Array.from({length: 25}, (_, i) => {
          const label = addressPart(start + i);
          return ['01.01.' + label, label];
        })
      };
    });
  }
  return Array.from({length: 9}, (_, group) => {
    const rack = addressPart(group + 2);
    return {
      title: 'Стеллаж ' + rack,
      locations: Array.from({length: 15}, (_, i) => {
        const shelf = addressPart(Math.floor(i / 3) + 1);
        const cell = addressPart(i % 3 + 1);
        return [rack + '.' + shelf + '.' + cell, shelf + '.' + cell];
      })
    };
  });
}

function openMapCell(address) {
  $('map-cell-title').textContent = 'МХ ' + address;
  const entry = mapCells.get(address);
  const state = entry?.state || 'Не проверено';
  $('map-cell-status').textContent = entry?.time ? state + ' · Проверено МСК: ' + entry.time : state;
  const items = entry?.products || [];
  $('map-products').replaceChildren(...items.map(row => {
    const item = document.createElement('li');
    item.textContent = row[3] + ' · ' + row[2] + ' · ' + row[4] + ' шт.';
    return item;
  }));
  $('map-details').showModal();
}

function renderWarehouseMap() {
  mapCells = new Map();
  for (const row of rows) {
    const [address, state, , , , , , time] = row;
    if (state !== 'С товаром' && state !== 'Ничего не найдено') continue;
    if (!mapCells.has(address)) mapCells.set(address, {state: 'Пусто', time, products: []});
    const entry = mapCells.get(address);
    if (state === 'С товаром') {
      entry.state = state;
      entry.products.push(row);
    }
  }
  const totals = {occupied: 0, empty: 0, unknown: 0};
  const groups = warehouseGroups().map(({title, locations}) => {
    const card = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = title;
    const cells = document.createElement('div');
    cells.className = 'map-cells ' + (mapZone.value === 'pallets' ? 'pallets' : '');
    for (const [address, label] of locations) {
      const state = mapCells.get(address)?.state;
      const color = state === 'С товаром' ? 'occupied' : state === 'Пусто' ? 'empty' : 'unknown';
      totals[color]++;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = color;
      button.dataset.address = address;
      button.textContent = label;
      button.title = address + ' · ' + (state || 'Не проверено');
      button.setAttribute('aria-label', button.title);
      cells.append(button);
    }
    card.append(heading, cells);
    return card;
  });
  $('map-grid').replaceChildren(...groups);
  $('map-status').textContent = mapLoaded
    ? 'С товаром: ' + totals.occupied + ' · Пусто: ' + totals.empty + ' · Не проверено: ' + totals.unknown
    : 'Загрузите остатки, чтобы увидеть занятость.';
}

mapZone.addEventListener('change', renderWarehouseMap);
$('map-grid').addEventListener('click', event => {
  const cell = event.target.closest('button[data-address]');
  if (cell) openMapCell(cell.dataset.address);
});
$('map-find').addEventListener('submit', event => {
  event.preventDefault();
  const address = $('map-address').value.trim();
  const input = $('map-address');
  mapZone.value = address.startsWith('01.01.') ? 'pallets' : 'racks';
  renderWarehouseMap();
  const cell = [...$('map-grid').querySelectorAll('button')].find(button => button.dataset.address === address);
  if (!cell) {
    input.setCustomValidity('Введите адрес из карты склада, например 02.01.03.');
    input.reportValidity();
    return;
  }
  cell.focus();
  openMapCell(address);
});
$('map-address').addEventListener('input', event => event.target.setCustomValidity(''));
renderWarehouseMap();

const viewLinks = [...document.querySelectorAll('.view-nav a')];
function showView() {
  const current = viewLinks.find(link => link.hash === location.hash) || viewLinks[0];
  for (const link of viewLinks) {
    const active = link === current;
    $(link.hash.slice(1)).hidden = !active;
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
window.addEventListener('hashchange', () => {
  showView();
  window.scrollTo(0, 0);
});
showView();
