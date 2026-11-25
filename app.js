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
    ([0, 2, 3].some(index => String(row[index]).toLocaleLowerCase('ru').includes(term)) ||
      String(row[5]).trim() === term));;
  const count = found.reduce((total, row) => total + (Number(row[4]) || 0), 0);
  const locations = new Set(found.map(row => row[0])).size;
  $('count').textContent = 'МХ: ' + locations + ' · Строк: ' + found.length + ' · Всего: ' + count + ' шт.';
  const body = document.createDocumentFragment();
  for (const row of found) {
    const tr = document.createElement('tr');
    row.forEach((field, index) => {
      const cell = tr.insertCell();
      if (index === 0 && /^\d{2}\.\d{2}\.\d{2,3}$/.test(field)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'stock-map-link';
        button.textContent = field;
        button.setAttribute('aria-label', 'Открыть МХ ' + field + ' на карте склада');
        button.addEventListener('click', () => showStockLocation(field));
        cell.append(button);
        return;
      }
      const article = String(field).trim();
      if (index === 5 && /^[1-9]\d*$/.test(article)) {
        const link = document.createElement('a');
        link.className = 'stock-article-link';
        link.href = 'https://www.wildberries.ru/catalog/' + article + '/detail.aspx';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = article;
        const lookup = document.createElement('button');
        lookup.type = 'button';
        lookup.className = 'stock-seller-link';
        lookup.textContent = 'Найти продавца';
        lookup.setAttribute('aria-label', 'Найти продавца по артикулу ' + article);
        lookup.addEventListener('click', () => openSellerDetails(article));
        cell.append(link, lookup);
        return;
      }
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
scanZone.value = localStorage.getItem('pfc-scan-zone') || (scanAddresses.value.trim() ? 'custom' : 'warehouse');
function updateScanZone() {
  scanAddresses.disabled = scanZone.value !== 'custom';
  localStorage.setItem('pfc-scan-zone', scanZone.value);
}
scanZone.addEventListener('change', updateScanZone);
updateScanZone();

function startWarehouse(retry) {
  const zone = scanZone.value;
  showScanError('');
  if (document.documentElement.dataset.pfcWarehouse !== 'ready') {
    $('progress').textContent = 'Установите расширение ПФЦ 0.8.5 и обновите страницу.';
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
  const usesCatalog = ['warehouse', 'racks', 'pallets'].includes(zone) && !retry;
  if (usesCatalog && !locationCatalog) {
    showScanError('Сначала загрузите справочник через «Загрузить сохранённые остатки».');
    return;
  }
  const catalog = usesCatalog ? locationCatalog.filter(([mx, active]) => active &&
    (zone === 'warehouse' || (zone === 'pallets') === mx.startsWith('01.01.')))
    .map(([mx]) => mx) : undefined;
  if (catalog && !catalog.length) {
    showScanError('В выбранной зоне нет активных МХ.');
    return;
  }
  $('progress').textContent = 'Запускаем обход…';
  sendWarehouse('pfc:scan', {reader: address.value, writer: writer.value, addresses: scanAddresses.value, zone, catalog, retry});
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
      ? 'В журнале пока нет полного обхода с подтверждёнными результатами.'
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
  const scopeFor = (scan, checked) => scan.scope ?? (scan.palletRun
    ? Array.from({length: 350}, (_, i) => '01.01.' + String(i + 1).padStart(2, '0'))
    : checked.keys());
  const expected = [...new Set([...scopeFor(before, previous), ...scopeFor(after, latest)])];
  const missing = expected.filter(mx => !previous.has(mx) || !latest.has(mx)).sort();
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
      option.textContent = item.stamp + (item.scope ? ' · МХ: ' + item.cells.length + '/' + item.scope.length : item.palletRun ? ' · Паллеты: ' + item.cells.length + '/350' : ' · МХ: ' + item.cells.length);
      return option;
    }));
    select.value = scanHistory.some(item => item.id === selected)
      ? selected : scanHistory[fallback]?.id ?? '';
  }
  renderHistory();
});

let locationCatalog = null;
const mapZone = $('map-zone');
let mapLoaded = false;
let mapCells = new Map();
const addressPart = number => String(number).padStart(2, '0');

