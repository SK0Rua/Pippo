'use strict';

/* =========================================================
   Pippo — клієнт (без фреймворків, hash-роутинг)
   ========================================================= */

const $app = document.getElementById('app');
const state = { user: null, quiz: null, keyHandler: null };

const LANGS = {
  en: ['Англійська', 'en-US'], uk: ['Українська', 'uk-UA'], de: ['Німецька', 'de-DE'], fr: ['Французька', 'fr-FR'],
  es: ['Іспанська', 'es-ES'], it: ['Італійська', 'it-IT'], pl: ['Польська', 'pl-PL'], pt: ['Португальська', 'pt-PT'],
  cs: ['Чеська', 'cs-CZ'], tr: ['Турецька', 'tr-TR'], ja: ['Японська', 'ja-JP'], zh: ['Китайська', 'zh-CN'], ko: ['Корейська', 'ko-KR'],
};

const MODES = {
  choice: { icon: '🎯', name: 'Вибір відповіді', desc: 'Чотири варіанти, клавіші 1–4' },
  write: { icon: '⌨️', name: 'Написання', desc: 'Введи слово сам — Pippo пробачить дрібну описку' },
  flash: { icon: '🃏', name: 'Картки', desc: 'Переверни картку й чесно оціни себе' },
  match: { icon: '🧩', name: 'Пари', desc: 'З’єднай слова з перекладами на швидкість' },
  listen: { icon: '🎧', name: 'Диктант', desc: 'Послухай вимову й запиши слово' },
};

const SOURCES = {
  smart: ['🧠', 'Розумне повторення'],
  all: ['📚', 'Усі слова'],
  hard: ['🔥', 'Складні'],
  new: ['🌱', 'Нові'],
  starred: ['⭐', 'Обрані'],
};

const BOX_NAMES = ['Нове', '1 день', '3 дні', 'Тиждень', '2 тижні', 'Вивчено'];

/* ---------- utils ---------- */

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // лише для власних SVG
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

const svg = (markup, cls = '') => {
  const wrap = document.createElement('div');
  wrap.innerHTML = markup.trim();
  const node = wrap.firstChild;
  if (cls) node.classList.add(...cls.split(' '));
  return node;
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}
const wordsN = (n) => plural(n, 'слово', 'слова', 'слів');

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(`pippo:${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`pippo:${key}`, JSON.stringify(value)); } catch { /* приватний режим */ } },
};

function levelOf(xp) {
  const level = Math.floor(Math.sqrt(xp / 40)) + 1;
  const from = 40 * (level - 1) ** 2;
  const to = 40 * level ** 2;
  return { level, from, to, progress: (xp - from) / (to - from) };
}

/* ---------- speech ---------- */

const canSpeak = 'speechSynthesis' in window;
if (canSpeak) speechSynthesis.getVoices();

function utterance(text, lang, rate) {
  const code = (LANGS[lang] || [null, lang])[1];
  const u = new SpeechSynthesisUtterance(text);
  u.lang = code;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-').toLowerCase() === code.toLowerCase())
    || speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(code.slice(0, 2).toLowerCase()));
  if (voice) u.voice = voice;
  u.rate = rate;
  return u;
}

function speak(text, lang = 'en', rate = 1) {
  if (!canSpeak) return toast('Твій браузер не вміє озвучувати слова 😔', 'error');
  speechSynthesis.cancel();
  // Chrome інколи губить налаштування, якщо speak() іде впритул за cancel()
  setTimeout(() => speechSynthesis.speak(utterance(text, lang, rate)), 60);
}

// Розбиває слово на склади, фразу — на слова. Груба евристика, але для повільного
// промовляння цього досить: ap·point·ment, beau·ti·ful, wea·ther, in·stru·ment.
const VOWELS = /[aeiouyаеєиіїоуюя]/i;
// сполучення, з яких може починатися склад — тоді вони цілком відходять до наступного
const ONSETS = ['str', 'spr', 'scr', 'spl', 'thr', 'chr', 'shr', 'phr',
  'th', 'ch', 'sh', 'ph', 'wh', 'gh', 'qu', 'bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr',
  'gl', 'gr', 'pl', 'pr', 'sc', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'tr', 'tw'];

function speechChunks(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words;
  const word = words[0] || '';
  if (word.length < 4) return [word];

  // групи голосних
  const groups = [];
  for (let i = 0; i < word.length; i++) {
    if (!VOWELS.test(word[i])) continue;
    const last = groups[groups.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else groups.push([i, i]);
  }
  // німа «e» наприкінці слова складу не утворює: pic·ture, re·ceive
  const tail = groups[groups.length - 1];
  if (groups.length > 1 && tail[0] === tail[1] && tail[1] === word.length - 1 && /e/i.test(word[tail[1]])) groups.pop();
  if (groups.length < 2) return [word];

  const cuts = [];
  for (let g = 0; g < groups.length - 1; g++) {
    const from = groups[g][1] + 1;   // перша приголосна після голосної
    const to = groups[g + 1][0];     // наступна голосна
    const cluster = word.slice(from, to).toLowerCase();
    if (!cluster.length) { cuts.push(to); continue; }
    // до наступного складу відходить найдовше сполучення, з якого склад може починатися
    let onset = 1;
    for (const candidate of ONSETS) {
      if (candidate.length <= cluster.length && cluster.endsWith(candidate)) { onset = Math.max(onset, candidate.length); }
    }
    cuts.push(cluster.length === 1 ? from : to - onset);
  }

  const parts = [];
  let prev = 0;
  for (const cut of cuts) {
    if (cut > prev) parts.push(word.slice(prev, cut));
    prev = cut;
  }
  parts.push(word.slice(prev));
  return parts.filter(Boolean);
}

// «Повільно» не покладається на rate: частина рушіїв його ігнорує, тому промовляємо частинами з паузами
function speakSlow(text, lang = 'en') {
  if (!canSpeak) return toast('Твій браузер не вміє озвучувати слова 😔', 'error');
  speechSynthesis.cancel();
  const parts = speechChunks(text);
  // односкладове слово ділити нема на що — тоді просто повторюємо його двічі з паузою
  const chunks = parts.length > 1 ? parts : [parts[0], parts[0]];
  let i = 0;
  const next = () => {
    if (i >= chunks.length) return;
    const u = utterance(chunks[i++], lang, 0.6);
    const step = () => setTimeout(next, 260);
    u.onend = step;
    u.onerror = step;
    speechSynthesis.speak(u);
  };
  setTimeout(next, 80);
}

const speakBtn = (text, lang, title = 'Озвучити') =>
  h('button', { class: 'icon-btn', type: 'button', title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); speak(text, lang); } }, '🔊');

/* ---------- api ---------- */

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Немає зв’язку із сервером', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* порожня відповідь */ }
  if (res.status === 401 && !path.startsWith('/auth')) {
    state.user = null;
    go('#/login');
  }
  if (!res.ok) throw new ApiError((data && data.error) || 'Щось пішло не так', res.status);
  return data;
}

function setUser(user) {
  state.user = user;
  refreshPills();
}

/* ---------- ui helpers ---------- */

function toast(message, type = '', action = null) {
  const el = h('div', { class: `toast ${type}`, role: 'status' }, h('span', { class: 'grow' }, message));
  if (action) {
    el.append(h('button', {
      class: 'toast-action',
      onclick: async () => { el.remove(); await action.onClick(); },
    }, action.label));
  }
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), action ? 9000 : 3200);
}

// Показує «Скасувати» після видалення: сервер тримає копію ~90 с
function undoToast(res, what, onRestored) {
  if (!res || !res.token) return toast(`${what} видалено`);
  toast(`${what} видалено`, '', {
    label: '↩ Скасувати',
    onClick: async () => {
      try {
        await api(`/undo/${res.token}`, { method: 'POST', body: {} });
        toast('Повернуто 👍', 'good');
        await onRestored();
      } catch (e) { toast(e.message, 'error'); }
    },
  });
}

function modal(title, body, actions = [], { wide = false, onClose } = {}) {
  const close = () => {
    if (!back.isConnected) return;
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } },
    h('div', { class: `card modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', null, title), body, actions.length ? h('div', { class: 'modal-actions' }, actions) : null));
  document.body.append(back);
  document.addEventListener('keydown', onKey, true);
  const first = back.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, el: back };
}

function confirmDialog(title, text, okLabel = 'Видалити') {
  return new Promise((resolve) => {
    let m;
    const done = (v) => { m.close(); resolve(v); };
    m = modal(title, h('p', { class: 'muted' }, text), [
      h('button', { class: 'btn btn-ghost', onclick: () => done(false) }, 'Скасувати'),
      h('button', { class: 'btn btn-primary', onclick: () => done(true) }, okLabel),
    ]);
  });
}

function confetti() {
  const colors = ['#FF7A3D', '#6C5CE7', '#1F9D57', '#F5A524', '#FF8FA3', '#3BC9DB'];
  const box = h('div', { class: 'confetti' });
  for (let i = 0; i < 80; i++) {
    box.append(h('i', {
      style: {
        left: `${Math.random() * 100}%`, background: pick(colors),
        animationDuration: `${1.6 + Math.random() * 1.6}s`, animationDelay: `${Math.random() * 0.3}s`,
      },
    }));
    const piece = box.lastChild;
    piece.style.setProperty('--dx', `${(Math.random() - 0.5) * 240}px`);
    piece.style.setProperty('--rot', `${Math.random() * 900 - 450}deg`);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3600);
}

