const columns = ['ID', 'Время UTC', 'МХ', 'Результат', 'Баркод', 'Название', 'Количество', 'Артикул WB', 'Бренд'];
const title = 'Журнал МХ';
const valuesPath = '/values/' + encodeURIComponent("'" + title + "'!A:I");
const get = id => document.getElementById(id);
let snapshot;
let connection;

function readSnapshot(raw) {
  const data = JSON.parse(raw);
  if (!data || !/^[a-f0-9-]{36}$/.test(data.id) || !Number.isFinite(Date.parse(data.time)) ||
      !/^\d{2}\.\d{2}\.\d{2,}$/.test(data.mx) || typeof data.empty !== 'boolean' ||
      !Array.isArray(data.rows) || data.empty !== (data.rows.length === 0) ||
      !data.rows.every(row => row && typeof row.barcode === 'string' && /^\d+$/.test(row.barcode) &&
        typeof row.name === 'string' && Number.isSafeInteger(row.quantity) && row.quantity >= 0)) {
    throw new Error('Данные расширения не распознаны.');
  }
  return data;
}

function renderTable(container, headings, rows) {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const label of headings) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const value of row) tr.insertCell().textContent = value;
  }
  container.replaceChildren(table);
}

function snapshotRows(data) {
  const prefix = [data.id, data.time, data.mx];
  if (data.empty) return [[...prefix, 'Ничего не найдено', '', '', '', '', '']];
  return data.rows.map(row => [...prefix, 'С товаром', row.barcode, row.name, row.quantity, '', '']);
}

async function api(path, body) {
  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + connection.id + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body)
  });
  if (response.status === 401) {
    connection = undefined;
    throw new Error('Подключите Google заново и повторите.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? 'Ошибка Google Sheets.');
  return result;
}

function appendCells(sheetId, rows) {
  return { appendCells: { sheetId, fields: 'userEnteredValue', rows: rows.map(row => ({
    values: row.map(value => ({
      userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value }
    }))
  })) } };
}

async function readJournal(sheetId) {
  return sheetId === undefined ? [] : (await api(valuesPath + '?valueRenderOption=UNFORMATTED_VALUE')).values ?? [];
}

async function journalSheet() {
  const { sheets } = await api('?fields=sheets(properties(sheetId,title))');
  return sheets.find(sheet => sheet.properties.title === title)?.properties.sheetId;
}

async function persist() {
  const sheetId = await journalSheet();
  const existing = await readJournal(sheetId);
  const rows = snapshotRows(snapshot);
  if (existing.length && columns.some((name, index) => existing[0][index] !== name)) {
    throw new Error('Заголовки листа «Журнал МХ» не совпадают с шаблоном.');
  }
  const matches = entries => {
    const saved = entries.filter(row => row[0] === snapshot.id);
    return saved.length === rows.length && rows.every((row, index) =>
      row.every((value, column) => value === (saved[index][column] ?? '')));
  };
  if (matches(existing)) return;
  const target = sheetId ?? crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647;
  const requests = [];
  if (sheetId === undefined) requests.push({ addSheet: { properties: { title, sheetId: target } } });
  if (!existing.length) requests.push({
    updateCells: {
      start: {sheetId: target, rowIndex: 0, columnIndex: 0},
      rows: [{values: columns.map(stringValue => ({userEnteredValue: {stringValue}}))}],
      fields: 'userEnteredValue'
    }
  });
  requests.push({
    addNamedRange: { namedRange: {
      name: 'pfc_' + snapshot.id.replaceAll('-', '_'),
      range: { sheetId: target, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }
    } }
  }, appendCells(target, rows));
  try {
    await api(':batchUpdate', { requests });
  } catch (error) {
    if (!connection || !matches(await readJournal(await journalSheet()))) throw error;
    return;
  }
  if (!matches(await readJournal(target))) throw new Error('Запись не удалось подтвердить. Повторите проверку.');
}

function updateButtons(busy = false) {
  get('save').disabled = busy || !connection || !snapshot;
  get('history').disabled = busy || !connection;
  get('settings').querySelector('button').disabled = busy;
}

async function run(action) {
  updateButtons(true);
  get('status').textContent = 'Выполняется запрос…';
  try {
    get('status').textContent = await action();
  } catch (error) {
    get('status').textContent = error.message;
  } finally {
    updateButtons();
  }
}

try {
  const received = new URLSearchParams(location.hash.slice(1)).get('snapshot');
  if (received) {
    snapshot = readSnapshot(received);
    sessionStorage.setItem('pfc-snapshot', received);
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    const cached = sessionStorage.getItem('pfc-snapshot');
    if (cached) snapshot = readSnapshot(cached);
  }
  if (snapshot) {
    get('summary').textContent = snapshot.mx + (snapshot.empty ? ' · Ничего не найдено' : ' · Позиций: ' + snapshot.rows.length);
    renderTable(get('preview'), columns.slice(2), snapshotRows(snapshot).map(row => row.slice(2)));
  }
} catch (error) {
  get('summary').textContent = error.message;
}

get('client').value = localStorage.getItem('pfc-client') ?? '';
get('sheet').value = localStorage.getItem('pfc-sheet') ?? '';
get('settings').addEventListener('submit', event => {
  event.preventDefault();
  const client = get('client').value.trim();
  const sheet = new URL(get('sheet').value);
  const id = sheet.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/)?.[1];
  if (sheet.origin !== 'https://docs.google.com' || !id || !window.google?.accounts?.oauth2) {
    get('status').textContent = 'Проверьте ссылку на таблицу и доступность входа Google.';
    return;
  }
  google.accounts.oauth2.initTokenClient({
    client_id: client,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    callback: response => {
      if (!response.access_token) {
        get('status').textContent = response.error ?? 'Google не предоставил доступ.';
        return;
      }
      connection = { id, token: response.access_token };
      localStorage.setItem('pfc-client', client);
      localStorage.setItem('pfc-sheet', sheet.href);
      run(async () => {
        await journalSheet();
        return 'Google Таблица подключена.';
      });
    },
    error_callback: () => { get('status').textContent = 'Окно входа Google было закрыто или заблокировано.'; }
  }).requestAccessToken();
});
get('save').addEventListener('click', () => run(async () => {
  await persist();
  return 'Запись подтверждена в Google Таблице.';
}));
get('history').addEventListener('click', () => run(async () => {
  const entries = (await readJournal(await journalSheet())).slice(1);
  renderTable(get('records'), columns.slice(1), entries.slice(-100).reverse().map(row => columns.slice(1).map((_, index) => row[index + 1] ?? '')));
  return entries.length ? 'Последние строки журнала.' : 'Журнал пока пуст.';
}));
