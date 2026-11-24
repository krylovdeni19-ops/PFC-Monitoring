const $ = id => document.getElementById(id);
const address = $('reader');
const status = $('status');
const search = $('search');
let rows = [];
address.value = localStorage.getItem('pfc-reader-url') || '';
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
  const found = rows.filter(row => [0, 2, 3].some(index => String(row[index]).toLocaleLowerCase('ru').includes(term)));
  const count = found.reduce((total, row) => total + (Number(row[4]) || 0), 0);
  $('count').textContent = 'Строк: ' + found.length + ' · Всего: ' + count + ' шт.';
  const body = document.createDocumentFragment();
  for (const row of found) {
    const tr = document.createElement('tr');
    for (const field of row) tr.insertCell().textContent = field;
    body.append(tr);
  }
  document.querySelector('tbody').replaceChildren(body);
}
search.addEventListener('input', renderStock);
window.addEventListener('pfc:status', event => { status.textContent = event.detail; });
function acceptStock(data) {
  if (!Array.isArray(data) || !data.every(row => Array.isArray(row) && row.length === 8 &&
      row.every(field => typeof field === 'string' || typeof field === 'number'))) {
    return false;
  }
  rows = data;
  $('stock').hidden = false;
  status.textContent = 'МХ в отчёте: ' + new Set(rows.map(row => row[0])).size;
  renderSummary();
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

function startWarehouse(retry) {
  if (document.documentElement.dataset.pfcWarehouse !== 'ready') {
    $('progress').textContent = 'Установите расширение ПФЦ 0.7.0 и обновите страницу.';
    return;
  }
  if (!address.reportValidity() || !writer.value.trim() || !writer.reportValidity()) {
    $('scan-settings').open = true;
    $('progress').textContent = 'Укажите ссылки чтения и записи Apps Script.';
    return;
  }
  localStorage.setItem('pfc-writer-url', writer.value.trim());
  localStorage.setItem('pfc-reader-url', address.value.trim());
  localStorage.setItem('pfc-scan-addresses', scanAddresses.value);
  sendWarehouse('pfc:scan', {reader: address.value, writer: writer.value, addresses: scanAddresses.value, retry});
}
$('scan').onclick = () => startWarehouse(false);
$('retry-scan').onclick = () => startWarehouse(true);
$('retry-save').onclick = () => sendWarehouse('pfc:scan-save');

function pollWarehouse() {
  if (document.documentElement.dataset.pfcWarehouse === 'ready') sendWarehouse('pfc:scan-state');
}
window.addEventListener('pfc:scan-error', event => { $('progress').textContent = event.detail; });
window.addEventListener('pfc:scan-progress', ({detail: job}) => {
  if (!job) return;
  const active = ['scan', 'save'].includes(job.phase);
  $('scan').disabled = active;
  $('retry-scan').hidden = job.phase !== 'done' || !job.failed.length;
  $('retry-save').hidden = !['error', 'interrupted'].includes(job.phase) || !job.savedCells;
  const tally = 'Проверено: ' + job.checked + ' из ' + job.total +
    ' · Успешно: ' + job.savedCells + ' · Проблемных: ' + job.failed.length;
  const label = {
    scan: 'Проверяем ' + (job.current || 'МХ'), save: 'Записываем обход в Google Таблицу',
    done: 'Обход записан', error: 'Операция остановилась', interrupted: 'Обход прерван'
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