function errorBox(message) {
  return h('div', { class: 'card empty' }, svg(pippoSvg('sad')), h('h3', null, 'Ой!'), h('p', { class: 'muted' }, message),
    h('button', { class: 'btn', onclick: render }, 'Спробувати ще'));
}

function levelDots(box) {
  return h('div', { class: `lvl${box >= 5 ? ' max' : ''}`, title: `Поличка ${box}: ${BOX_NAMES[box]}` },
    [1, 2, 3, 4, 5].map((i) => h('i', { class: i <= box ? 'on' : '' })));
}

function langSelect(value) {
  return h('select', { class: 'input' }, Object.entries(LANGS).map(([code, [name]]) =>
    h('option', { value: code, selected: code === value }, name)));
}

/* ---------- Pippo ---------- */

function pippoSvg(mood = 'happy') {
  const ink = '#2A2536';
  const eyes = {
    happy: `<path d="M37 49 Q44 40 51 49" stroke="${ink}" stroke-width="4.5" fill="none" stroke-linecap="round"/>
            <path d="M69 49 Q76 40 83 49" stroke="${ink}" stroke-width="4.5" fill="none" stroke-linecap="round"/>`,
    neutral: `<circle cx="44" cy="47" r="6.5" fill="${ink}"/><circle cx="46" cy="44.5" r="2.2" fill="#fff"/>
              <circle cx="76" cy="47" r="6.5" fill="${ink}"/><circle cx="78" cy="44.5" r="2.2" fill="#fff"/>`,
    wow: `<circle cx="44" cy="46" r="9" fill="#fff" stroke="${ink}" stroke-width="3"/><circle cx="45" cy="47" r="5" fill="${ink}"/>
          <circle cx="76" cy="46" r="9" fill="#fff" stroke="${ink}" stroke-width="3"/><circle cx="77" cy="47" r="5" fill="${ink}"/>`,
    sad: `<circle cx="44" cy="50" r="5.5" fill="${ink}"/><circle cx="76" cy="50" r="5.5" fill="${ink}"/>
          <path d="M35 38 L51 42 M85 38 L69 42" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>
          <path d="M84 58 q3 6 0 9 q-3 -3 0 -9z" fill="#7CC7FF"/>`,
    think: `<circle cx="46" cy="44" r="6" fill="${ink}"/><circle cx="78" cy="44" r="6" fill="${ink}"/>
            <path d="M36 36 L52 34 M68 34 L84 36" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`,
  }[mood] || '';
  const beak = mood === 'wow'
    ? '<ellipse cx="60" cy="62" rx="6" ry="7" fill="#F08A24"/><ellipse cx="60" cy="63" rx="3" ry="4" fill="#A6461A"/>'
    : '<path d="M52 57 Q60 54 68 57 L60 67 Z" fill="#F08A24"/>';
  return `<svg class="pippo pippo-${mood}" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
    <ellipse cx="60" cy="113" rx="30" ry="4.5" fill="#000" opacity=".08"/>
    <g class="p-body">
      <path d="M48 100 l-7 9 M48 100 l0 10 M48 100 l7 9 M72 100 l-7 9 M72 100 l0 10 M72 100 l7 9" stroke="#F08A24" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M55 17 C 50 3 60 1 61 10 C 64 1 73 5 66 17" fill="var(--pippo-wing)"/>
      <path d="M60 14 C 93 14 105 42 105 66 C 105 92 87 105 60 105 C 33 105 15 92 15 66 C 15 42 27 14 60 14 Z" fill="var(--pippo-body)"/>
      <ellipse cx="60" cy="80" rx="29" ry="22" fill="var(--pippo-belly)"/>
      <path d="M17 60 C 4 68 6 86 22 88 C 20 78 20 68 17 60 Z" fill="var(--pippo-wing)"/>
      <path d="M103 60 C 116 68 114 86 98 88 C 100 78 100 68 103 60 Z" fill="var(--pippo-wing)"/>
      <circle cx="31" cy="62" r="6" fill="#FF8FA3" opacity=".55"/><circle cx="89" cy="62" r="6" fill="#FF8FA3" opacity=".55"/>
      ${eyes}${beak}
    </g>
  </svg>`;
}

const PHRASES = {
  right: ['Чудово!', 'Так тримати!', 'Правильно!', 'Бездоганно!', 'Ти — легенда!', 'Pippo пишається тобою!'],
  typo: ['Майже! Маленька описка.', 'Зараховую, але глянь на написання.'],
  wrong: ['Нічого, запам’ятаємо!', 'Цього разу ні.', 'Помилки — це теж навчання.', 'Наступного разу вийде!'],
};

/* ---------- router ---------- */

const routes = {
  login: viewAuth, register: viewAuth, home: viewHome, dict: viewDict, train: viewTrain, play: viewPlay, stats: viewStats, shop: viewShop, admin: viewAdmin,
};

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  if (state.keyHandler) { document.removeEventListener('keydown', state.keyHandler); state.keyHandler = null; }
  if (canSpeak) speechSynthesis.cancel();
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const name = routes[path] ? path : 'home';
  const params = new URLSearchParams(qs || '');
  const isAuth = name === 'login' || name === 'register';
  if (!state.user && !isAuth) {
    if (path) state.afterLogin = location.hash;
    return go('#/login');
  }
  if (state.user && isAuth) return go('#/');

  const main = h('main', { class: `page page-${name}` });
  $app.replaceChildren();
  if (state.user && name !== 'play') { $app.append(topbar(name)); refreshPills(); }
  if (!isAuth) $app.append(main);
  window.scrollTo(0, 0);
  try {
    await routes[name](isAuth ? $app : main, params, () => seq === renderSeq);
  } catch (e) {
    if (seq === renderSeq && e.status !== 401) main.append(errorBox(e.message));
  }
}

function topbar(active) {
  const link = (route, icon, label) =>
    h('a', { href: `#/${route === 'home' ? '' : route}`, class: active === route ? 'active' : '' }, h('span', { class: 'ni' }, icon), h('span', null, label));
  return h('header', { class: 'topbar' },
    h('a', { class: 'logo', href: '#/' }, svg(pippoSvg('happy')), 'Pippo'),
    h('nav', { class: 'nav' },
      link('home', '🏠', 'Головна'), link('dict', '📖', 'Словник'), link('train', '🎯', 'Тренування'), link('shop', '🛍️', 'Паки'), link('stats', '📊', 'Прогрес')),
    h('div', { class: 'pills', id: 'pills' }),
    state.user.isAdmin ? h('a', { class: 'btn btn-ghost btn-sm', href: '#/admin', title: 'Адмінка' }, '📊') : null,
    h('button', { class: 'btn btn-ghost btn-sm user-btn', title: 'Вийти', onclick: logout }, h('span', { class: 'un' }, state.user.username), ' ↪'));
}

function refreshPills() {
  const box = document.getElementById('pills');
  if (!box || !state.user) return;
  const u = state.user;
  const lvl = levelOf(u.xp);
  box.replaceChildren(
    h('div', { class: `pill${u.todayAnswers ? '' : ' cold'}`, title: u.todayAnswers ? 'Серія днів поспіль' : 'Потренуйся сьогодні, щоб зберегти серію' },
      '🔥', u.streak, h('span', { class: 'pl' }, ' дн.')),
    h('div', { class: 'pill', title: `${u.xp} XP` }, '⭐', h('span', { class: 'pl' }, 'Рівень '), lvl.level),
    h('button', { class: 'pill pill-grains', title: 'Зернятка — звідки й куди', onclick: grainsModal }, '🌾', u.grains));
}

async function logout() {
  await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  state.user = null;
  go('#/login');
}

/* =========================================================
   Auth
   ========================================================= */

function viewAuth(root) {
  const isLogin = location.hash.includes('login');
  const error = h('div', { class: 'form-error', role: 'alert' });
  const username = h('input', { class: 'input', name: 'username', autocomplete: 'username', required: true, maxlength: 24 });
  const password = h('input', { class: 'input', name: 'password', type: 'password', autocomplete: isLogin ? 'current-password' : 'new-password', required: true, minlength: 6 });
  const submit = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, isLogin ? 'Увійти' : 'Створити акаунт');

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        const { user } = await api(`/auth/${isLogin ? 'login' : 'register'}`, { method: 'POST', body: { username: username.value, password: password.value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
        state.user = user;
        const back = state.afterLogin;
        state.afterLogin = null;
        go(back || (isLogin ? '#/' : '#/dict'));
        if (!isLogin) toast(`Привіт, ${user.username}! Я створив тобі перший словник 🐣`, 'good');
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
      }
    },
  },
  h('div', { class: 'tabs' },
    h('a', { href: '#/login', class: isLogin ? 'active' : '' }, 'Вхід'),
    h('a', { href: '#/register', class: isLogin ? '' : 'active' }, 'Реєстрація')),
  h('h2', null, isLogin ? 'З поверненням!' : 'Почнімо вчити слова'),
  h('label', { class: 'field' }, h('span', null, 'Ім’я користувача'), username),
  h('label', { class: 'field' }, h('span', null, isLogin ? 'Пароль' : 'Пароль (мінімум 6 символів)'), password),
  error,
  submit);

  root.replaceChildren(h('div', { class: 'auth' },
    h('div', { class: 'auth-art' },
      svg(pippoSvg(isLogin ? 'happy' : 'wow')),
      h('h1', null, 'Pippo'),
      h('p', { class: 'muted' }, 'Твій кишеньковий словник, який не дає словам забутися.'),
      h('ul', null,
        h('li', null, '📖 Власні словники для будь-яких мов'),
        h('li', null, '🧠 Розумне повторення в потрібний момент'),
        h('li', null, '🎯 П’ять режимів тренування'),
        h('li', null, '🔥 Серії, рівні й денна ціль'))),
    h('div', { class: 'auth-form' }, form)));
  username.focus();
}

