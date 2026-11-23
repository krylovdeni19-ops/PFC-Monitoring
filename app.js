const $ = id => document.getElementById(id);
const address = $('reader');
const status = $('status');
const search = $('search');
let rows = [];
address.value = localStorage.getItem('pfc-reader-url') || '';
$('connect').onsubmit = event => {
  event.preventDefault();
  if (document.documentElement.dataset.pfcExtension !== 'ready') {
    status.textContent = 'Установите расширение ПФЦ 0.6.0 и обновите страницу.';
    return;
  }
  localStorage.setItem('pfc-reader-url', address.value);
  status.textContent = 'В открывшейся вкладке подтвердите доступ и нажмите «Передать остатки на сайт ПФЦ».';
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
window.addEventListener('pfc:result', event => {
  if (!Array.isArray(event.detail) || !event.detail.every(row => Array.isArray(row) && row.length === 8)) return;
  rows = event.detail;
  $('stock').hidden = false;
  status.textContent = 'МХ в отчёте: ' + new Set(rows.map(row => row[0])).size;
  renderStock();
});
