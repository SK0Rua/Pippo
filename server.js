const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { db, tx } = require('./db');
const ai = require('./ai');
const economy = require('./economy');
const packs = require('./packs');

const PORT = Number(process.env.PORT) || 3700;
const DAY = 86400000;
const SESSION_TTL = 30 * DAY;
// Інтервали повторення (у днях) для поличок Лейтнера 0..5
const INTERVALS = [0, 1, 3, 7, 14, 30];
const MAX_BOX = INTERVALS.length - 1;
const LANGS = ['en', 'uk', 'de', 'fr', 'es', 'it', 'pl', 'pt', 'cs', 'tr', 'ja', 'zh', 'ko'];
const MODES = ['choice', 'write', 'flash', 'match', 'listen'];
const HARD_MODES = ['write', 'listen'];

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Змінювальні запити приймаємо лише як JSON — звичайна HTML-форма з чужого сайту так не вміє.
app.use('/api', (req, res, next) => {
  if (!['GET', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Очікується JSON' });
  }
  next();
});

/* ---------- helpers ---------- */

const bad = (res, error, status = 400) => res.status(status).json({ error });
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const toInt = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : NaN);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* пошкоджена кука — ігноруємо */
    }
  }
  return out;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function shiftDay(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

function publicUser(u) {
  const day = economy.userDay(u);
  const alive = u.last_day === day || u.last_day === shiftDay(day, -1);
  const today = db.prepare('SELECT answers, correct FROM activity WHERE user_id = ? AND day = ?').get(u.id, day);
  return {
    id: u.id,
    username: u.username,
    dailyGoal: u.daily_goal,
    xp: u.xp,
    streak: alive ? u.streak : 0,
    bestStreak: u.best_streak,
    todayAnswers: today ? today.answers : 0,
    grains: u.grains,
    isAdmin: Boolean(u.is_admin),
    timezone: u.timezone,
    canChangeTimezone: Date.now() - u.tz_changed_at > 7 * DAY,
    createdAt: u.created_at,
  };
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').run(token, userId, Date.now() + SESSION_TTL);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `pippo_sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`);
}

function sessionUser(req) {
  const token = parseCookies(req.headers.cookie).pippo_sid;
  if (!token) return null;
  return db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?')
    .get(token, Date.now());
}

function auth(req, res, next) {
  const user = sessionUser(req);
  if (!user) return bad(res, 'Потрібно увійти', 401);
  req.user = user;
  next();
}

const attempts = new Map();
function limiter(req, res, next) {
  const now = Date.now();
  let entry = attempts.get(req.ip);
  if (!entry || entry.reset < now) {
    entry = { n: 0, reset: now + 15 * 60000 };
    attempts.set(req.ip, entry);
  }
  if (++entry.n > 30) return bad(res, 'Забагато спроб. Спробуй за кілька хвилин.', 429);
  next();
}

const ownDeck = (uid, id) => db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(id, uid);
const ownWord = (uid, id) => db.prepare('SELECT * FROM words WHERE id = ? AND user_id = ?').get(id, uid);

const WORD_COLS = `w.id, w.deck_id AS deckId, w.term, w.translation, w.example, w.transcription, w.box, w.due,
  w.hits, w.misses, w.starred, w.created_at AS createdAt`;

function insertWord(uid, deckId, term, translation, example = '', transcription = '') {
  const info = db
    .prepare('INSERT INTO words (user_id, deck_id, term, translation, example, transcription, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid, deckId, term, translation, example, transcription, Date.now());
  return Number(info.lastInsertRowid);
}

function findDuplicate(deckId, term, exceptId = 0) {
  return db.prepare('SELECT id FROM words WHERE deck_id = ? AND lower(term) = lower(?) AND id != ?').get(deckId, term, exceptId);
}

function createDeck(uid, name, langFrom, langTo) {
  const info = db
    .prepare('INSERT INTO decks (user_id, name, lang_from, lang_to, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uid, name, langFrom, langTo, Date.now());
  return Number(info.lastInsertRowid);
}

/* ---------- auth ---------- */

const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;
// Адміністратори задаються через PIPPO_ADMIN (імена через кому)
const ADMIN_NAMES = (process.env.PIPPO_ADMIN || '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean);
const isAdminName = (username) => ADMIN_NAMES.includes(String(username).toLowerCase());

app.post('/api/auth/register', limiter, (req, res) => {
  const username = clean(req.body.username, 40);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!USERNAME_RE.test(username)) return bad(res, 'Ім’я: 3–24 символи — літери, цифри, «_», «.» або «-»');
  if (password.length < 6 || password.length > 200) return bad(res, 'Пароль має містити щонайменше 6 символів');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return bad(res, 'Це ім’я вже зайняте', 409);

  const timezone = economy.validTimezone(req.body.timezone) ? req.body.timezone : 'Europe/Kyiv';

  const uid = tx(() => {
    const info = db
      .prepare('INSERT INTO users (username, pass, timezone, created_at) VALUES (?, ?, ?, ?)')
      .run(username, hashPassword(password), timezone, Date.now());
    const id = Number(info.lastInsertRowid);
    createDeck(id, 'Мій словник', 'en', 'uk');
    if (isAdminName(username)) db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(id);
    economy.grant(id, economy.REWARDS.start, 'start', { day: economy.userDay(getUser(id)), note: 'Подарунок на старт', once: 'start' });
    return id;
  });
  createSession(res, uid);
  res.json({ user: publicUser(getUser(uid)) });
});

app.post('/api/auth/login', limiter, (req, res) => {
  const username = clean(req.body.username, 40);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.pass)) return bad(res, 'Невірне ім’я або пароль', 401);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires < ?').run(user.id, Date.now());
  createSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie).pippo_sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'pippo_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = sessionUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

app.patch('/api/me', auth, (req, res) => {
  if ('dailyGoal' in req.body) {
    const goal = toInt(req.body.dailyGoal);
    // Мінімум 10 — бо за виконану ціль нараховуються зернятка
    if (!(goal >= 10 && goal <= 200)) return bad(res, 'Денна ціль: від 10 до 200 відповідей');
    db.prepare('UPDATE users SET daily_goal = ? WHERE id = ?').run(goal, req.user.id);
  }
  if ('timezone' in req.body) {
    if (!economy.validTimezone(req.body.timezone)) return bad(res, 'Невідомий часовий пояс');
    // Часовий пояс визначає «сьогодні» для лімітів, тож змінювати його можна не частіше ніж раз на тиждень
    if (req.body.timezone !== req.user.timezone) {
      if (Date.now() - req.user.tz_changed_at < 7 * DAY) return bad(res, 'Часовий пояс можна змінювати раз на тиждень');
      db.prepare('UPDATE users SET timezone = ?, tz_changed_at = ? WHERE id = ?').run(req.body.timezone, Date.now(), req.user.id);
    }
  }
  res.json({ user: publicUser(getUser(req.user.id)) });
});

app.get('/api/grains', auth, (req, res) => {
  const day = economy.userDay(req.user);
  res.json({
    balance: req.user.grains,
    today: economy.todaySummary(req.user.id, day),
    rewards: economy.REWARDS,
    history: economy.history(req.user.id),
  });
});

/* ---------- адмінка ---------- */

function requireAdmin(req, res, next) {
  if (!req.user.is_admin) return bad(res, 'Тільки для адміністратора', 403);
  next();
}

app.get('/api/admin/stats', auth, requireAdmin, (req, res) => {
  const now = Date.now();
  const day = economy.userDay(req.user);
  const since = (days) => now - days * 24 * HOUR;
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);

  res.json({
    users: {
      total: one('SELECT COUNT(*) AS n FROM users').n,
      newWeek: one('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', since(7)).n,
      activeToday: one('SELECT COUNT(DISTINCT user_id) AS n FROM activity WHERE day = ?', day).n,
      activeWeek: one('SELECT COUNT(DISTINCT user_id) AS n FROM activity WHERE day >= ?', shiftDay(day, -6)).n,
    },
    learning: {
      words: one('SELECT COUNT(*) AS n FROM words').n,
      mastered: one(`SELECT COUNT(*) AS n FROM words WHERE box >= ${MAX_BOX}`).n,
      answersToday: one('SELECT COALESCE(SUM(answers), 0) AS n FROM activity WHERE day = ?', day).n,
      answersWeek: one('SELECT COALESCE(SUM(answers), 0) AS n FROM activity WHERE day >= ?', shiftDay(day, -6)).n,
      accuracy: (() => {
        const r = one('SELECT COALESCE(SUM(answers), 0) AS a, COALESCE(SUM(correct), 0) AS c FROM activity');
        return r.a ? Math.round((r.c / r.a) * 100) : 0;
      })(),
      tests: one('SELECT COUNT(*) AS n FROM tests').n,
      byMode: all('SELECT mode, COUNT(*) AS n FROM tests GROUP BY mode ORDER BY n DESC'),
    },
    economy: {
      granted: one("SELECT COALESCE(SUM(amount), 0) AS n FROM grains WHERE amount > 0").n,
      spent: -one("SELECT COALESCE(SUM(amount), 0) AS n FROM grains WHERE amount < 0").n,
      balance: one('SELECT COALESCE(SUM(grains), 0) AS n FROM users').n,
      purchases: one('SELECT COUNT(*) AS n FROM user_packs').n,
      topPacks: all('SELECT pack_id AS packId, COUNT(*) AS n, COALESCE(SUM(price), 0) AS spent FROM user_packs GROUP BY pack_id ORDER BY n DESC, packId LIMIT 10'),
      byKind: all('SELECT kind, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM grains GROUP BY kind ORDER BY ABS(SUM(amount)) DESC'),
    },
    ai: {
      limits: AI_LIMITS,
      wordsToday: aiUsed(null, since(1)),
      wordsWeek: aiUsed(null, since(7)),
      requestsToday: one('SELECT COUNT(*) AS n FROM ai_usage WHERE created_at > ?', since(1)).n,
      failedToday: one('SELECT COUNT(*) AS n FROM ai_usage WHERE ok = 0 AND created_at > ?', since(1)).n,
      byKind: all('SELECT kind, COUNT(*) AS n, COALESCE(SUM(words), 0) AS words FROM ai_usage WHERE created_at > ? GROUP BY kind ORDER BY words DESC', since(7)),
    },
    signups: all("SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM users WHERE created_at > ? GROUP BY day ORDER BY day", since(30)),
    activity: all('SELECT day, COALESCE(SUM(answers), 0) AS answers, COUNT(DISTINCT user_id) AS users FROM activity WHERE day >= ? GROUP BY day ORDER BY day', shiftDay(day, -29)),
    topUsers: all(`SELECT u.id, u.username, u.created_at AS createdAt, u.last_day AS lastDay, u.streak, u.xp, u.grains, u.is_admin AS isAdmin,
        (SELECT COUNT(*) FROM words w WHERE w.user_id = u.id) AS words,
        (SELECT COALESCE(SUM(answers), 0) FROM activity a WHERE a.user_id = u.id) AS answers,
        (SELECT COALESCE(SUM(words), 0) FROM ai_usage x WHERE x.user_id = u.id AND x.created_at > ?) AS aiWords
      FROM users u ORDER BY answers DESC, u.id LIMIT 50`, since(1)),
  });
});

/* ---------- decks ---------- */

app.get('/api/decks', auth, (req, res) => {
  const decks = db
    .prepare(
      `SELECT d.id, d.name, d.lang_from AS langFrom, d.lang_to AS langTo, d.pack_id AS packId,
         COUNT(w.id) AS total,
         COALESCE(SUM(w.box >= ${MAX_BOX}), 0) AS mastered,
         COALESCE(SUM(w.hits + w.misses > 0 AND w.due <= ?), 0) AS due,
         COALESCE(SUM(w.hits + w.misses = 0), 0) AS fresh
       FROM decks d LEFT JOIN words w ON w.deck_id = d.id
       WHERE d.user_id = ? GROUP BY d.id ORDER BY d.created_at`
    )
    .all(Date.now(), req.user.id);
  res.json({ decks });
});

function deckInput(body) {
  const name = clean(body.name, 60);
  const langFrom = LANGS.includes(body.langFrom) ? body.langFrom : 'en';
  const langTo = LANGS.includes(body.langTo) ? body.langTo : 'uk';
  return { name, langFrom, langTo };
}

app.post('/api/decks', auth, (req, res) => {
  const { name, langFrom, langTo } = deckInput(req.body);
  if (!name) return bad(res, 'Дай словнику назву');
  const count = db.prepare('SELECT COUNT(*) AS n FROM decks WHERE user_id = ?').get(req.user.id).n;
  if (count >= 150) return bad(res, 'Максимум 150 словників');
  res.json({ id: createDeck(req.user.id, name, langFrom, langTo) });
});

app.patch('/api/decks/:id', auth, (req, res) => {
  const deck = ownDeck(req.user.id, toInt(req.params.id));
  if (!deck) return bad(res, 'Словник не знайдено', 404);
  const { name, langFrom, langTo } = deckInput({ name: deck.name, langFrom: deck.lang_from, langTo: deck.lang_to, ...req.body });
  if (!name) return bad(res, 'Дай словнику назву');
  db.prepare('UPDATE decks SET name = ?, lang_from = ?, lang_to = ? WHERE id = ?').run(name, langFrom, langTo, deck.id);
  res.json({ ok: true });
});

// Видалене можна повернути протягом UNDO_TTL — копія лежить у пам'яті процесу
const UNDO_TTL = 90000;
const undoStore = new Map();

function rememberUndo(userId, label, restore) {
  const token = crypto.randomBytes(9).toString('hex');
  undoStore.set(token, { userId, label, restore, expires: Date.now() + UNDO_TTL });
  for (const [key, item] of undoStore) if (item.expires < Date.now()) undoStore.delete(key);
  return { token, undoLabel: label, undoSeconds: UNDO_TTL / 1000 };
}

app.post('/api/undo/:token', auth, (req, res) => {
  const item = undoStore.get(String(req.params.token));
  if (!item || item.userId !== req.user.id || item.expires < Date.now()) return bad(res, 'Уже пізно скасовувати', 410);
  undoStore.delete(req.params.token);
  res.json({ ok: true, ...tx(item.restore) });
});

app.delete('/api/decks/:id', auth, (req, res) => {
  const deck = ownDeck(req.user.id, toInt(req.params.id));
  if (!deck) return bad(res, 'Словник не знайдено', 404);
  const words = db.prepare('SELECT * FROM words WHERE deck_id = ?').all(deck.id);
  const pack = db.prepare('SELECT * FROM user_packs WHERE user_id = ? AND deck_id = ?').get(req.user.id, deck.id);
  db.prepare('DELETE FROM decks WHERE id = ?').run(deck.id);

  const undo = rememberUndo(req.user.id, `Словник «${deck.name}»`, () => {
    const info = db.prepare('INSERT INTO decks (user_id, name, lang_from, lang_to, pack_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(deck.user_id, deck.name, deck.lang_from, deck.lang_to, deck.pack_id, deck.created_at);
    const deckId = Number(info.lastInsertRowid);
    const insert = db.prepare(`INSERT INTO words (user_id, deck_id, term, translation, example, transcription, box, due, hits, misses, starred, xp_day, xp_count, missed_day, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const w of words) {
      insert.run(w.user_id, deckId, w.term, w.translation, w.example, w.transcription, w.box, w.due, w.hits, w.misses, w.starred, w.xp_day, w.xp_count, w.missed_day, w.created_at);
    }
    if (pack) db.prepare('UPDATE user_packs SET deck_id = ? WHERE user_id = ? AND pack_id = ?').run(deckId, req.user.id, pack.pack_id);
    return { deckId };
  });
  res.json({ ok: true, ...undo });
});

// Імпорт: кожен рядок «слово;переклад;приклад», також підтримуються Tab, « - », « — » та «=».
function splitCsvLine(line, sep) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') { quoted = true; cur = ''; }
    else if (ch === sep) { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseImportLine(line) {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (line.includes(';')) return splitCsvLine(line, ';');
  for (const sep of [' — ', ' – ', ' - ', '=']) {
    const i = line.indexOf(sep);
    if (i > 0) return [line.slice(0, i).trim(), line.slice(i + sep.length).trim()];
  }
  return null;
}

app.post('/api/decks/:id/import', auth, (req, res) => {
  const deck = ownDeck(req.user.id, toInt(req.params.id));
  if (!deck) return bad(res, 'Словник не знайдено', 404);
  const text = typeof req.body.text === 'string' ? req.body.text.replace(/^﻿/, '') : '';
  const lines = text.split(/\r?\n/).slice(0, 5000);
  let added = 0;
  let skipped = 0;
  tx(() => {
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const cells = parseImportLine(line);
      const [term = '', translation = '', example = '', transcription = ''] = cells || [];
      if (!term || !translation || /^term$/i.test(term) || term.length > 200 || translation.length > 200 || findDuplicate(deck.id, term)) {
        skipped++;
        continue;
      }
      insertWord(req.user.id, deck.id, term, translation, example.slice(0, 500), transcription.slice(0, 100));
      added++;
    }
  });
  res.json({ added, skipped });
});

app.get('/api/decks/:id/export', auth, (req, res) => {
  const deck = ownDeck(req.user.id, toInt(req.params.id));
  if (!deck) return bad(res, 'Словник не знайдено', 404);
  const rows = db.prepare('SELECT term, translation, example, transcription FROM words WHERE deck_id = ? ORDER BY created_at').all(deck.id);
  const cell = (v) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = ['term;translation;example;transcription', ...rows.map((r) => [r.term, r.translation, r.example, r.transcription].map(cell).join(';'))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pippo-${deck.id}.csv"; filename*=UTF-8''${encodeURIComponent(`pippo-${deck.name}.csv`)}`);
  res.send('﻿' + csv);
});

/* ---------- words ---------- */

app.get('/api/words', auth, (req, res) => {
  const where = ['w.user_id = ?'];
  const params = [req.user.id];
  if (req.query.deckId) {
    where.push('w.deck_id = ?');
    params.push(toInt(req.query.deckId));
  }
  // пошук по всіх словниках: ?q=слово
  const q = clean(req.query.q, 100);
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    where.push("(w.term LIKE ? ESCAPE '\\' OR w.translation LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  const limit = q ? 100 : 5000;
  const words = db
    .prepare(`SELECT ${WORD_COLS}, d.name AS deckName FROM words w JOIN decks d ON d.id = w.deck_id
      WHERE ${where.join(' AND ')} ORDER BY w.created_at DESC LIMIT ${limit}`)
    .all(...params);
  res.json({ words });
});

app.post('/api/words', auth, (req, res) => {
  const deck = ownDeck(req.user.id, toInt(req.body.deckId));
  if (!deck) return bad(res, 'Словник не знайдено', 404);
  const term = clean(req.body.term, 200);
  const translation = clean(req.body.translation, 200);
  const example = clean(req.body.example, 500);
  const transcription = clean(req.body.transcription, 100);
  if (!term || !translation) return bad(res, 'Потрібні і слово, і переклад');
  if (findDuplicate(deck.id, term)) return bad(res, `«${term}» вже є в цьому словнику`, 409);
  const id = insertWord(req.user.id, deck.id, term, translation, example, transcription);
  res.json({ word: db.prepare(`SELECT ${WORD_COLS} FROM words w WHERE w.id = ?`).get(id) });
});

app.patch('/api/words/:id', auth, (req, res) => {
  const word = ownWord(req.user.id, toInt(req.params.id));
  if (!word) return bad(res, 'Слово не знайдено', 404);
  const next = { ...word };
  if ('term' in req.body) next.term = clean(req.body.term, 200);
  if ('translation' in req.body) next.translation = clean(req.body.translation, 200);
  if ('example' in req.body) next.example = clean(req.body.example, 500);
  if ('transcription' in req.body) next.transcription = clean(req.body.transcription, 100);
  if ('starred' in req.body) next.starred = req.body.starred ? 1 : 0;
  if ('deckId' in req.body) {
    if (!ownDeck(req.user.id, toInt(req.body.deckId))) return bad(res, 'Словник не знайдено', 404);
    next.deck_id = toInt(req.body.deckId);
  }
  if (req.body.reset) Object.assign(next, { box: 0, due: 0, hits: 0, misses: 0 });
  if (!next.term || !next.translation) return bad(res, 'Потрібні і слово, і переклад');
  if (findDuplicate(next.deck_id, next.term, word.id)) return bad(res, `«${next.term}» вже є в цьому словнику`, 409);

  db.prepare(
    'UPDATE words SET term = ?, translation = ?, example = ?, transcription = ?, starred = ?, deck_id = ?, box = ?, due = ?, hits = ?, misses = ? WHERE id = ?'
  ).run(next.term, next.translation, next.example, next.transcription, next.starred, next.deck_id, next.box, next.due, next.hits, next.misses, word.id);
  res.json({ word: db.prepare(`SELECT ${WORD_COLS} FROM words w WHERE w.id = ?`).get(word.id) });
});

app.delete('/api/words/:id', auth, (req, res) => {
  const word = ownWord(req.user.id, toInt(req.params.id));
  if (!word) return bad(res, 'Слово не знайдено', 404);
  db.prepare('DELETE FROM words WHERE id = ?').run(word.id);

  // прогрес теж повертаємо — інакше «скасувати» було б неповноцінним
  const undo = rememberUndo(req.user.id, `«${word.term}»`, () => {
    if (!ownDeck(word.user_id, word.deck_id)) return { restored: false };
    const info = db.prepare(`INSERT INTO words (user_id, deck_id, term, translation, example, transcription, box, due, hits, misses, starred, xp_day, xp_count, missed_day, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(word.user_id, word.deck_id, word.term, word.translation, word.example, word.transcription, word.box, word.due,
        word.hits, word.misses, word.starred, word.xp_day, word.xp_count, word.missed_day, word.created_at);
    return { wordId: Number(info.lastInsertRowid) };
  });
  res.json({ ok: true, ...undo });
});

/* ---------- AI: автозаповнення карток ---------- */

// Ліміти на звернення до ШІ. Рахуємо слова, а не запити: одне вікно «кілька слів одразу»
// коштує стільки ж, скільки 30 окремих перекладів.
const AI_LIMITS = {
  wordsPerHour: Number(process.env.AI_WORDS_PER_HOUR) || 60,
  wordsPerDay: Number(process.env.AI_WORDS_PER_DAY) || 300,
  requestsPerHour: Number(process.env.AI_REQUESTS_PER_HOUR) || 30,
  wordsPerDayTotal: Number(process.env.AI_WORDS_PER_DAY_TOTAL) || 2000, // спільний запобіжник на весь сервер
};
const HOUR = 3600000;

function aiUsed(uid, since, column = 'words') {
  const where = uid ? 'user_id = ? AND created_at > ?' : 'created_at > ?';
  const params = uid ? [uid, since] : [since];
  return db.prepare(`SELECT COALESCE(SUM(${column}), 0) AS n FROM ai_usage WHERE ${where}`).get(...params).n;
}
const aiRequests = (uid, since) => db.prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND created_at > ?').get(uid, since).n;

// Скільки слів користувач ще може перекласти
function aiAllowance(uid) {
  const now = Date.now();
  return {
    hour: Math.max(0, AI_LIMITS.wordsPerHour - aiUsed(uid, now - HOUR)),
    day: Math.max(0, AI_LIMITS.wordsPerDay - aiUsed(uid, now - 24 * HOUR)),
    requests: Math.max(0, AI_LIMITS.requestsPerHour - aiRequests(uid, now - HOUR)),
    limits: AI_LIMITS,
  };
}

// Перевіряє ліміт і одразу записує витрату (щоб не обійти повторами)
function spendAi(req, res, kind, words) {
  const now = Date.now();
  const left = aiAllowance(req.user.id);
  if (!left.requests) return bad(res, 'Забагато запитів до Pippo за годину. Спробуй трохи пізніше 😴', 429);
  if (left.hour < words) return bad(res, `Ліміт: ${AI_LIMITS.wordsPerHour} слів на годину. Лишилось ${left.hour} — спробуй за кілька хвилин.`, 429);
  if (left.day < words) return bad(res, `Ліміт: ${AI_LIMITS.wordsPerDay} слів на добу. Завтра буде ще 🌱`, 429);
  if (aiUsed(null, now - 24 * HOUR) + words > AI_LIMITS.wordsPerDayTotal) {
    return bad(res, 'Сьогодні Pippo вже наробився за всіх. Спробуй завтра.', 429);
  }
  db.prepare('INSERT INTO ai_usage (user_id, kind, words, ok, created_at) VALUES (?, ?, ?, 1, ?)').run(req.user.id, kind, words, now);
  return null;
}

// Позначити останній запис як невдалий (для аналітики)
function aiFailed(uid) {
  const row = db.prepare('SELECT id FROM ai_usage WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(uid);
  if (row) db.prepare('UPDATE ai_usage SET ok = 0 WHERE id = ?').run(row.id);
}

// Слова, які вже є в будь-якому словнику користувача (без «to » на початку)
function knownTerms(uid) {
  const strip = (t) => t.toLowerCase().trim().replace(/^to /, '');
  return new Set(db.prepare('SELECT term FROM words WHERE user_id = ?').all(uid).map((r) => strip(r.term)));
}

app.get('/api/ai/status', auth, (req, res) => res.json({ gemini: ai.enabled(), allowance: aiAllowance(req.user.id) }));

app.post('/api/ai/lookup', auth, async (req, res) => {
  const deck = ownDeck(req.user.id, toInt(req.body.deckId));
  if (!deck) return bad(res, 'Словник не знайдено', 404);
  const word = clean(req.body.word, 100);
  const sentence = clean(req.body.sentence, 1000);
  if (!word) return bad(res, 'Вибери слово');
  if (spendAi(req, res, 'lookup', 1)) return;
  try {
    const card = await ai.lookup({ word, sentence, from: deck.lang_from, to: deck.lang_to });
    const exists = findDuplicate(deck.id, card.term) || (card.term !== word && findDuplicate(deck.id, word));
    res.json({ card, exists: Boolean(exists) });
  } catch (e) {
    console.warn('[ai] lookup:', e.message);
    aiFailed(req.user.id);
    bad(res, 'Не вдалося розібрати слово. Спробуй ще раз або заповни вручну.', 502);
  }
});

app.post('/api/ai/batch', auth, async (req, res) => {
  const deck = ownDeck(req.user.id, toInt(req.body.deckId));
  if (!deck) return bad(res, 'Словник не знайдено', 404);
  const raw = Array.isArray(req.body.words) ? req.body.words : [];
  const unique = new Map();
  for (const w of raw) {
    const word = clean(w, 100);
    if (word && !unique.has(word.toLowerCase())) unique.set(word.toLowerCase(), word);
  }
  const words = [...unique.values()].slice(0, 30);
  if (!words.length) return bad(res, 'Введи хоча б одне слово');
  if (spendAi(req, res, 'batch', words.length)) return;
  try {
    const known = knownTerms(req.user.id);
    const items = (await ai.translateMany({ words, from: deck.lang_from, to: deck.lang_to }))
      .map((c) => ({ ...c, exists: known.has(c.term.toLowerCase().replace(/^to /, '')) }));
    res.json({ items });
  } catch (e) {
    console.warn('[ai] batch:', e.message);
    aiFailed(req.user.id);
    bad(res, 'Не вдалося перекласти слова. Спробуй ще раз.', 502);
  }
});

app.post('/api/ai/extract', auth, async (req, res) => {
  const deck = ownDeck(req.user.id, toInt(req.body.deckId));
  if (!deck) return bad(res, 'Словник не знайдено', 404);
  const text = clean(req.body.text, 6000);
  if (text.length < 3) return bad(res, 'Встав текст');
  // пошук слів у тексті коштує приблизно як пак слів
  if (spendAi(req, res, 'extract', 10)) return;
  try {
    const known = knownTerms(req.user.id);
    const items = (await ai.extract({ text, from: deck.lang_from, to: deck.lang_to }))
      .map((c) => ({ ...c, exists: known.has(c.term.toLowerCase().replace(/^to /, '')) }));
    res.json({ items });
  } catch (e) {
    console.warn('[ai] extract:', e.message);
    aiFailed(req.user.id);
    bad(res, e.status === 501 ? e.message : 'Не вдалося проаналізувати текст. Спробуй ще раз.', e.status === 501 ? 501 : 502);
  }
});

/* ---------- quiz ---------- */

app.post('/api/quiz', auth, (req, res) => {
  const uid = req.user.id;
  const now = Date.now();
  const deckId = req.body.deckId ? toInt(req.body.deckId) : null;
  if (deckId && !ownDeck(uid, deckId)) return bad(res, 'Словник не знайдено', 404);
  const count = clamp(toInt(req.body.count) || 10, 3, 50);
  const source = ['smart', 'all', 'hard', 'new', 'starred'].includes(req.body.source) ? req.body.source : 'smart';
  const ids = Array.isArray(req.body.wordIds) ? req.body.wordIds.map(toInt).filter(Number.isFinite).slice(0, 50) : null;

  const where = ['w.user_id = ?'];
  const params = [uid];
  if (deckId) { where.push('w.deck_id = ?'); params.push(deckId); }

  let order = 'ORDER BY RANDOM()';
  if (ids) {
    where.push(`w.id IN (${ids.map(() => '?').join(',') || 'NULL'})`);
    params.push(...ids);
  } else if (source === 'smart') {
    // Спершу ті, що пора повторити, потім нові, потім найслабші
    order = `ORDER BY CASE WHEN w.hits + w.misses > 0 AND w.due <= ? THEN 0 WHEN w.hits + w.misses = 0 THEN 1 ELSE 2 END, w.box, w.due, RANDOM()`;
  } else if (source === 'hard') {
    where.push('w.misses > 0');
    order = 'ORDER BY CAST(w.misses AS REAL) / (w.hits + w.misses) DESC, w.misses DESC';
  } else if (source === 'new') {
    where.push('w.hits + w.misses = 0');
  } else if (source === 'starred') {
    where.push('w.starred = 1');
  }

  const sql = `SELECT w.id, w.deck_id AS deckId, w.term, w.translation, w.example, w.transcription, w.box,
      d.lang_from AS langFrom, d.lang_to AS langTo
    FROM words w JOIN decks d ON d.id = w.deck_id
    WHERE ${where.join(' AND ')} ${order} LIMIT ?`;
  const orderParams = !ids && source === 'smart' ? [now] : [];
  // Беремо із запасом і прибираємо дублі (одне слово може бути в кількох словниках)
  const seen = new Set();
  const words = db.prepare(sql).all(...params, ...orderParams, Math.min(count * 4, 200)).filter((w) => {
    const key = w.term.toLowerCase().trim().replace(/^to\s+/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, count);

  // Пул для неправильних варіантів відповіді
  let pool = db
    .prepare(`SELECT term, translation FROM words WHERE user_id = ? ${deckId ? 'AND deck_id = ?' : ''} ORDER BY RANDOM() LIMIT 120`)
    .all(...(deckId ? [uid, deckId] : [uid]));
  if (pool.length < 8) pool = db.prepare('SELECT term, translation FROM words WHERE user_id = ? ORDER BY RANDOM() LIMIT 120').all(uid);

  const sessionId = crypto.randomBytes(16).toString('hex');
  const mode = MODES.includes(req.body.mode) ? req.body.mode : 'choice';
  tx(() => {
    db.prepare('INSERT INTO quiz_sessions (id, user_id, mode, created_at) VALUES (?, ?, ?, ?)').run(sessionId, uid, mode, now);
    const item = db.prepare('INSERT INTO quiz_items (session_id, word_id) VALUES (?, ?)');
    for (const w of words) item.run(sessionId, w.id);
  });

  res.json({ sessionId, words, pool });
});

// Відповідь приймається лише для слова з активної сесії і лише один раз
app.post('/api/answer', auth, (req, res) => {
  const session = db.prepare('SELECT * FROM quiz_sessions WHERE id = ? AND user_id = ?').get(clean(req.body.sessionId, 64), req.user.id);
  if (!session || session.finished) return bad(res, 'Тренування застаріло — почни нове', 409);
  const item = db.prepare('SELECT * FROM quiz_items WHERE session_id = ? AND word_id = ?').get(session.id, toInt(req.body.wordId));
  if (!item) return bad(res, 'Цього слова немає в тренуванні', 400);
  if (item.answered) return bad(res, 'На це слово вже відповіли', 409);
  const word = ownWord(req.user.id, item.word_id);
  if (!word) return bad(res, 'Слово не знайдено', 404);

  const correct = !!req.body.correct;
  const mode = session.mode;
  const user = req.user;
  const day = economy.userDay(user);
  const now = Date.now();
  const key = packs.termKey(word.term);

  // Захист від автоматизації: не більше ~1 відповіді на 0.7 с (з невеликим запасом на «Пари»)
  const answeredInSession = db.prepare('SELECT COUNT(*) AS n FROM quiz_items WHERE session_id = ? AND answered = 1').get(session.id).n;
  const tooFast = answeredInSession + 1 > 5 + Math.floor((now - session.created_at) / 700);

  const result = tx(() => {
    db.prepare('UPDATE quiz_items SET answered = 1, correct = ? WHERE session_id = ? AND word_id = ?').run(correct ? 1 : 0, session.id, word.id);

    const wasNew = word.hits + word.misses === 0;
    const wasDue = !wasNew && word.due <= now;
    let { box, due } = word;
    if (correct) {
      // На наступну поличку слово переходить лише тоді, коли його справді пора було повторювати
      if (word.due <= now) {
        box = Math.min(word.box + 1, MAX_BOX);
        due = now + INTERVALS[box] * DAY;
      }
    } else {
      box = Math.max(0, word.box - 2);
      due = now;
    }

    // Досвід: одне слово — не більше двох разів на день; нові слова — з денним лімітом
    const activity = db.prepare('SELECT answers, new_words FROM activity WHERE user_id = ? AND day = ?').get(user.id, day) || { answers: 0, new_words: 0 };
    const xpCount = word.xp_day === day ? word.xp_count : 0;
    let xp = correct ? (HARD_MODES.includes(mode) && !req.body.hinted ? 10 : 5) : 0;
    if (tooFast || xpCount >= economy.LIMITS.xpPerWordPerDay || (wasNew && activity.new_words >= economy.LIMITS.newXpPerDay)) xp = 0;

    db.prepare('UPDATE words SET box = ?, due = ?, hits = hits + ?, misses = misses + ?, xp_day = ?, xp_count = ?, missed_day = ? WHERE id = ?').run(
      box, due, correct ? 1 : 0, correct ? 0 : 1, day, xpCount + (xp ? 1 : 0), correct ? word.missed_day : day, word.id
    );

    let { streak, best_streak: best } = user;
    const streakGrew = user.last_day !== day;
    if (streakGrew) {
      streak = user.last_day === shiftDay(day, -1) ? streak + 1 : 1;
      best = Math.max(best, streak);
    }
    db.prepare('UPDATE users SET xp = xp + ?, streak = ?, best_streak = ?, last_day = ? WHERE id = ?').run(xp, streak, best, day, user.id);

    db.prepare(
      `INSERT INTO activity (user_id, day, answers, correct, new_words) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT (user_id, day) DO UPDATE SET answers = answers + 1, correct = correct + excluded.correct, new_words = new_words + excluded.new_words`
    ).run(user.id, day, correct ? 1 : 0, wasNew ? 1 : 0);
    const answers = activity.answers + 1;

    // Зернятка
    const events = [];
    const add = (amount, label) => { if (amount > 0) events.push({ amount, label }); return amount; };
    let grains = 0;
    const learnedBefore = economy.todaySummary(user.id, day).learned;
    if (correct && !tooFast) {
      if (wasNew) {
        grains += add(economy.grant(user.id, economy.REWARDS.newWord, 'new', { day, note: word.term, once: `new:${key}` }), 'нове слово');
      } else if (wasDue && word.missed_day !== day) {
        // «Помилитись, а потім відповісти правильно» сьогодні вже не платить; одне слово — раз на день
        const amount = mode === 'flash' ? economy.REWARDS.reviewFlash : economy.REWARDS.review;
        grains += add(economy.grant(user.id, amount, 'review', { day, note: word.term, once: `review:${word.id}:${day}` }), 'повторення');
      }
      if (box === MAX_BOX && word.box < MAX_BOX) {
        grains += add(economy.grant(user.id, economy.REWARDS.master, 'master', { day, note: word.term, once: `master:${key}` }), 'слово вивчено!');
      }
    }
    const capReached = learnedBefore < economy.LIMITS.learnPerDay && economy.todaySummary(user.id, day).learned >= economy.LIMITS.learnPerDay;

    let goalReached = false;
    if (answers >= user.daily_goal) {
      const g = economy.grant(user.id, economy.REWARDS.goal, 'goal', { day, note: 'Денна ціль', once: `goal:${day}` });
      goalReached = g > 0;
      grains += add(g, 'денна ціль');
    }
    if (streakGrew && economy.REWARDS.streak[streak]) {
      grains += add(economy.grant(user.id, economy.REWARDS.streak[streak], 'streak', { day, note: `Серія ${streak} днів`, once: `streak:${streak}` }), `серія ${streak} днів`);
    }

    // Пак вивчено повністю — повертаємо частину ціни
    let packCompleted = null;
    if (box === MAX_BOX && word.box < MAX_BOX) {
      const deck = db.prepare('SELECT pack_id FROM decks WHERE id = ?').get(word.deck_id);
      const owned = deck && deck.pack_id && db.prepare('SELECT price FROM user_packs WHERE user_id = ? AND pack_id = ?').get(user.id, deck.pack_id);
      const left = owned && db.prepare('SELECT COUNT(*) AS n FROM words WHERE deck_id = ? AND box < ?').get(word.deck_id, MAX_BOX).n;
      if (owned && left === 0) {
        const pack = packs.get(deck.pack_id);
        const bonus = Math.max(10, Math.round(owned.price * economy.REWARDS.packDoneShare));
        const g = economy.grant(user.id, bonus, 'pack-done', { day, note: pack ? pack.title : deck.pack_id, once: `packdone:${deck.pack_id}` });
        if (g) packCompleted = { title: pack ? pack.title : deck.pack_id, grains: g };
        grains += add(g, 'пак вивчено');
      }
    }

    return { box, xp, grains, events, goalReached, capReached, packCompleted };
  });

  res.json({ ...result, user: publicUser(getUser(user.id)) });
});

app.post('/api/quiz/finish', auth, (req, res) => {
  const session = db.prepare('SELECT * FROM quiz_sessions WHERE id = ? AND user_id = ?').get(clean(req.body.sessionId, 64), req.user.id);
  if (!session) return bad(res, 'Тренування не знайдено', 404);
  if (session.finished) return bad(res, 'Тренування вже завершено', 409);
  // Підсумок рахує сервер за власними записами, а не за словами клієнта
  const { total, correct } = db
    .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(correct), 0) AS correct FROM quiz_items WHERE session_id = ? AND answered = 1')
    .get(session.id);
  if (!total) return bad(res, 'Порожній тест');
  const day = economy.userDay(req.user);
  const duration = Math.round((Date.now() - session.created_at) / 1000);
  const bonusesToday = db.prepare('SELECT COUNT(*) AS n FROM tests WHERE user_id = ? AND day = ? AND xp > 0').get(req.user.id, day).n;
  const bonus = total >= 5 && correct === total && bonusesToday < economy.LIMITS.perfectBonusPerDay ? 20 : 0;
  tx(() => {
    db.prepare('UPDATE quiz_sessions SET finished = 1 WHERE id = ?').run(session.id);
    db.prepare('INSERT INTO tests (user_id, mode, total, correct, xp, duration, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      req.user.id, session.mode, total, correct, bonus, duration, day, Date.now()
    );
    if (bonus) db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(bonus, req.user.id);
  });
  res.json({ bonus, total, correct, user: publicUser(getUser(req.user.id)) });
});

/* ---------- shop: паки слів ---------- */

function knownTermsOf(uid) {
  return new Set(db.prepare('SELECT term FROM words WHERE user_id = ?').all(uid).map((r) => packs.termKey(r.term)));
}

function shopContext(user) {
  return {
    known: knownTermsOf(user.id),
    day: economy.userDay(user),
    firstFree: !economy.hasOnce(user.id, 'first-pack'),
  };
}

function ownedInfo(uid, packId) {
  const owned = db.prepare('SELECT deck_id, price, bought_at FROM user_packs WHERE user_id = ? AND pack_id = ?').get(uid, packId);
  if (!owned) return null;
  const stats = db
    .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(box >= ${MAX_BOX}), 0) AS mastered FROM words w JOIN decks d ON d.id = w.deck_id WHERE d.id = ? AND d.user_id = ?`)
    .get(owned.deck_id, uid);
  const deckExists = Boolean(owned.deck_id && ownDeck(uid, owned.deck_id));
  return { deckId: deckExists ? owned.deck_id : null, total: stats.total, mastered: stats.mastered, boughtAt: owned.bought_at };
}

app.get('/api/shop', auth, (req, res) => {
  const ctx = shopContext(req.user);
  const list = packs.all().map((p) => {
    const q = packs.quote(p, ctx);
    return {
      id: p.id, type: p.type, level: p.level, size: p.size, title: p.title, description: p.description, count: p.count,
      ...(p.series ? { series: p.series, seriesTitle: p.seriesTitle, season: p.season, episode: p.episode, episodeTitle: p.episodeTitle, label: p.label } : {}),
      basePrice: p.basePrice, price: q.price, knownCount: q.knownCount, isDeal: q.isDeal, free: q.free,
      owned: ownedInfo(req.user.id, p.id),
      preview: p.words.slice(0, 5).map(({ term, translation, transcription, example }) => ({ term, translation, transcription, example })),
    };
  });
  res.json({
    balance: req.user.grains,
    today: economy.todaySummary(req.user.id, ctx.day),
    firstFree: ctx.firstFree,
    dealId: packs.dealId(ctx.day),
    dealDiscount: packs.DEAL_DISCOUNT,
    firstFreeMaxSize: packs.FIRST_FREE_MAX_SIZE,
    packs: list,
  });
});

app.post('/api/shop/:id/buy', auth, (req, res) => {
  const pack = packs.get(String(req.params.id));
  if (!pack) return bad(res, 'Пак не знайдено', 404);
  const uid = req.user.id;
  const owned = ownedInfo(uid, pack.id);
  if (owned && owned.deckId) return bad(res, 'Цей пак уже є у твоїх словниках', 409);

  const ctx = shopContext(req.user);
  const q = packs.quote(pack, ctx);
  if (!q.fresh.length) return bad(res, 'Усі слова з цього пака вже є у твоїх словниках', 409);
  // Якщо пак колись купили, а словник видалили — відновлюємо безкоштовно
  const price = owned ? 0 : q.price;
  const day = ctx.day;

  try {
    const deckId = tx(() => {
      if (price > 0) economy.spend(uid, price, 'purchase', { day, note: pack.title, once: `buy:${pack.id}` });
      const id = createDeck(uid, pack.title, 'en', 'uk');
      db.prepare('UPDATE decks SET pack_id = ? WHERE id = ?').run(pack.id, id);
      for (const w of q.fresh) insertWord(uid, id, w.term, w.translation, w.example, w.transcription);
      if (owned) db.prepare('UPDATE user_packs SET deck_id = ? WHERE user_id = ? AND pack_id = ?').run(id, uid, pack.id);
      else db.prepare('INSERT INTO user_packs (user_id, pack_id, deck_id, price, bought_at) VALUES (?, ?, ?, ?, ?)').run(uid, pack.id, id, price, Date.now());
      if (!owned && q.free) db.prepare('INSERT INTO grains (user_id, amount, kind, note, day, once_key, created_at) VALUES (?, 0, ?, ?, ?, ?, ?)').run(uid, 'purchase', `${pack.title} (подарунок)`, day, 'first-pack', Date.now());
      return id;
    });
    res.json({ deckId, added: q.fresh.length, price, restored: Boolean(owned), user: publicUser(getUser(uid)) });
  } catch (e) {
    if (e instanceof economy.NotEnoughGrains) return bad(res, 'Не вистачає зерняток', 402);
    throw e;
  }
});

/* ---------- stats ---------- */

app.get('/api/stats', auth, (req, res) => {
  const uid = req.user.id;
  const day = economy.userDay(req.user);
  const now = Date.now();

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
         COALESCE(SUM(box >= ${MAX_BOX}), 0) AS mastered,
         COALESCE(SUM(hits + misses = 0), 0) AS fresh,
         COALESCE(SUM(hits + misses > 0 AND box < ${MAX_BOX}), 0) AS learning,
         COALESCE(SUM(hits + misses > 0 AND due <= ?), 0) AS due
       FROM words WHERE user_id = ?`
    )
    .get(now, uid);

  const boxes = Array(MAX_BOX + 1).fill(0);
  for (const r of db.prepare('SELECT box, COUNT(*) AS n FROM words WHERE user_id = ? GROUP BY box').all(uid)) boxes[r.box] = r.n;

  const heatmap = db.prepare('SELECT day, answers, correct FROM activity WHERE user_id = ? AND day >= ? ORDER BY day').all(uid, shiftDay(day, -120));
  const overall = db.prepare('SELECT COALESCE(SUM(answers), 0) AS answers, COALESCE(SUM(correct), 0) AS correct FROM activity WHERE user_id = ?').get(uid);

  const hardest = db
    .prepare(
      `SELECT ${WORD_COLS} FROM words w WHERE w.user_id = ? AND w.misses > 0
       ORDER BY CAST(w.misses AS REAL) / (w.hits + w.misses) DESC, w.misses DESC LIMIT 6`
    )
    .all(uid);

  const recentTests = db.prepare('SELECT mode, total, correct, xp, duration, created_at AS createdAt FROM tests WHERE user_id = ? ORDER BY id DESC LIMIT 8').all(uid);

  // «Слово дня» — стабільне впродовж дня, різне для різних користувачів
  let wordOfDay = null;
  if (totals.total > 0) {
    const seed = crypto.createHash('sha1').update(`${uid}:${day}`).digest().readUInt32BE(0);
    wordOfDay = db
      .prepare(
        `SELECT ${WORD_COLS}, d.lang_from AS langFrom, d.lang_to AS langTo
         FROM words w JOIN decks d ON d.id = w.deck_id WHERE w.user_id = ? ORDER BY w.id LIMIT 1 OFFSET ?`
      )
      .get(uid, seed % totals.total);
  }

  const deal = packs.get(packs.dealId(day));
  res.json({
    grainsToday: economy.todaySummary(uid, day),
    deal: deal ? { id: deal.id, title: deal.title, count: deal.count } : null,
    user: publicUser(getUser(uid)), totals, boxes, heatmap, overall, hardest, recentTests, wordOfDay, intervals: INTERVALS });
});

app.use('/api', (req, res) => bad(res, 'Не знайдено', 404));

app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') return bad(res, 'Некоректний JSON');
  console.error(err);
  bad(res, 'Помилка сервера', 500);
});

if (ADMIN_NAMES.length) {
  const mark = db.prepare('UPDATE users SET is_admin = 1 WHERE lower(username) = ?');
  for (const name of ADMIN_NAMES) mark.run(name);
  console.log(`👑 Адміністратори: ${ADMIN_NAMES.join(', ')}`);
}

// Стартовий подарунок користувачам, які зареєструвались до появи зерняток
for (const u of db.prepare("SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM grains WHERE once_key = 'start')").all()) {
  tx(() => economy.grant(u.id, economy.REWARDS.start, 'start', { day: economy.userDay(u), note: 'Подарунок на старт', once: 'start' }));
}
console.log(`📦 Паків у магазині: ${packs.all().length}`);

app.listen(PORT, () => console.log(`🐣 Pippo: http://localhost:${PORT}`));