/* =========================================================
   Home
   ========================================================= */

async function viewHome(main, _params, alive) {
  const [stats, { decks }] = await Promise.all([api('/stats'), api('/decks')]);
  if (!alive()) return;
  setUser(stats.user);
  const { totals, user } = stats;
  const hour = new Date().getHours();
  const hello = hour < 6 ? 'Не спиться?' : hour < 12 ? 'Доброго ранку' : hour < 18 ? 'Добрий день' : 'Добрий вечір';

  if (totals.total === 0) {
    main.append(h('div', { class: 'card empty' },
      svg(pippoSvg('wow')),
      h('h1', null, `${hello}, ${user.username}!`),
      h('p', { class: 'muted' }, 'Твій словник поки порожній. Додай перші слова або візьми мій стартовий набір.'),
      h('div', { class: 'row-center' },
        h('a', { class: 'btn btn-primary btn-lg', href: '#/dict' }, '✏️ Додати слова'),
        h('a', { class: 'btn btn-lg', href: '#/shop' }, '🎁 Вибрати пак слів у подарунок'))));
    return;
  }

  let message;
  if (totals.due > 0) message = `У тебе ${wordsN(totals.due)} на повторення. Саме час, поки не забулися!`;
  else if (totals.fresh > 0) message = `Усе повторено! Є ще ${wordsN(totals.fresh)}, які ще чекають на перше тренування.`;
  else message = 'Усе повторено — я пишаюся! Додай нових слів, щоб рости далі.';
  if (user.streak >= 3) message += ` Серія: ${user.streak} дн. 🔥`;

  const reviewCount = totals.due || totals.fresh;
  const hero = h('div', { class: 'card hero span-2' },
    svg(pippoSvg(totals.due ? 'neutral' : 'happy')),
    h('div', null,
      h('h1', null, `${hello}, ${user.username}!`),
      h('div', { class: 'bubble', style: { marginTop: '10px' } }, message),
      h('div', { class: 'hero-actions' },
        reviewCount
          ? h('button', { class: 'btn btn-primary btn-lg', onclick: () => startQuiz({ mode: store.get('lastMode', 'choice'), source: 'smart', count: Math.min(20, Math.max(5, reviewCount)), direction: 'mixed' }) },
            `▶ ${totals.due ? 'Повторити' : 'Вчити'} ${wordsN(Math.min(20, reviewCount))}`)
          : h('a', { class: 'btn btn-primary btn-lg', href: '#/dict' }, '✏️ Додати слова'),
        h('a', { class: 'btn btn-lg', href: '#/train' }, '🎯 Інше тренування'))));

  // денна ціль
  const done = user.todayAnswers;
  const goal = user.dailyGoal;
  const pct = Math.min(1, done / goal);
  const C = 2 * Math.PI * 46;
  const goalCard = h('div', { class: 'card' },
    h('h3', null, '🎯 Денна ціль'),
    h('div', { class: 'goal', style: { marginTop: '12px' } },
      svg(`<svg class="ring${pct >= 1 ? ' done' : ''}" viewBox="0 0 110 110">
        <circle class="track" cx="55" cy="55" r="46"/>
        <circle class="value" cx="55" cy="55" r="46" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
        <text x="55" y="62" text-anchor="middle">${pct >= 1 ? '✓' : Math.round(pct * 100) + '%'}</text></svg>`),
      h('div', null,
        h('b', { style: { fontSize: '22px' } }, `${done} / ${goal}`),
        h('p', { class: 'muted' }, pct >= 1 ? 'Ціль виконано! Усе, що далі, — бонус.' : `Ще ${goal - done} відповідей до цілі`),
        h('p', { class: 'muted small', style: { marginTop: '6px' } }, `🔥 Серія: ${user.streak} · рекорд ${user.bestStreak}`))),
    h('button', { class: 'home-grains', onclick: grainsModal },
      h('div', { class: 'meter-label small' }, h('span', null, `🌾 Зернятка за навчання сьогодні`), h('b', null, `${stats.grainsToday.learned} / ${stats.grainsToday.learnCap}`)),
      progressBar(stats.grainsToday.learned, stats.grainsToday.learnCap)),
    stats.deal ? h('a', { class: 'deal-link', href: `#/shop?pack=${stats.deal.id}` },
      packIcon(stats.deal.id, 'pack-icon pack-icon-sm'),
      h('span', null, h('span', { class: 'muted small' }, 'Пак дня −30%'), h('b', null, stats.deal.title)), '→') : null);

  const wod = stats.wordOfDay;
  const wodCard = wod && h('div', { class: 'card wod' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('h3', null, '✨ Слово дня'), levelDots(wod.box)),
    h('div', { class: 'term', style: { marginTop: '10px' } }, wod.term, speakBtn(wod.term, wod.langFrom)),
    (() => {
      const btn = h('button', { class: 'reveal', onclick: () => {
        btn.classList.add('shown');
        btn.textContent = wod.translation;
      } }, '👀 Натисни, щоб перевірити себе');
      return btn;
    })(),
    wod.example ? h('p', { class: 'example' }, `«${wod.example}»`) : null);

  // швидке додавання
  const qDeck = h('select', { class: 'input' }, decks.map((d) => h('option', { value: d.id }, d.name)));
  const qTerm = h('input', { class: 'input', placeholder: 'Слово', maxlength: 200 });
  const qTr = h('input', { class: 'input', placeholder: 'Переклад (підкаже Pippo)', maxlength: 200 });
  const qHint = h('div', { class: 'ai-hint', 'aria-live': 'polite' });
  const qAuto = autoTranslate({ term: qTerm, translation: qTr, getDeckId: () => qDeck.value, hint: qHint });
  const quick = h('div', { class: 'card' },
    h('h3', null, '⚡ Швидко додати слово'),
    h('form', {
      class: 'grid', style: { marginTop: '12px', gap: '10px' },
      onsubmit: async (e) => {
        e.preventDefault();
        if (!qTerm.value.trim()) return qTerm.focus();
        if (!qTr.value.trim()) { if (!(await qAuto.suggest())) qTr.focus(); return; }
        try {
          await api('/words', { method: 'POST', body: { deckId: qDeck.value, term: qTerm.value, translation: qTr.value, example: '', transcription: qAuto.transcription() } });
          toast(`«${qTerm.value.trim()}» додано 👍`, 'good');
          qTerm.value = ''; qTr.value = ''; qAuto.reset(); qTerm.focus();
        } catch (err) { toast(err.message, 'error'); }
      },
    }, decks.length > 1 ? qDeck : null, h('div', { class: 'quick-add' }, qTerm, qTr, h('button', { class: 'btn btn-violet' }, 'Додати')), qHint,
    h('div', { class: 'row-start' },
      h('a', { class: 'btn btn-ghost btn-sm', href: `#/dict?batch=1&deck=${decks[0] ? decks[0].id : ''}` }, '📝 Кілька слів одразу'),
      h('a', { class: 'btn btn-ghost btn-sm', href: `#/dict?capture=${encodeURIComponent('{}')}` }, '✨ Слово з речення'))));
  if (decks.length <= 1) qDeck.style.display = 'none';

  const hard = h('div', { class: 'card' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } },
      h('h3', null, '🧗 Найскладніші слова'),
      stats.hardest.length ? h('button', { class: 'btn btn-sm', onclick: () => startQuiz({ mode: 'write', source: 'hard', count: 10, direction: 'forward' }) }, 'Тренувати') : null),
    stats.hardest.length
      ? h('div', { style: { marginTop: '8px' } }, stats.hardest.map((w) => h('div', { class: 'word-mini' },
        h('div', null, h('b', null, w.term), h('span', { class: 'muted' }, ` — ${w.translation}`)),
        h('span', { class: 'acc' }, `${Math.round((w.misses / (w.hits + w.misses)) * 100)}% помилок`))))
      : h('p', { class: 'muted', style: { marginTop: '8px' } }, 'Поки що помилок немає. Або це геніально, або тренувань ще не було 😉'));

  main.append(h('div', { class: 'grid cols-home' }, hero, wodCard || quick, goalCard, wodCard ? quick : null, hard));
}

/* =========================================================
   Dictionary
   ========================================================= */

