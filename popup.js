function parseResult(text, addresses) {
  if (addresses.length !== 1) {
    return { error: 'Выберите «По МХ», выполните поиск и дождитесь результата.' };
  }

  const [mx] = addresses;
  const heading = text.match(/МХ\s+(\d{2}\.\d{2}\.\d{2,})\s*[•·●]?\s*(\d+)\s+БК/u);
  if (!heading) {
    return text.includes('По вашему запросу ничего не найдено')
      ? { mx, empty: true }
      : { error: 'Результат поиска пока не распознан. Дождитесь загрузки и повторите.' };
  }
  if (heading[1] !== mx) {
    return { error: 'На странице ещё показан результат для другого МХ. Повторите после загрузки.' };
  }

  const resultsText = text.slice(heading.index + heading[0].length);
  const rows = [];
  for (const match of resultsText.matchAll(/БК\s+(\d+)\s+(\d+)\s*шт\s+((?:(?!БК\s+\d)[\s\S])+?)\s*Посмотреть на сайте/gu)) {
    rows.push({ barcode: match[1], quantity: Number(match[2]), name: match[3].replace(/\s+/gu, ' ').trim() });
  }
  if (!rows.length || rows.length !== Number(heading[2]) || new Set(rows.map(row => row.barcode)).size !== rows.length) {
    return { error: 'Число прочитанных карточек отличается от результата WB. Повторите после загрузки.' };
  }
  return { mx, rows };
}

if (typeof document !== 'undefined') {
  const output = document.querySelector('#output');
  const button = document.querySelector('#read');
  const send = document.querySelector('#send');
  const site = document.querySelector('#site');
  site.value = localStorage.getItem('site') ?? '';
  let snapshot;
  send.addEventListener('click', async () => {
    try {
      const url = new URL(site.value.trim());
      if (!url.hostname.endsWith('.github.io') || url.protocol !== 'https:' || url.username || url.password) {
        throw new Error();
      }
      localStorage.setItem('site', url.href);
      url.hash = new URLSearchParams({ snapshot: JSON.stringify(snapshot) });
      await chrome.tabs.create({ url: url.href });
    } catch {
      output.textContent = 'Укажите HTTPS-адрес вашего сайта на GitHub Pages.';
    }
  });
  button.addEventListener('click', async () => {
    button.disabled = true;
    send.disabled = true;
    snapshot = undefined;
    output.textContent = 'Читаем результат…';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url && new URL(tab.url);
      if (url?.origin !== 'https://my-pfc.wb.ru' || url.pathname !== '/search') {
        output.textContent = 'Откройте страницу «Поиск» в «Мой ПФЦ».';
        return;
      }
      const [{ result: page }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          text: document.body.innerText,
          addresses: [...document.querySelectorAll('input')]
            .filter(input => input.getClientRects().length)
            .map(input => input.value.trim())
            .filter(value => /^\d{2}\.\d{2}\.\d{2,}$/u.test(value))
        })
      });
      const result = parseResult(page.text, page.addresses);
      if (!result.error) {
        snapshot = {
          id: crypto.randomUUID(), time: new Date().toISOString(),
          mx: result.mx, empty: Boolean(result.empty), rows: result.rows ?? []
        };
        send.disabled = false;
      }
      if (result.error) {
        output.textContent = result.error;
      } else if (result.empty) {
        output.textContent = result.mx + ' · По запросу ничего не найдено';
      } else {
        const total = result.rows.reduce((sum, row) => sum + row.quantity, 0);
        output.textContent = [
          result.mx + ' · ' + result.rows.length + ' БК · ' + total + ' шт',
          ...result.rows.map(row => row.barcode + ' · ' + row.quantity + ' шт\n' + row.name)
        ].join('\n\n');
      }
    } catch {
      output.textContent = 'Не удалось прочитать страницу. Откройте «Мой ПФЦ» и попробуйте снова.';
    } finally {
      button.disabled = false;
    }
  });
}
