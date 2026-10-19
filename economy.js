// Економіка Pippo: зернятка 🌾, денні ліміти й разові нагороди.
// Усі нарахування та витрати пишуться в журнал grains; users.grains — кешований баланс.

const { db } = require('./db');

const REWARDS = {
  start: 50, // стартовий подарунок
  review: 2, // правильно повторене слово, якого настав час
  reviewFlash: 1, // те саме в картках (самооцінка)
  newWord: 1, // перша правильна відповідь на нове слово (раз назавжди на слово)
  master: 5, // слово дійшло до останньої полички (раз назавжди на слово)
  goal: 10, // денна ціль
  streak: { 7: 25, 30: 75, 100: 200 },
  packDoneShare: 0.25, // частка ціни пака, що повертається, коли його вивчено повністю
};

const LIMITS = {
  learnPerDay: 50, // спільний ліміт для review / new / master
  newPerDay: 10, // скільки нових слів на день приносять зернятка
  xpPerWordPerDay: 2, // скільки разів на день одне слово дає досвід
  newXpPerDay: 30, // скільки нових слів на день дають досвід
  perfectBonusPerDay: 3, // бонус XP за ідеальний тест
};

const LEARN_KINDS = ['review', 'new', 'master'];

function validTimezone(tz) {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// «Сьогодні» користувача за його часовим поясом — рахує сервер, а не браузер
function userDay(user, now = Date.now()) {
  const tz = validTimezone(user.timezone) ? user.timezone : 'Europe/Kyiv';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

function balance(uid) {
  return db.prepare('SELECT grains FROM users WHERE id = ?').get(uid).grains;
}

function learnedToday(uid, day) {
  return db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM grains WHERE user_id = ? AND day = ? AND kind IN (${LEARN_KINDS.map(() => '?').join(',')})`)
    .get(uid, day, ...LEARN_KINDS).n;
}

function countToday(uid, day, kind) {
  return db.prepare('SELECT COUNT(*) AS n FROM grains WHERE user_id = ? AND day = ? AND kind = ?').get(uid, day, kind).n;
}

function hasOnce(uid, onceKey) {
  return Boolean(db.prepare('SELECT 1 FROM grains WHERE user_id = ? AND once_key = ?').get(uid, onceKey));
}

function write(uid, amount, kind, note, day, onceKey) {
  db.prepare('INSERT INTO grains (user_id, amount, kind, note, day, once_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    uid, amount, kind, note || '', day, onceKey || null, Date.now()
  );
  db.prepare('UPDATE users SET grains = grains + ? WHERE id = ?').run(amount, uid);
}

// Нарахувати зернятка. Повертає фактично нараховану кількість (0, якщо ліміт вичерпано чи нагорода вже була).
// Викликати всередині транзакції.
function grant(uid, amount, kind, { day, note, once } = {}) {
  if (amount <= 0) return 0;
  if (once && hasOnce(uid, once)) return 0;
  let value = amount;
  if (LEARN_KINDS.includes(kind)) {
    if (kind === 'new' && countToday(uid, day, 'new') >= LIMITS.newPerDay) return 0;
    value = Math.min(value, LIMITS.learnPerDay - learnedToday(uid, day));
    if (value <= 0) return 0;
  }
  write(uid, value, kind, note, day, once);
  return value;
}

class NotEnoughGrains extends Error {}

function spend(uid, amount, kind, { day, note, once } = {}) {
  if (amount < 0) throw new Error('negative spend');
  if (balance(uid) < amount) throw new NotEnoughGrains('Не вистачає зерняток');
  write(uid, -amount, kind, note, day, once);
}

function todaySummary(uid, day) {
  return {
    learned: learnedToday(uid, day),
    learnCap: LIMITS.learnPerDay,
    newWords: countToday(uid, day, 'new'),
    newCap: LIMITS.newPerDay,
    goalDone: hasOnce(uid, `goal:${day}`),
  };
}

function history(uid, limit = 40) {
  return db.prepare('SELECT amount, kind, note, day, created_at AS createdAt FROM grains WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(uid, limit);
}

module.exports = { REWARDS, LIMITS, userDay, validTimezone, balance, grant, spend, hasOnce, todaySummary, history, NotEnoughGrains };