async function viewDict(main, params, alive) {
  const { decks } = await api('/decks');
  if (!alive()) return;
  if (!decks.length) {
    main.append(h('div', { class: 'card empty' }, svg(pippoSvg('think')), h('h2', null, 'Немає жодного словника'),
      h('div', { class: 'row-center' }, h('button', { class: 'btn btn-primary', onclick: () => deckModal() }, '+ Створити словник'),
        h('a', { class: 'btn', href: '#/shop' }, '🛍️ Паки слів'))));
    return;
  }
  const deck = decks.find((d) => String(d.id) === params.get('deck')) || decks.find((d) => d.id === store.get('deck')) || decks[0];
  store.set('deck', deck.id);
  const { words } = await api(`/words?deckId=${deck.id}`);
  if (!alive()) return;

  let filter = 'all';
  let query = '';

  const aside = h('aside', { class: 'decks' },
    decks.map((d) => h('a', { class: `deck-item${d.id === deck.id ? ' active' : ''}`, href: `#/dict?deck=${d.id}` },
      h('span', { class: 'dn' }, d.packId ? h('img', { class: 'deck-icon', src: `/packs/${d.packId}.svg`, alt: '' }) : null, d.name),
      h('span', { class: 'dm' }, `${d.langFrom.toUpperCase()} → ${d.langTo.toUpperCase()} · ${wordsN(d.total)}${d.due ? ` · ⏰ ${d.due}` : ''}`),
      h('div', { class: 'deck-bar' }, h('i', { style: { width: `${d.total ? (d.mastered / d.total) * 100 : 0}%` } })))),
    h('button', { class: 'btn btn-ghost', onclick: () => deckModal() }, '+ Новий словник'),
    h('a', { class: 'btn btn-ghost', href: '#/shop' }, '🛍️ Паки слів'));

  // форма додавання
  const term = h('input', { class: 'input', placeholder: `Слово (${LANGS[deck.langFrom][0].toLowerCase()})`, maxlength: 200, 'aria-label': 'Слово' });
  const translation = h('input', { class: 'input', placeholder: 'Переклад (або залиш порожнім — підкаже Pippo)', maxlength: 200, 'aria-label': 'Переклад' });
  const example = h('input', { class: 'input', placeholder: 'Приклад речення (необов’язково)', maxlength: 500, 'aria-label': 'Приклад' });
  const addHint = h('div', { class: 'ai-hint', 'aria-live': 'polite' });
  const auto = autoTranslate({ term, translation, example, getDeckId: () => deck.id, hint: addHint });
  const addForm = h('form', {
    class: 'add-word',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!term.value.trim()) return term.focus();
      // Переклад порожній — спершу просимо Pippo, а додаємо наступним Enter
      if (!translation.value.trim()) { if (!(await auto.suggest())) translation.focus(); return; }
      try {
        const { word } = await api('/words', { method: 'POST', body: { deckId: deck.id, term: term.value, translation: translation.value, example: example.value, transcription: auto.transcription() } });
        words.unshift(word);
        term.value = translation.value = example.value = '';
        auto.reset();
        term.focus();
        renderList();
        updateCount();
      } catch (err) { toast(err.message, 'error'); }
    },
  }, term, translation, example, h('button', { class: 'btn btn-primary' }, '+ Додати'));

  const elsewhere = h('div', { class: 'elsewhere' });
  const search = h('input', {
    class: 'input search', type: 'search', placeholder: '🔎 Пошук у цьому словнику й по всіх',
    oninput: debounce(() => { query = search.value; renderList(); searchEverywhere(); }, 180),
  });

  // Пошук по інших словниках — окремим блоком під списком
  let searchSeq = 0;
  async function searchEverywhere() {
    const q = query.trim();
    const my = ++searchSeq;
    if (q.length < 2) return elsewhere.replaceChildren();
    try {
      const res = await api(`/words?q=${encodeURIComponent(q)}`);
      if (my !== searchSeq) return;
      const others = res.words.filter((w) => w.deckId !== deck.id);
      if (!others.length) return elsewhere.replaceChildren();
      elsewhere.replaceChildren(
        h('h3', null, `Ще ${wordsN(others.length)} в інших словниках`),
        h('div', { class: 'words' }, others.slice(0, 30).map((w) => h('a', { class: 'word-row found', href: `#/dict?deck=${w.deckId}` },
          levelDots(w.box),
          h('div', { class: 't' }, h('span', null, w.term, w.transcription ? h('span', { class: 'tx' }, w.transcription) : null)),
          h('div', { class: 'tr' }, w.translation),
          h('span', { class: 'badge' }, w.deckName)))));
    } catch { /* пошук не критичний */ }
  }
  const chipsBox = h('div', { class: 'chips' });
  const list = h('div', { class: 'words' });
  const countEl = h('p', { class: 'muted' });
  const updateCount = () => { countEl.textContent = `${LANGS[deck.langFrom][0]} → ${LANGS[deck.langTo][0]} · ${wordsN(words.length)}`; };
  updateCount();

  const FILTERS = {
    all: ['Усі', () => true],
    fresh: ['🌱 Нові', (w) => w.hits + w.misses === 0],
    learning: ['📈 Вчу', (w) => w.hits + w.misses > 0 && w.box < 5],
    mastered: ['🏆 Вивчені', (w) => w.box >= 5],
    starred: ['⭐ Обрані', (w) => w.starred],
  };

  function renderChips() {
    chipsBox.replaceChildren(...Object.entries(FILTERS).map(([key, [label, fn]]) =>
      h('button', { class: `chip${filter === key ? ' active' : ''}`, onclick: () => { filter = key; renderChips(); renderList(); } },
        label, h('span', { class: 'count' }, words.filter(fn).length))));
  }

  function renderList() {
    const q = norm(query);
    const shown = words.filter(FILTERS[filter][1]).filter((w) => !q || norm(w.term).includes(q) || norm(w.translation).includes(q));
    renderChips();
    if (!shown.length) {
      list.replaceChildren(h('div', { class: 'empty' }, svg(pippoSvg(words.length ? 'think' : 'wow')),
        h('p', { class: 'muted' }, words.length ? 'Нічого не знайдено' : 'Словник порожній — додай перше слово вище або імпортуй список')));
      return;
    }
    list.replaceChildren(...shown.slice(0, 600).map(wordRow));
  }

  function wordRow(w) {
    const star = h('button', { class: `icon-btn${w.starred ? ' on' : ''}`, title: 'Обране', 'aria-label': 'Обране', onclick: async () => {
      try {
        const { word } = await api(`/words/${w.id}`, { method: 'PATCH', body: { starred: !w.starred } });
        Object.assign(w, word);
        row.replaceWith(wordRow(w));
        renderChips();
      } catch (e) { toast(e.message, 'error'); }
    } }, w.starred ? '★' : '☆');
    const row = h('div', { class: 'word-row' },
      levelDots(w.box),
      h('div', { class: 't' }, h('span', null, w.term, w.transcription ? h('span', { class: 'tx' }, w.transcription) : null), speakBtn(w.term, deck.langFrom)),
      h('div', { class: 'tr' }, w.translation, w.example ? h('div', { class: 'ex' }, w.example) : null),
      h('div', { class: 'acts' },
        w.hits + w.misses ? h('span', { class: 'score', title: 'Правильно / помилки' }, `✓${w.hits} ✗${w.misses}`) : null,
        star,
        h('button', { class: 'icon-btn', title: 'Редагувати', 'aria-label': 'Редагувати', onclick: () => editWord(w) }, '✎'),
        h('button', { class: 'icon-btn', title: 'Видалити', 'aria-label': 'Видалити', onclick: async () => {
          if (!(await confirmDialog('Видалити слово?', `«${w.term}» зникне разом із прогресом. Дію можна буде скасувати.`))) return;
          try {
            const res = await api(`/words/${w.id}`, { method: 'DELETE' });
            words.splice(words.indexOf(w), 1);
            renderList();
            updateCount();
            undoToast(res, `«${w.term}»`, render);
          } catch (e) { toast(e.message, 'error'); }
        } }, '🗑')));
    return row;
  }

  const editWord = (w) => editWordModal(w, {
    decks,
    onSaved: (word) => {
      if (word.deckId !== deck.id) { words.splice(words.indexOf(w), 1); updateCount(); }
      else Object.assign(w, word);
      renderList();
    },
  });

  const section = h('section', null,
    h('div', { class: 'page-head' },
      h('div', { class: 'deck-head' },
        h('h1', null, deck.packId ? packIcon(deck.packId, 'pack-icon pack-icon-sm') : null, deck.name),
        countEl,
        deck.total ? h('div', { class: 'deck-progress' },
          h('div', { class: 'meter-label small' },
            h('span', { class: 'muted' }, deck.packId ? 'Прогрес пака' : 'Прогрес словника'),
            h('b', null, `🏆 ${deck.mastered} / ${deck.total}`)),
          progressBar(deck.mastered, deck.total, 'meter-green')) : null),
      h('div', { class: 'row-center' },
        h('a', { class: 'btn btn-primary', href: `#/train?deck=${deck.id}` }, '▶ Тренувати'),
        h('button', { class: 'btn btn-violet', onclick: () => captureModal(deck, decks) }, '✨ З речення'),
        h('button', { class: 'btn', onclick: () => importModal(deck) }, '⇪ Імпорт'),
        h('a', { class: 'btn', href: `/api/decks/${deck.id}/export`, download: '' }, '⇩ Експорт'),
        h('button', { class: 'icon-btn', title: 'Налаштування словника', 'aria-label': 'Налаштування словника', onclick: () => deckModal(deck) }, '⚙️'))),
    h('div', { class: 'card' }, addForm,
      h('div', { class: 'add-extra' }, addHint,
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => batchModal(deck, decks) }, '📝 Кілька слів одразу')),
      h('div', { class: 'toolbar' }, search, chipsBox),
      list, elsewhere));

  main.append(h('div', { class: 'dict' }, aside, section));
  renderList();
  term.focus();

  // Відкрито із закладки або кнопки «Вставити речення»
  if (params.has('capture')) {
    let data = {};
    try { data = JSON.parse(params.get('capture')) || {}; } catch { /* пошкоджені дані */ }
    history.replaceState(null, '', `#/dict?deck=${deck.id}`);
    captureModal(deck, decks, { text: String(data.t || ''), word: String(data.w || '') });
  } else if (params.has('batch')) {
    history.replaceState(null, '', `#/dict?deck=${deck.id}`);
    batchModal(deck, decks);
  }
}

