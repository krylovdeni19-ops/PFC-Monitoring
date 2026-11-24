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