function warehouseGroups() {
  if (locationCatalog) {
    const groups = new Map();
    const pallets = mapZone.value === 'pallets';
    for (const [mx, active] of locationCatalog) {
      if (!active || pallets !== mx.startsWith('01.01.')) continue;
      const [rack, shelf, cell] = mx.split('.');
      const group = pallets ? Math.floor((Number(cell) - 1) / 25) : Number(rack);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push([mx, pallets ? cell : shelf + '.' + cell]);
    }
    return [...groups].sort(([a], [b]) => a - b).map(([group, locations]) => ({
      title: pallets ? 'Места ' + (group * 25 + 1) + '–' + (group * 25 + 25) : 'Стеллаж ' + addressPart(group),
      locations: locations.sort(([a], [b]) => a.localeCompare(b, 'ru', {numeric: true}))
    }));
  }
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
function findMapButton(address) {
  mapZone.value = address.startsWith('01.01.') ? 'pallets' : 'racks';
  renderWarehouseMap();
  return [...$('map-grid').querySelectorAll('button')].find(button => button.dataset.address === address);
}

function showStockLocation(address) {
  if (location.hash !== '#warehouse-map') history.pushState(null, '', '#warehouse-map');
  showView();
  window.scrollTo(0, 0);
  const input = $('map-address');
  input.value = address;
  input.setCustomValidity('');
  (findMapButton(address) || input).focus();
  openMapCell(address);
}

$('map-find').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('map-address');
  const address = input.value.trim();
  const cell = findMapButton(address);
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

function locationAddresses(mode, fields) {
  const numeric = (value, min, max) => /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
  if (mode === 'single') {
    const match = fields.single.trim().match(/^(\d{2})\.(\d{2})\.(\d{2,3})$/);
    if (!match || !numeric(match[1], 1, 99) || !numeric(match[2], 1, 99) || !numeric(match[3], 1, 999) ||
        (match[1] === '01' && match[2] !== '01')) throw new Error('Введите МХ вида 11.01.01 или 01.01.351.');
    return [match[1] + '.' + match[2] + '.' + addressPart(Number(match[3]))];
  }
  if (mode === 'pallets') {
    if (!numeric(fields.first, 1, 999) || !numeric(fields.last, Number(fields.first), 999)) {
      throw new Error('Укажите диапазон паллет от 1 до 999.');
    }
    return Array.from({length: Number(fields.last) - Number(fields.first) + 1}, (_, i) =>
      '01.01.' + addressPart(Number(fields.first) + i));
  }
  if (!numeric(fields.rack, 2, 99) || !numeric(fields.shelves, 1, 99) || !numeric(fields.cells, 1, 99) ||
      Number(fields.shelves) * Number(fields.cells) > 999) throw new Error('Проверьте номер стеллажа и размеры. Максимум 999 МХ за раз.');
  return Array.from({length: Number(fields.shelves) * Number(fields.cells)}, (_, i) =>
    [Number(fields.rack), Math.floor(i / Number(fields.cells)) + 1, i % Number(fields.cells) + 1].map(addressPart).join('.'));
}

let locationPreview = [];
function clearLocationPreview() {
  locationPreview = [];
  for (const id of ['locations-preview', 'locations-enable', 'locations-disable']) $(id).hidden = true;
}
function renderLocationCatalog() {
  if (!locationCatalog) return;
  const query = $('locations-search').value.trim();
  const found = locationCatalog.filter(([mx]) => mx.includes(query));
  $('locations-count').textContent = 'Активных: ' + locationCatalog.filter(([, active]) => active).length +
    ' · Всего: ' + locationCatalog.length + ' · В списке: ' + Math.min(30, found.length) + ' из ' + found.length;
  $('locations-list').replaceChildren(...found.slice(0, 30).map(([mx, active]) => {
    const row = document.createElement('li');
    row.textContent = mx + ' · ' + (active ? 'Активен' : 'Отключён');
    return row;
  }));
}
function acceptLocationCatalog(data) {
  if (!Array.isArray(data)) return;
  locationCatalog = data;
  renderLocationCatalog();
  renderWarehouseMap();
}
window.addEventListener('pfc:locations', ({detail}) => {
  if (detail.error) {
    locationCatalog = null;
    $('locations-status').textContent = detail.error;
  } else acceptLocationCatalog(detail.rows);
});
$('locations-search').addEventListener('input', renderLocationCatalog);
$('location-mode').addEventListener('change', () => {
  for (const element of document.querySelectorAll('[data-location-mode]')) {
    element.hidden = element.dataset.locationMode !== $('location-mode').value;
  }
});
$('locations-form').addEventListener('input', clearLocationPreview);
$('locations-form').onsubmit = event => {
  event.preventDefault();
  try {
    const fields = Object.fromEntries(['single','rack','shelves','cells','first','last']
      .map(key => [key, $('location-' + key).value]));
    locationPreview = locationAddresses($('location-mode').value, fields);
    $('locations-status').textContent = 'Адресов в списке: ' + locationPreview.length;
    $('locations-preview').textContent = locationPreview.join(', ');
    for (const id of ['locations-preview', 'locations-enable', 'locations-disable']) $(id).hidden = false;
  } catch (error) {
    clearLocationPreview();
    $('locations-status').textContent = error.message;
  }
};
for (const [id, active] of [['locations-enable', true], ['locations-disable', false]]) {
  $(id).onclick = () => {
    if (document.documentElement.dataset.pfcLocations !== 'ready') {
      $('locations-status').textContent = 'Обновите расширение ПФЦ до 0.8.5.';
      return;
    }
    if (!writer.value.trim() || !writer.validity.valid) {
      $('scan-settings').open = true;
      writer.focus();
      $('locations-status').textContent = 'Укажите ссылку /exec для записи.';
      return;
    }
    if (!locationPreview.length) return;
    for (const key of ['locations-enable', 'locations-disable']) $(key).disabled = true;
    $('locations-status').textContent = 'Сохраняем справочник…';
    window.dispatchEvent(new CustomEvent('pfc:locations-save', {
      detail: {writer: writer.value.trim(), request: {addresses: locationPreview, active}}
    }));
  };
}
window.addEventListener('pfc:locations-saved', ({detail}) => {
  for (const id of ['locations-enable', 'locations-disable']) $(id).disabled = false;
  if (!detail.error) {
    acceptLocationCatalog(detail.rows);
    clearLocationPreview();
  }
  $('locations-status').textContent = detail.error || 'Справочник сохранён.';
});

let sellerRequestId = 0;
function openSellerDetails(article) {
  const dialog = $('seller-details');
  const requestId = ++sellerRequestId;
  $('seller-fields').hidden = true;
  $('seller-title').textContent = 'Продавец · ' + article;
  dialog.showModal();
  if (document.documentElement.dataset.pfcSeller !== 'ready') {
    $('seller-status').textContent = 'Обновите расширение ПФЦ до 0.9.1 и перезагрузите страницу.';
    return;
  }
  $('seller-status').textContent = 'Ищем продавца на Wildberries и сохраняем в Google Таблицу…';
  window.dispatchEvent(new CustomEvent('pfc:seller-find', {detail: {article, requestId, writer: writer.value.trim()}}));
}

window.addEventListener('pfc:seller-result', event => {
  const {requestId, seller, saved, saveError, error} = event.detail;
  if (requestId !== sellerRequestId || !$('seller-details').open) return;
  $('seller-status').textContent = error || (saved ? 'Записано в лист «Продавцы WB».' : 'Продавец найден. Ошибка записи: ' + (saveError || 'обновите расширение.'));
  if (!seller || !/^[1-9]\d*$/.test(seller.id)) return;
  const store = $('seller-store');
  store.href = 'https://www.wildberries.ru/seller/' + seller.id;
  store.textContent = seller.name || 'Открыть витрину WB';
  $('seller-legal').textContent = seller.legalName || 'Не указано на WB';
  $('seller-email').textContent = seller.email || 'Не указана на WB';
  $('seller-fields').hidden = false;
});

$('seller-all').addEventListener('click', async event => {
  const button = event.currentTarget;
  const status = $('seller-batch-status');
  const errors = $('seller-batch-errors');
  const list = errors.querySelector('ul');
  status.hidden = false;
  errors.hidden = true;
  list.replaceChildren();
  if (document.documentElement.dataset.pfcSeller !== 'ready') {
    status.textContent = 'Обновите расширение ПФЦ до 0.9.1 и перезагрузите страницу.';
    return;
  }
  if (!locationCatalog || !writer.value.trim() || !writer.reportValidity()) {
    status.textContent = 'Загрузите сохранённые остатки со справочником МХ и проверьте ссылку записи в настройках.';
    return;
  }
  const active = new Set(locationCatalog.filter(([, enabled]) => enabled).map(([mx]) => mx));
  const articles = [...new Set(rows.filter(row => active.has(row[0]) && row[1] === 'С товаром')
    .map(row => String(row[5]).trim()).filter(value => /^[1-9]\d{0,15}$/.test(value)))];
  if (!articles.length) {
    status.textContent = 'В сохранённых остатках активных МХ нет артикулов WB.';
    return;
  }
  const writerAddress = writer.value.trim();
  button.disabled = true;
  let saved = 0;
  let checked = 0;
  try {
    for (const article of articles) {
      status.textContent = 'Проверяем НМ ' + article + ' · ' + (checked + 1) + ' из ' + articles.length;
      const requestId = crypto.randomUUID();
      const result = await new Promise(resolve => {
        function receive(event) {
          if (event.detail.requestId !== requestId) return;
          window.removeEventListener('pfc:seller-result', receive);
          clearTimeout(timeout);
          resolve(event.detail);
        }
        const timeout = setTimeout(() => {
          window.removeEventListener('pfc:seller-result', receive);
          resolve({saveError: 'Расширение не ответило вовремя.'});
        }, 90000);
        window.addEventListener('pfc:seller-result', receive);
        window.dispatchEvent(new CustomEvent('pfc:seller-find', {detail: {article, requestId, writer: writerAddress}}));
      });
      checked++;
      if (result.saved) {
        saved++;
        continue;
      }
      const li = document.createElement('li');
      li.textContent = article + ' · ' + (result.saveError || result.error || 'Запись не подтверждена.');
      list.append(li);
      errors.hidden = false;
      if (result.saveError) break;
    }
    status.textContent = 'Проверено: ' + checked + ' из ' + articles.length + ' · Записано: ' + saved +
      ' · Проблемных: ' + (checked - saved) + (checked < articles.length ? ' · Остановлено при ошибке записи.' : '');
  } finally {
    button.disabled = false;
  }
});