// Спільне вікно редагування слова — і зі словника, і прямо з тренування
function editWordModal(w, { decks = null, onSaved = () => {} } = {}) {
  const t = h('input', { class: 'input', value: w.term, maxlength: 200 });
  const tr = h('input', { class: 'input', value: w.translation, maxlength: 200 });
  const ex = h('input', { class: 'input', value: w.example || '', maxlength: 500 });
  const tx = h('input', { class: 'input', value: w.transcription || '', maxlength: 100 });
  const dk = decks && decks.length > 1
    ? h('select', { class: 'input' }, decks.map((d) => h('option', { value: d.id, selected: d.id === w.deckId }, d.name)))
    : null;
  const save = async (extra = {}) => {
    try {
      const body = { term: t.value, translation: tr.value, example: ex.value, transcription: tx.value, ...extra };
      if (dk) body.deckId = Number(dk.value);
      const { word } = await api(`/words/${w.id}`, { method: 'PATCH', body });
      m.close();
      onSaved(word);
    } catch (e) { toast(e.message, 'error'); }
  };
  const m = modal('Редагувати слово', h('form', { class: 'grid', onsubmit: (e) => { e.preventDefault(); save(); } },
    h('label', { class: 'field' }, h('span', null, 'Слово'), t),
    h('label', { class: 'field' }, h('span', null, 'Переклад (варіанти через кому)'), tr),
    h('label', { class: 'field' }, h('span', null, 'Приклад'), ex),
    h('label', { class: 'field' }, h('span', null, 'Транскрипція'), tx),
    dk ? h('label', { class: 'field' }, h('span', null, 'Словник'), dk) : null,
    h('p', { class: 'muted small' }, Number.isFinite(w.hits)
      ? `Поличка: ${BOX_NAMES[w.box]} · правильно ${w.hits}, помилок ${w.misses}`
      : `Поличка: ${BOX_NAMES[w.box]}`),
    h('button', { type: 'submit', hidden: true })), [
    h('button', { class: 'btn btn-ghost btn-danger', onclick: () => save({ reset: true }) }, '↺ Скинути прогрес'),
    h('button', { class: 'btn btn-primary', onclick: () => save() }, 'Зберегти'),
  ]);
  return m;
}

function deckModal(deck) {
  const name = h('input', { class: 'input', value: deck ? deck.name : '', maxlength: 60, placeholder: 'Напр. «Англійська для подорожей»' });
  const from = langSelect(deck ? deck.langFrom : 'en');
  const to = langSelect(deck ? deck.langTo : 'uk');
  const save = async () => {
    try {
      const body = { name: name.value, langFrom: from.value, langTo: to.value };
      if (deck) await api(`/decks/${deck.id}`, { method: 'PATCH', body });
      const res = deck ? { id: deck.id } : await api('/decks', { method: 'POST', body });
      m.close();
      go(`#/dict?deck=${res.id}`);
    } catch (e) { toast(e.message, 'error'); }
  };
  const actions = [h('button', { class: 'btn btn-primary', onclick: save }, deck ? 'Зберегти' : 'Створити')];
  if (deck) {
    actions.unshift(h('button', { class: 'btn btn-ghost btn-danger', onclick: async () => {
      m.close();
      if (!(await confirmDialog('Видалити словник?', `«${deck.name}» і всі ${wordsN(deck.total)} зникнуть. Хвилину можна буде скасувати.`))) return;
      try {
        const res = await api(`/decks/${deck.id}`, { method: 'DELETE' });
        store.set('deck', null);
        go('#/dict');
        undoToast(res, `Словник «${deck.name}»`, () => go('#/dict'));
      } catch (e) { toast(e.message, 'error'); }
    } }, 'Видалити словник'));
  }
  const m = modal(deck ? 'Налаштування словника' : 'Новий словник', h('form', { class: 'grid', onsubmit: (e) => { e.preventDefault(); save(); } },
    h('label', { class: 'field' }, h('span', null, 'Назва'), name),
    h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr' } },
      h('label', { class: 'field' }, h('span', null, 'Мова слів'), from),
      h('label', { class: 'field' }, h('span', null, 'Мова перекладу'), to)),
    h('p', { class: 'muted small' }, 'Мова слів потрібна для правильної озвучки та диктанту.'),
    h('button', { type: 'submit', hidden: true })), actions);
}

function importModal(deck) {
  const text = h('textarea', { class: 'input', placeholder: 'apple;яблуко;An apple a day…\nhouse - будинок\nfriend\tдруг' });
  const file = h('input', { type: 'file', accept: '.csv,.txt,.tsv', onchange: async () => {
    if (file.files[0]) text.value = await file.files[0].text();
  } });
  const m = modal(`Імпорт у «${deck.name}»`, h('div', { class: 'grid', style: { gap: '12px' } },
    h('p', { class: 'muted small' }, 'Кожне слово з нового рядка: «слово;переклад;приклад». Також можна розділяти табуляцією, « - » або «=». Дублікати пропускаються.'),
    text,
    h('label', { class: 'field' }, h('span', null, '…або вибери файл CSV/TXT'), file)), [
    h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Скасувати'),
    h('button', { class: 'btn btn-primary', onclick: async () => {
      try {
        const { added, skipped } = await api(`/decks/${deck.id}/import`, { method: 'POST', body: { text: text.value } });
        m.close();
        toast(`Додано ${wordsN(added)}${skipped ? `, пропущено ${skipped}` : ''}`, added ? 'good' : '');
        render();
      } catch (e) { toast(e.message, 'error'); }
    } }, 'Імпортувати'),
  ]);
}

/* =========================================================
   Training setup
   ========================================================= */

async function viewTrain(main, params, alive) {
  const { decks } = await api('/decks');
  if (!alive()) return;
  const saved = store.get('train', {});
  const cfg = {
    deckId: params.get('deck') || saved.deckId || '',
    mode: saved.mode || 'choice',
    source: saved.source || 'smart',
    count: saved.count || 10,
    direction: saved.direction || 'forward',
  };
  if (cfg.deckId && !decks.some((d) => String(d.id) === String(cfg.deckId))) cfg.deckId = '';
  if (cfg.mode === 'listen' && !canSpeak) cfg.mode = 'choice';

  const total = decks.reduce((s, d) => s + d.total, 0);
  if (!total) {
    main.append(h('div', { class: 'card empty' }, svg(pippoSvg('think')), h('h2', null, 'Спершу додай слова'),
      h('p', { class: 'muted' }, 'Тренуватися поки нема на чому.'),
      h('div', { class: 'row-center' }, h('a', { class: 'btn btn-primary', href: '#/dict' }, '📖 До словника'),
        h('a', { class: 'btn', href: '#/shop' }, '🛍️ Паки слів'))));
    return;
  }

  const root = h('div', { class: 'setup' });
  main.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Тренування'), h('p', { class: 'muted' }, 'Обери, як сьогодні будемо ганяти слова'))), root);

  function draw() {
    const deck = decks.find((d) => String(d.id) === String(cfg.deckId));
    const scope = deck || { total, due: decks.reduce((s, d) => s + d.due, 0), fresh: decks.reduce((s, d) => s + d.fresh, 0) };
    const chip = (active, label, onclick, extra) => h('button', { class: `chip${active ? ' active' : ''}`, onclick }, label, extra != null ? h('span', { class: 'count' }, extra) : null);
    const set = (patch) => () => { Object.assign(cfg, patch); store.set('train', cfg); draw(); };

    root.replaceChildren(
      h('section', null, h('h3', null, 'Словник'),
        h('div', { class: 'chips' },
          chip(!deck, 'Усі словники', set({ deckId: '' }), total),
          decks.map((d) => chip(deck === d, d.name, set({ deckId: d.id }), d.total)))),
      h('section', null, h('h3', null, 'Режим'),
        h('div', { class: 'modes' }, Object.entries(MODES).map(([key, m]) =>
          h('button', { class: `mode${cfg.mode === key ? ' active' : ''}`, disabled: key === 'listen' && !canSpeak, onclick: set({ mode: key }) },
            h('span', { class: 'mi' }, m.icon), h('b', null, m.name), h('span', null, key === 'listen' && !canSpeak ? 'Браузер не підтримує озвучку' : m.desc))))),
      h('section', null, h('h3', null, 'Які слова'),
        h('div', { class: 'chips' }, Object.entries(SOURCES).map(([key, [icon, label]]) =>
          chip(cfg.source === key, `${icon} ${label}`, set({ source: key }), key === 'smart' ? (scope.due ? `⏰ ${scope.due}` : null) : key === 'new' ? scope.fresh : null))),
        cfg.source === 'smart' ? h('p', { class: 'muted small' }, 'Спершу слова, які пора повторити, потім нові, потім ті, що даються найгірше.') : null),
      h('section', null, h('h3', null, 'Скільки слів'),
        h('div', { class: 'chips' }, [5, 10, 20, 30].map((n) => chip(cfg.count === n, String(n), set({ count: n }))))),
      cfg.mode === 'match' || cfg.mode === 'listen' ? null : h('section', null, h('h3', null, 'Напрямок'),
        h('div', { class: 'chips' },
          chip(cfg.direction === 'forward', 'Слово → переклад', set({ direction: 'forward' })),
          chip(cfg.direction === 'reverse', 'Переклад → слово', set({ direction: 'reverse' })),
          chip(cfg.direction === 'mixed', '🔀 Змішано', set({ direction: 'mixed' })))),
      h('div', { class: 'start-bar' },
        h('button', { class: 'btn btn-primary btn-lg', onclick: () => startQuiz({ ...cfg, deckId: cfg.deckId || null }) }, `▶ Почати · ${MODES[cfg.mode].name}`),
        h('span', { class: 'muted small' }, 'Порада: у тренуванні працюють клавіші 1–4, Enter і пробіл')));
  }
  draw();
}

