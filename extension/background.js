const DEFAULT_URL = 'http://localhost:3700';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'pippo-add', title: '➕ У Pippo: «%s»', contexts: ['selection'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'pippo-add') capture(tab, info.selectionText || '');
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'pippo-add') capture(tab, '');
});

async function capture(tab, selectionText) {
  let data = null;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grabSelection });
    data = res && res.result;
  } catch { /* PDF-переглядач, chrome://, file:// без дозволу — лишається selectionText */ }
  // У PDF скрипт сторінки виділення не бачить, тож беремо те, що дав браузер у меню
  if (!data || !data.w) data = { w: selectionText, t: '' };
  await openPippo(shape(data.w, data.t));
}

// Виконується на сторінці: та сама логіка, що в закладці «У Pippo» (public/capture.js)
function grabSelection() {
  const s = getSelection();
  const w = String(s).trim().slice(0, 1000);
  if (!w || !s.anchorNode) return null;
  const n = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
  let t = ((n && n.closest('p,li,blockquote,td,dd,h1,h2,h3,h4')) || n || document.body).innerText || '';
  const i = t.indexOf(w);
  if (i >= 0) {
    const a = Math.max(t.lastIndexOf('.', i - 1), t.lastIndexOf('!', i - 1), t.lastIndexOf('?', i - 1), t.lastIndexOf('\n', i - 1)) + 1;
    let b = t.slice(i + w.length).search(/[.!?\n]/);
    b = b < 0 ? t.length : i + w.length + b + 1;
    t = t.slice(a, b);
  } else t = '';
  return { w, t };
}

// Текст із PDF: рядки розірвані, слова з переносами (leav-\nes)
function clean(s) {
  return String(s || '')
    .replace(/­/g, '')
    .replace(/(\p{L})[-‐]\s*\n\s*(\p{Ll})/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

// Коротке виділення — слово чи фраза; довге — речення, у якому користувач сам клікне слово
function shape(w, t) {
  w = clean(w);
  t = clean(t);
  if (w.split(' ').length > 4) return { w: '', t: w.slice(0, 1000) };
  return { w: w.slice(0, 100), t: t.slice(0, 1000) };
}

async function openPippo(data) {
  const { pippoUrl = DEFAULT_URL } = await chrome.storage.sync.get('pippoUrl');
  // ?r= змушує сторінку перезавантажитись, щоб не лишилось вікна від попереднього слова
  const url = `${pippoUrl.replace(/\/+$/, '')}/?r=${Date.now()}#/dict?capture=${encodeURIComponent(JSON.stringify(data))}`;
  const { winId } = await chrome.storage.session.get('winId');
  if (winId) {
    try {
      const [t] = await chrome.tabs.query({ windowId: winId });
      await chrome.tabs.update(t.id, { url });
      await chrome.windows.update(winId, { focused: true });
      return;
    } catch { /* вікно вже закрили */ }
  }
  const win = await chrome.windows.create({ url, type: 'popup', width: 780, height: 860 });
  await chrome.storage.session.set({ winId: win.id });
}