// Розкладає слова по раундах «Пар» (до 5 у раунді) так, щоб у раунді не було
// однакових слів чи перекладів, які перетинаються, — інакше пари неоднозначні.
function matchRounds(words, size = 5) {
  const key = (w) => norm(w.term);
  const clash = (a, b) => key(a) === key(b) || variants(a.translation).some((v) => variants(b.translation).includes(v));
  const rounds = [];
  for (const w of words) {
    const round = rounds.find((r) => r.length < size && !r.some((o) => clash(o, w)));
    if (round) round.push(w);
    else rounds.push([w]);
  }
  // Раунд з однієї пари нецікавий — пробуємо доповнити його словом з іншого раунду
  const last = rounds[rounds.length - 1];
  if (rounds.length > 1 && last.length === 1) {
    for (const r of rounds.slice(0, -1)) {
      const i = r.findIndex((w) => r.length > 2 && !clash(w, last[0]));
      if (i >= 0) { last.push(...r.splice(i, 1)); break; }
    }
  }
  return rounds;
}

async function startQuiz(cfg) {
  try {
    const { sessionId, words, pool } = await api('/quiz', { method: 'POST', body: cfg });
    if (!words.length) {
      const why = { hard: 'Складних слів поки немає — жодної помилки 🎉', new: 'Нових слів немає — усі вже в роботі.', starred: 'Познач слова зірочкою ☆ у словнику.' };
      return toast(why[cfg.source] || 'Немає слів для тренування', 'error');
    }
    let mode = cfg.mode;
    if (mode === 'match' && words.length < 2) mode = 'choice';
    store.set('lastMode', mode);
    const rounds = mode === 'match' ? matchRounds(words) : null;
    state.quiz = {
      cfg: { ...cfg, mode }, sessionId, mode, words: rounds ? rounds.flat() : words, rounds, round: 0, pool, index: 0, results: [], xp: 0, grains: 0,
      startedAt: Date.now(), goalCelebrated: false, capNotified: false, inflight: new Set(),
    };
    go('#/play');
  } catch (e) { toast(e.message, 'error'); }
}

/* =========================================================
   Play
   ========================================================= */

function viewPlay(main) {
  const quiz = state.quiz;
  if (!quiz) return go('#/train');
  main.classList.add('play');

  const bar = h('i');
  const xpEl = h('span', { class: 'play-xp' }, '+0 XP');
  const grainsEl = h('span', { class: 'play-grains', title: 'Зароблені зернятка' }, '+0 🌾');
  const stage = h('div', { class: 'q' });
  main.append(
    h('div', { class: 'play-head' },
      h('button', { class: 'icon-btn', title: 'Завершити', 'aria-label': 'Завершити', onclick: async () => {
        if (!quiz.results.length || (await confirmDialog('Завершити тренування?', 'Уже зараховані відповіді збережуться.', 'Завершити'))) {
          if (quiz.results.length) finish(); else { state.quiz = null; go('#/train'); }
        }
      } }, '✕'),
      h('div', { class: 'progress' }, bar),
      xpEl, grainsEl),
    stage);

  const setKeys = (fn) => {
    if (state.keyHandler) document.removeEventListener('keydown', state.keyHandler);
    state.keyHandler = (e) => {
      if (document.querySelector('.modal-back')) return;
      fn(e);
    };
    document.addEventListener('keydown', state.keyHandler);
  };

  const updateProgress = () => {
    bar.style.width = `${(quiz.results.length / quiz.words.length) * 100}%`;
    xpEl.textContent = `+${quiz.xp} XP`;
    grainsEl.textContent = `+${quiz.grains} 🌾`;
  };

  // Маленька анімація «+2 🌾» біля лічильника
  const floatGrains = (amount) => {
    const el = h('span', { class: 'grain-float' }, `+${amount} 🌾`);
    grainsEl.append(el);
    setTimeout(() => el.remove(), 1200);
  };

  // Надсилаємо відповідь на сервер (оновлює поличку, XP, серію)
  function commit(word, correct, extra = {}) {
    quiz.results.push({ word, correct, ...extra });
    updateProgress();
    const request = (async () => {
      try {
        const res = await api('/answer', { method: 'POST', body: { sessionId: quiz.sessionId, wordId: word.id, correct, hinted: !!extra.hinted } });
        quiz.xp += res.xp;
        quiz.grains += res.grains;
        if (res.grains) floatGrains(res.grains);
        updateProgress();
        setUser(res.user);
        if (res.goalReached && !quiz.goalCelebrated) {
          quiz.goalCelebrated = true;
          confetti();
          toast('🎯 Денну ціль виконано! +10 🌾', 'good');
        }
        if (res.packCompleted) {
          confetti();
          toast(`🏆 Пак «${res.packCompleted.title}» вивчено повністю! +${res.packCompleted.grains} 🌾`, 'good');
        }
        if (res.capReached && !quiz.capNotified) {
          quiz.capNotified = true;
          toast('🌾 На сьогодні зернятка за навчання зібрано. Тренуватися можна й далі — завтра буде ще!');
        }
      } catch (e) {
        if (e.status !== 401) toast(e.message, 'error');
      }
    })();
    quiz.inflight.add(request);
    request.finally(() => quiz.inflight.delete(request));
    return request;
  }

  function next() {
    quiz.index++;
    if (quiz.index >= quiz.words.length) finish();
    else ask();
  }

  function feedbackBox(kind, title, detail, onNext, word = null) {
    const mood = kind === 'good' ? pick(['happy', 'wow']) : 'sad';
    const nextBtn = h('button', { class: `btn ${kind === 'good' ? 'btn-primary' : 'btn-violet'}`, onclick: onNext }, 'Далі ⏎');
    // Побачив помилку в картці — можна виправити одразу, не виходячи з тренування
    const fix = word ? h('button', {
      class: 'icon-btn', title: 'Виправити картку', 'aria-label': 'Виправити картку',
      onclick: () => editWordModal(word, { onSaved: (updated) => { Object.assign(word, updated); toast('Картку оновлено ✎', 'good'); } }),
    }, '✎') : null;
    const box = h('div', { class: `feedback ${kind}` },
      svg(pippoSvg(mood)),
      h('div', { class: 'grow' }, h('b', null, title), detail ? h('span', null, detail) : null),
      fix, nextBtn);
    setTimeout(() => nextBtn.focus(), 0);
    return box;
  }

  function directionFor() {
    const d = quiz.cfg.direction;
    return d === 'mixed' ? (Math.random() < 0.5 ? 'forward' : 'reverse') : d || 'forward';
  }

  function sides(word, dir) {
    return dir === 'forward'
      ? { prompt: word.term, answer: word.translation, promptLang: word.langFrom, answerLang: word.langTo, answerKey: 'translation' }
      : { prompt: word.translation, answer: word.term, promptLang: word.langTo, answerLang: word.langFrom, answerKey: 'term' };
  }

  function ask() {
    updateProgress();
    if (quiz.mode === 'match') return askMatch();
    const word = quiz.words[quiz.index];
    const dir = directionFor();
    if (quiz.mode === 'choice') {
      const s = sides(word, dir);
      const correctNorm = norm(s.answer);
      const distractors = shuffle([...new Set(quiz.pool.map((p) => p[s.answerKey]))].filter((v) => norm(v) !== correctNorm)).slice(0, 3);
      if (distractors.length < 3) return askFlash(word, dir);
      return askChoice(word, s, shuffle([s.answer, ...distractors]));
    }
    if (quiz.mode === 'write') return askWrite(word, sides(word, dir));
    if (quiz.mode === 'listen') return askListen(word);
    return askFlash(word, dir);
  }

  function promptBlock(label, text, lang) {
    return h('div', { class: 'q-prompt' }, h('span', { class: 'q-label' }, label), h('div', { class: 'word' }, text, speakBtn(text, lang)));
  }

  // Речення-приклад під запитанням. Якщо питаємо «переклад → слово», саме слово ховаємо за пропуском,
  // а коли його форму в реченні не знайдено (напр. left ← leave) — показуємо речення лише після відповіді.
  function exampleBlock(word, hideTerm) {
    const box = h('div', { class: 'q-example' });
    const match = findTermInSentence(word.term, word.example);
    const render = (mode) => {
      if (mode === 'hidden') return box.replaceChildren();
      const parts = match
        ? [word.example.slice(0, match.start),
          mode === 'blank' ? h('span', { class: 'blank', 'aria-label': 'пропуск' }, '_____') : h('mark', null, word.example.slice(match.start, match.end)),
          word.example.slice(match.end)]
        : [word.example];
      box.replaceChildren(h('span', null, '«', ...parts, '»'));
      if (mode !== 'blank') box.append(speakBtn(word.example, word.langFrom, 'Озвучити речення'));
    };
    const initial = !hideTerm ? 'shown' : match ? 'blank' : 'hidden';
    render(initial);
    return { el: box, reveal: () => render('shown'), revealsLater: initial !== 'shown' };
  }

  /* --- choice --- */
  function askChoice(word, s, options) {
    let answered = false;
    const buttons = options.map((opt, i) => h('button', { class: 'option', onclick: () => choose(i) }, h('kbd', null, i + 1), h('span', null, opt)));
    const footer = h('div');
    const example = word.example ? exampleBlock(word, s.answer === word.term) : null;
    const prompt = promptBlock(s.promptLang === word.langFrom ? 'Переклади слово' : 'Як це буде?', s.prompt, s.promptLang);
    if (example) prompt.append(example.el);
    stage.replaceChildren(prompt, h('div', { class: 'options' }, buttons), footer);

    function choose(i) {
      if (answered) return;
      answered = true;
      if (example) example.reveal();
      const ok = options[i] === s.answer;
      buttons.forEach((b, j) => { b.disabled = true; if (options[j] === s.answer) b.classList.add('right'); });
      if (!ok) buttons[i].classList.add('wrong');
      commit(word, ok, { given: options[i] });
      if (ok) {
        if (s.answerLang === word.langFrom) speak(s.answer, s.answerLang);
        footer.replaceChildren(feedbackBox('good', pick(PHRASES.right), null, next, word));
        // Якщо речення щойно відкрилось — даємо трохи більше часу його прочитати
        const delay = example && example.revealsLater ? 2200 : 1100;
        setTimeout(() => { if (quiz.index === quiz.words.indexOf(word) && stage.contains(footer)) next(); }, delay);
      } else {
        footer.replaceChildren(feedbackBox('bad', pick(PHRASES.wrong), `${word.term} — ${word.translation}`, next, word));
      }
    }

    setKeys((e) => {
      if (!answered && /^[1-4]$/.test(e.key) && options[Number(e.key) - 1]) choose(Number(e.key) - 1);
      else if (answered && e.key === 'Enter') { e.preventDefault(); next(); }
    });
  }

  /* --- write & listen share typed-answer logic --- */
  function typedQuestion(word, header, answer, answerLang, { onReveal } = {}) {
    let hints = 0;
    let settled = null;
    const input = h('input', { class: 'input answer-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Твоя відповідь…', lang: answerLang });
    const hintBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: hint }, '💡 Підказка');
    const checkBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Перевірити');
    const footer = h('div');
    const form = h('form', { class: 'grid', style: { gap: '12px' }, onsubmit: (e) => { e.preventDefault(); settled ? advance() : check(); } },
      input, h('div', { class: 'row-center' }, hintBtn, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => check(true) }, 'Не знаю'), checkBtn));
    stage.replaceChildren(header, form, footer);
    setTimeout(() => input.focus(), 30);

    function hint() {
      const first = variants(answer)[0] || norm(answer);
      hints = Math.min(hints + 1, Math.max(1, first.length - 1));
      input.value = first.slice(0, hints);
      input.focus();
    }

    function check(giveUp = false) {
      if (!giveUp && !input.value.trim()) return input.focus();
      const verdict = giveUp ? 'wrong' : checkAnswer(input.value, answer);
      settled = { ok: verdict !== 'wrong', given: input.value, hinted: hints > 0 };
      input.readOnly = true;
      hintBtn.disabled = true;
      form.querySelectorAll('button').forEach((b) => { b.hidden = true; });
      input.classList.add(settled.ok ? 'right' : 'wrong');
      if (onReveal) onReveal();
      const target = answerLang === word.langFrom ? word.term : answer;
      if (settled.ok) {
        speak(word.term, word.langFrom);
        footer.replaceChildren(feedbackBox('good', verdict === 'typo' ? pick(PHRASES.typo) : pick(PHRASES.right),
          verdict === 'typo' ? `Правильно: ${answer}` : `${word.term} — ${word.translation}`, advance, word));
      } else {
        // Користувач може зарахувати відповідь, якщо ввів синонім, якого немає у словнику
        const override = giveUp ? null : h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { settled.ok = true; settled.override = true; advance(); } }, '🙋 Моя відповідь теж правильна');
        footer.replaceChildren(feedbackBox('bad', giveUp ? 'Запам’ятовуй:' : pick(PHRASES.wrong), `Правильно: ${target}`, advance, word));
        if (override) footer.firstChild.querySelector('.grow').append(override);
      }
    }

    function advance() {
      if (!settled) return;
      const s = settled;
      settled = null;
      commit(word, s.ok, { given: s.given, hinted: s.hinted });
      next();
    }

    setKeys((e) => {
      if (settled && e.key === 'Enter' && document.activeElement !== input) { e.preventDefault(); advance(); }
    });
  }

  function askWrite(word, s) {
    typedQuestion(word, promptBlock(s.promptLang === word.langFrom ? 'Напиши переклад' : 'Напиши слово', s.prompt, s.promptLang), s.answer, s.answerLang);
  }

  function askListen(word) {
    const replay = () => speak(word.term, word.langFrom);
    const header = h('div', { class: 'q-prompt' },
      h('span', { class: 'q-label' }, 'Послухай і запиши'),
      h('div', { class: 'row-center' },
        h('button', { class: 'btn btn-violet btn-lg', type: 'button', onclick: replay }, '🔊 Слухати'),
        h('button', { class: 'btn btn-lg', type: 'button', title: 'Частинами, з паузами', onclick: () => speakSlow(word.term, word.langFrom) }, '🐢 Повільно')),
      h('p', { class: 'muted small', 'data-tr': '' }, 'Підказка-переклад з’явиться після відповіді'));
    typedQuestion(word, header, word.term, word.langFrom, {
      onReveal: () => { header.querySelector('[data-tr]').textContent = `Переклад: ${word.translation}`; },
    });
    setTimeout(replay, 250);
  }

  /* --- flashcards --- */
  function askFlash(word, dir) {
    const s = sides(word, dir);
    let flipped = false;
    const card = h('div', { class: 'flash', tabindex: '0', role: 'button', 'aria-label': 'Перевернути картку', onclick: () => flip() },
      h('div', { class: 'flash-inner' },
        h('div', { class: 'flash-face' }, h('span', { class: 'q-label' }, 'Згадай'), h('div', { class: 'word' }, s.prompt),
          h('span', { class: 'muted small' }, 'натисни або пробіл, щоб перевернути')),
        h('div', { class: 'flash-face flash-back' }, h('span', { class: 'q-label' }, 'Відповідь'), h('div', { class: 'word' }, s.answer),
          word.transcription ? h('span', { class: 'muted' }, `${word.term} ${word.transcription}`) : null,
          word.example ? h('p', { class: 'example' }, `«${word.example}»`) : null, speakBtn(word.term, word.langFrom))));
    const grade = h('div', { class: 'row-center', style: { visibility: 'hidden' } },
      h('button', { class: 'btn btn-lg', onclick: () => rate(false) }, '😕 Не пам’ятаю', h('kbd', { class: 'muted small' }, ' 1')),
      h('button', { class: 'btn btn-primary btn-lg', onclick: () => rate(true) }, '😎 Знаю', h('kbd', { class: 'small' }, ' 2')));
    stage.replaceChildren(card, grade);

    function flip() {
      if (flipped) return;
      flipped = true;
      card.classList.add('flipped');
      grade.style.visibility = 'visible';
      speak(word.term, word.langFrom);
    }
    function rate(ok) {
      if (!flipped) return;
      flipped = null;
      commit(word, ok);
      next();
    }
    setKeys((e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!flipped) flip(); }
      else if (e.key === '1' || e.key === 'ArrowLeft') rate(false);
      else if (e.key === '2' || e.key === 'ArrowRight') rate(true);
    });
  }

  /* --- match pairs --- */
  function askMatch() {
    const chunk = quiz.rounds[quiz.round];
    const missed = new Set();
    let left = null;
    let right = null;
    let solved = 0;
    const roundStart = Date.now();
    const timer = h('span', { class: 'timer' }, '0.0 с');
    const tick = setInterval(() => {
      if (!stage.isConnected) return clearInterval(tick);
      timer.textContent = `${((Date.now() - roundStart) / 1000).toFixed(1)} с`;
    }, 100);

    const makeTile = (word, side) => {
      const tile = h('button', { class: 'tile', onclick: () => select(tile, word, side) }, side === 'l' ? word.term : word.translation);
      return tile;
    };
    const lefts = shuffle(chunk).map((w) => makeTile(w, 'l'));
    const rights = shuffle(chunk).map((w) => makeTile(w, 'r'));

    stage.replaceChildren(
      h('div', { class: 'q-prompt' }, h('span', { class: 'q-label' }, 'З’єднай пари'), timer),
      h('div', { class: 'match' }, h('div', { class: 'col' }, lefts), h('div', { class: 'col' }, rights)));

    function select(tile, word, side) {
      if (tile.disabled) return;
      if (side === 'l') { if (left) left.tile.classList.remove('sel'); left = { tile, word }; speak(word.term, word.langFrom); }
      else { if (right) right.tile.classList.remove('sel'); right = { tile, word }; }
      tile.classList.add('sel');
      if (!left || !right) return;

      const a = left, b = right;
      left = right = null;
      a.tile.classList.remove('sel');
      b.tile.classList.remove('sel');
      if (a.word === b.word || norm(a.word.translation) === norm(b.word.translation)) {
        // однакові переклади теж вважаємо парою — інакше пазл стає нечесним
        [a.tile, b.tile].forEach((t) => { t.classList.add('done'); t.disabled = true; });
        solved++;
        if (solved === chunk.length) roundDone();
      } else {
        [a.tile, b.tile].forEach((t) => { t.classList.remove('wrong'); void t.offsetWidth; t.classList.add('wrong'); });
        missed.add(a.word);
        missed.add(b.word);
      }
    }

    function roundDone() {
      clearInterval(tick);
      const secs = ((Date.now() - roundStart) / 1000).toFixed(1);
      chunk.forEach((w) => commit(w, !missed.has(w)));
      quiz.index += chunk.length;
      quiz.round++;
      const flawless = missed.size === 0;
      stage.append(feedbackBox(flawless ? 'good' : 'bad', flawless ? `Без жодної помилки за ${secs} с!` : `Готово за ${secs} с`,
        flawless ? null : `Помилки: ${[...missed].map((w) => w.term).join(', ')}`, () => {
          if (quiz.index >= quiz.words.length) finish(); else askMatch();
        }));
      setKeys((e) => { if (e.key === 'Enter') { e.preventDefault(); stage.querySelector('.feedback .btn').click(); } });
    }
  }

  /* --- results --- */
  async function finish() {
    if (quiz.finished) return;
    quiz.finished = true;
    if (state.keyHandler) { document.removeEventListener('keydown', state.keyHandler); state.keyHandler = null; }
    const total = quiz.results.length;
    const correct = quiz.results.filter((r) => r.correct).length;
    const duration = Math.round((Date.now() - quiz.startedAt) / 1000);
    const pct = total ? Math.round((correct / total) * 100) : 0;
    bar.style.width = '100%';

    // Спершу дочікуємося всіх відповідей, інакше сервер закриє сесію раніше за них
    await Promise.allSettled([...quiz.inflight]);
    let bonus = 0;
    try {
      const res = await api('/quiz/finish', { method: 'POST', body: { sessionId: quiz.sessionId } });
      bonus = res.bonus;
      setUser(res.user);
    } catch { /* статистика тесту не критична */ }

    const mistakes = quiz.results.filter((r) => !r.correct);
    const mood = pct >= 90 ? 'wow' : pct >= 60 ? 'happy' : pct >= 30 ? 'neutral' : 'sad';
    const title = pct === 100 ? 'Ідеально! 🏆' : pct >= 80 ? 'Супер результат!' : pct >= 50 ? 'Непогано, росте!' : 'Буде краще, обіцяю!';
    if (pct === 100 && total >= 5) confetti();

    stage.replaceChildren(h('div', { class: 'results' },
      svg(pippoSvg(mood)),
      h('h1', null, title),
      h('div', { class: 'big' }, `${pct}%`),
      h('div', { class: 'result-stats' },
        h('div', null, h('b', null, `${correct}/${total}`), h('span', { class: 'muted small' }, 'правильно')),
        h('div', null, h('b', null, `+${quiz.xp + bonus}`), h('span', { class: 'muted small' }, bonus ? `XP (бонус +${bonus})` : 'XP')),
        h('div', null, h('b', null, `+${quiz.grains}`), h('span', { class: 'muted small' }, '🌾 зерняток')),
        h('div', null, h('b', null, duration >= 60 ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : `${duration} с`), h('span', { class: 'muted small' }, 'час'))),
      mistakes.length ? h('div', { class: 'card mistakes' },
        h('h3', null, 'Над цим попрацюємо'),
        [...new Map(mistakes.map((r) => [r.word.id, r])).values()].map((r) => h('div', { class: 'word-mini' },
          h('div', null, h('b', null, r.word.term), h('span', { class: 'muted' }, ` — ${r.word.translation}`)),
          r.given ? h('span', { class: 'acc' }, `ти: ${r.given}`) : null))) : null,
      h('div', { class: 'row-center' },
        mistakes.length ? h('button', { class: 'btn btn-primary btn-lg', onclick: () => startQuiz({ ...quiz.cfg, wordIds: [...new Set(mistakes.map((r) => r.word.id))] }) }, '🔁 Повторити помилки') : null,
        h('button', { class: `btn btn-lg${mistakes.length ? '' : ' btn-primary'}`, onclick: () => startQuiz({ ...quiz.cfg, wordIds: undefined }) }, '▶ Ще раунд'),
        h('a', { class: 'btn btn-lg', href: '#/' }, '🏠 Головна'))));
    state.quiz = null;
  }

  ask();
}

/* =========================================================
   Stats
   ========================================================= */

async function viewStats(main, _params, alive) {
  const s = await api('/stats');
  if (!alive()) return;
  setUser(s.user);
  const u = s.user;
  const lvl = levelOf(u.xp);
  const acc = s.overall.answers ? Math.round((s.overall.correct / s.overall.answers) * 100) : 0;

  const tile = (value, label) => h('div', { class: 'tile-stat' }, h('b', null, value), h('span', null, label));

  // теплова карта за 17 тижнів
  const byDay = Object.fromEntries(s.heatmap.map((r) => [r.day, r]));
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 16 * 7);
  const cells = [];
  for (let i = 0; i < 17 * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const n = byDay[key] ? byDay[key].answers : 0;
    const future = d > now;
    const lv = n === 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4;
    cells.push(h('i', { class: future ? 'future' : `l${lv}`, title: future ? '' : `${d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}: ${n} відповідей` }));
  }

  const maxBox = Math.max(1, ...s.boxes);
  const MODE_NAMES = Object.fromEntries(Object.entries(MODES).map(([k, m]) => [k, `${m.icon} ${m.name}`]));

  const goalSel = h('select', { class: 'input', style: { width: 'auto' }, onchange: async () => {
    try {
      const { user } = await api('/me', { method: 'PATCH', body: { dailyGoal: Number(goalSel.value) } });
      setUser(user);
      toast('Денну ціль оновлено 🎯', 'good');
    } catch (e) { toast(e.message, 'error'); }
  } }, [10, 20, 30, 50, 100].map((n) => h('option', { value: n, selected: n === u.dailyGoal }, `${n} відповідей на день`)));

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzRow = h('div', { class: 'start-bar', style: { marginTop: '12px' } },
    h('span', null, `Часовий пояс: ${u.timezone}`),
    browserTz !== u.timezone && u.canChangeTimezone
      ? h('button', { class: 'btn btn-sm', onclick: async () => {
        if (!(await confirmDialog('Змінити часовий пояс?', `На ${browserTz}. Від нього залежить, коли починається новий день для серії та лімітів. Наступна зміна — не раніше ніж за тиждень.`, 'Змінити'))) return;
        try {
          const { user } = await api('/me', { method: 'PATCH', body: { timezone: browserTz } });
          setUser(user);
          render();
        } catch (e) { toast(e.message, 'error'); }
      } }, `Змінити на ${browserTz}`)
      : null);

  main.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Прогрес'), h('p', { class: 'muted' }, `З Pippo з ${new Date(u.createdAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })}`))),
    h('div', { class: 'grid' },
      h('div', { class: 'card level' },
        h('div', { class: 'level-num' }, lvl.level),
        h('div', { style: { flex: 1 } },
          h('h2', null, `Рівень ${lvl.level}`),
          h('p', { class: 'muted' }, `${u.xp} XP · до наступного рівня ${lvl.to - u.xp} XP`),
          h('div', { class: 'xpbar' }, h('i', { style: { width: `${lvl.progress * 100}%` } })))),
      h('div', { class: 'tiles' },
        tile(s.totals.total, 'усього слів'),
        tile(s.totals.mastered, '🏆 вивчено'),
        tile(s.totals.learning, '📈 у процесі'),
        tile(s.totals.due, '⏰ до повторення'),
        tile(`${acc}%`, '🎯 точність'),
        tile(`${u.streak} / ${u.bestStreak}`, '🔥 серія / рекорд')),
      h('div', { class: 'card' },
        h('h3', null, 'Активність'),
        h('div', { class: 'heat-wrap', style: { marginTop: '14px' } }, h('div', { class: 'heat' }, cells)),
        h('div', { class: 'legend' }, 'менше', [0, 1, 2, 3, 4].map((i) => h('i', { style: { background: `var(--heat-${i})` } })), 'більше')),
      h('div', { class: 'card' },
        h('h3', null, 'Полички пам’яті'),
        h('p', { class: 'muted small' }, 'Кожна правильна відповідь переносить слово на наступну поличку, і Pippo спитає його пізніше. Помилка повертає слово на дві полички назад.'),
        h('div', { class: 'shelves', style: { marginTop: '16px' } }, s.boxes.map((n, i) => h('div', { class: 'shelf' },
          h('b', null, n),
          h('div', { class: 'bar-area' }, h('div', { class: 'bar', style: { height: `${(n / maxBox) * 100}%` } })),
          h('span', null, BOX_NAMES[i]))))),
      s.recentTests.length ? h('div', { class: 'card', style: { overflowX: 'auto' } },
        h('h3', null, 'Останні тренування'),
        h('table', { class: 'table', style: { marginTop: '8px' } },
          h('thead', null, h('tr', null, h('th', null, 'Коли'), h('th', null, 'Режим'), h('th', null, 'Результат'), h('th', null, 'Час'))),
          h('tbody', null, s.recentTests.map((t) => h('tr', null,
            h('td', null, new Date(t.createdAt).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
            h('td', null, MODE_NAMES[t.mode] || t.mode),
            h('td', null, h('b', null, `${t.correct}/${t.total}`), t.xp ? ` 🏆` : ''),
            h('td', { class: 'muted' }, `${t.duration} с`)))))) : null,
      h('div', { class: 'card' },
        h('h3', null, '⚙️ Налаштування'),
        h('div', { class: 'start-bar', style: { marginTop: '12px' } }, h('span', null, 'Денна ціль:'), goalSel), tzRow),
      h('div', { class: 'card' },
        h('h3', null, '🔖 Закладка «У Pippo»'),
        h('p', { class: 'muted', style: { margin: '6px 0 12px' } }, 'Перетягни кнопку на панель закладок браузера. Потім на будь-якому сайті виділи слово й натисни закладку — Pippo відкриється з цим словом і реченням.'),
        bookmarkletLink())));
}

/* ---------- boot ---------- */

window.addEventListener('hashchange', render);
api('/me')
  .then(({ user }) => { state.user = user; })
  .catch(() => {})
  .finally(render);
