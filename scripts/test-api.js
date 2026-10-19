// Тести API Pippo: піднімають сервер на базі в пам'яті й перевіряють правила гри та безпеку.
//   npm test
const { spawn } = require('child_process');
const path = require('path');

const PORT = Number(process.env.TEST_PORT) || 3799;
const BASE = `http://localhost:${PORT}/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
const group = (name) => console.log(`\n${name}`);
function eq(actual, expected, what = '') {
  if (actual !== expected) throw new Error(`${what}: очікував ${JSON.stringify(expected)}, отримав ${JSON.stringify(actual)}`);
}
function ok(cond, what) {
  if (!cond) throw new Error(what);
}

// --- клієнт ---
async function api(path, { method = 'GET', body, user } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(user?.cookie ? { cookie: user.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { data = raw; }
  const setCookie = res.headers.get('set-cookie');
  if (user && setCookie) user.cookie = setCookie.split(';')[0];
  return { status: res.status, data };
}

async function register(username) {
  const user = { username };
  const r = await api('/auth/register', { method: 'POST', body: { username, password: 'secret123', timezone: 'Europe/Kyiv' }, user });
  eq(r.status, 200, `реєстрація ${username}`);
  user.id = r.data.user.id;
  return user;
}

const firstDeck = async (user) => (await api('/decks', { user })).data.decks[0];
const addWord = (user, deckId, term, translation = 'переклад', example = '') =>
  api('/words', { method: 'POST', body: { deckId, term, translation, example }, user });

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PIPPO_DB: ':memory:', PORT: String(PORT), GEMINI_API_KEY: '', NODE_ENV: 'test',
      PIPPO_ADMIN: 'alice', AI_WORDS_PER_HOUR: '3', AI_WORDS_PER_DAY: '5', AI_REQUESTS_PER_HOUR: '4',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  server.stdout.on('data', (d) => log.push(String(d)));
  server.stderr.on('data', (d) => log.push(String(d)));

  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/me`); break; } catch { await sleep(200); }
    if (i === 49) { console.error('Сервер не запустився:', log.join('')); process.exit(1); }
  }

  try {
    /* ---------- авторизація ---------- */
    group('Авторизація');
    const alice = await register('alice');
    const bob = await register('bob');

    await test('новачок отримує 50 🌾 і словник', async () => {
      const me = await api('/me', { user: alice });
      eq(me.data.user.grains, 50, 'баланс');
      eq((await api('/decks', { user: alice })).data.decks.length, 1, 'словників');
    });
    await test('ім’я не можна зайняти двічі', async () => {
      const r = await api('/auth/register', { method: 'POST', body: { username: 'alice', password: 'secret123' } });
      eq(r.status, 409, 'статус');
    });
    await test('короткий пароль відхиляється', async () => {
      eq((await api('/auth/register', { method: 'POST', body: { username: 'shorty', password: '123' } })).status, 400, 'статус');
    });
    await test('невірний пароль не пускає', async () => {
      eq((await api('/auth/login', { method: 'POST', body: { username: 'alice', password: 'wrong123' } })).status, 401, 'статус');
    });
    await test('без входу закриті дані недоступні', async () => {
      eq((await api('/decks')).status, 401, 'словники');
      eq((await api('/shop')).status, 401, 'магазин');
      eq((await api('/me')).data.user, null, '/me');
    });
    await test('запит не-JSON відхиляється (захист від чужих форм)', async () => {
      const res = await fetch(`${BASE}/words`, { method: 'POST', headers: { 'content-type': 'text/plain', cookie: alice.cookie }, body: 'deckId=1' });
      eq(res.status, 415, 'статус');
    });

    /* ---------- чужі дані ---------- */
    group('Чужі дані');
    const aliceDeck = await firstDeck(alice);
    const aliceWord = (await addWord(alice, aliceDeck.id, 'apple', 'яблуко', 'I eat an apple every day.')).data.word;

    await test('чужі слова не видно', async () => {
      eq((await api(`/words?deckId=${aliceDeck.id}`, { user: bob })).data.words.length, 0, 'слів у відповіді');
    });
    await test('чуже слово не змінити й не видалити', async () => {
      eq((await api(`/words/${aliceWord.id}`, { method: 'PATCH', body: { translation: 'зламано' }, user: bob })).status, 404, 'PATCH');
      eq((await api(`/words/${aliceWord.id}`, { method: 'DELETE', user: bob })).status, 404, 'DELETE');
    });
    await test('чужий словник не видалити й не експортувати', async () => {
      eq((await api(`/decks/${aliceDeck.id}`, { method: 'DELETE', user: bob })).status, 404, 'DELETE');
      eq((await api(`/decks/${aliceDeck.id}/export`, { user: bob })).status, 404, 'експорт');
    });
    await test('у чужий словник не додати слово', async () => {
      eq((await addWord(bob, aliceDeck.id, 'hack', 'зламати')).status, 404, 'статус');
    });

    /* ---------- слова ---------- */
    group('Слова');
    await test('дублікат слова не додається', async () => {
      eq((await addWord(alice, aliceDeck.id, 'Apple', 'інше')).status, 409, 'статус');
    });
    await test('імпорт розуміє різні роздільники, дублікати пропускає', async () => {
      const text = 'dog;собака;A dog barks.\nsun - сонце\napple;яблуко\nбез перекладу';
      const r = await api(`/decks/${aliceDeck.id}/import`, { method: 'POST', body: { text }, user: alice });
      eq(r.data.added, 2, 'додано');
      eq(r.data.skipped, 2, 'пропущено');
    });
    await test('експорт віддає CSV із заголовком', async () => {
      const res = await fetch(`${BASE}/decks/${aliceDeck.id}/export`, { headers: { cookie: alice.cookie } });
      const text = await res.text();
      ok(text.includes('term;translation;example'), 'немає заголовка');
      ok(text.includes('dog;собака'), 'немає імпортованого слова');
    });

    await test('видалене слово повертається разом із прогресом', async () => {
      const ivan = await register('ivan');
      const deck = await firstDeck(ivan);
      const w = (await addWord(ivan, deck.id, 'undo-me', 'поверни мене', 'Undo me, please.')).data.word;
      await api(`/words/${w.id}`, { method: 'PATCH', body: { starred: true }, user: ivan });
      const del = await api(`/words/${w.id}`, { method: 'DELETE', user: ivan });
      ok(del.data.token, 'немає токена скасування');
      eq((await api(`/words?deckId=${deck.id}`, { user: ivan })).data.words.length, 0, 'слово ще на місці');
      eq((await api(`/undo/${del.data.token}`, { method: 'POST', body: {}, user: ivan })).status, 200, 'скасування');
      const back = (await api(`/words?deckId=${deck.id}`, { user: ivan })).data.words;
      eq(back.length, 1, 'слово не повернулося');
      eq(back[0].term, 'undo-me', 'інше слово');
      eq(back[0].starred, 1, 'втрачено позначку «обране»');
      eq((await api(`/undo/${del.data.token}`, { method: 'POST', body: {}, user: ivan })).status, 410, 'повторне скасування');
    });
    await test('видалений словник повертається зі словами', async () => {
      const julia = await register('julia');
      const deck = await firstDeck(julia);
      await addWord(julia, deck.id, 'first', 'перше');
      await addWord(julia, deck.id, 'second', 'друге');
      const del = await api(`/decks/${deck.id}`, { method: 'DELETE', user: julia });
      eq((await api('/decks', { user: julia })).data.decks.length, 0, 'словник ще на місці');
      await api(`/undo/${del.data.token}`, { method: 'POST', body: {}, user: julia });
      const decks = (await api('/decks', { user: julia })).data.decks;
      eq(decks.length, 1, 'словник не повернувся');
      eq(decks[0].total, 2, 'слова не повернулися');
    });
    await test('чужий токен скасування не спрацьовує', async () => {
      const kate = await register('kate');
      const deck = await firstDeck(kate);
      const w = (await addWord(kate, deck.id, 'secret', 'таємне')).data.word;
      const del = await api(`/words/${w.id}`, { method: 'DELETE', user: kate });
      eq((await api(`/undo/${del.data.token}`, { method: 'POST', body: {}, user: bob })).status, 410, 'статус');
    });
    await test('пошук знаходить слова в усіх словниках', async () => {
      const r = await api('/words?q=собак', { user: alice });
      ok(r.data.words.some((w) => w.term === 'dog' && w.deckName), 'не знайдено dog за перекладом');
      const byTerm = await api('/words?q=appl', { user: alice });
      ok(byTerm.data.words.some((w) => w.term === 'apple'), 'не знайдено apple за словом');
      eq((await api('/words?q=zzzz-nothing', { user: alice })).data.words.length, 0, 'знайшлося зайве');
    });

    /* ---------- тренування ---------- */
    group('Тренування та зернятка');
    const quiz = async (user, body = {}) => (await api('/quiz', { method: 'POST', body: { source: 'all', count: 20, mode: 'choice', ...body }, user })).data;
    const answer = (user, sessionId, wordId, correct = true) =>
      api('/answer', { method: 'POST', body: { sessionId, wordId, correct }, user });

    const q1 = await quiz(alice);
    await test('тест видає сесію й слова без повторів', async () => {
      ok(q1.sessionId && q1.words.length >= 3, 'порожній тест');
      const keys = q1.words.map((w) => w.term.toLowerCase().replace(/^to /, ''));
      eq(new Set(keys).size, keys.length, 'є дублі слів');
    });
    await test('відповідь на слово поза тестом не приймається', async () => {
      eq((await answer(alice, q1.sessionId, 999999)).status, 400, 'статус');
    });
    await test('на одне слово не відповісти двічі', async () => {
      eq((await answer(alice, q1.sessionId, q1.words[0].id)).status, 200, 'перша відповідь');
      eq((await answer(alice, q1.sessionId, q1.words[0].id)).status, 409, 'друга відповідь');
    });
    await test('чужою сесією не скористатися', async () => {
      const bobDeck = await firstDeck(bob);
      await addWord(bob, bobDeck.id, 'chair', 'стілець');
      eq((await answer(bob, q1.sessionId, q1.words[1].id)).status, 409, 'статус');
    });
    await test('занадто швидкі відповіді не дають ні XP, ні зерняток', async () => {
      const speedy = await register('speedy');
      const deck = await firstDeck(speedy);
      for (let i = 0; i < 12; i++) await addWord(speedy, deck.id, `fast${i}`, `швидке${i}`);
      const q = await quiz(speedy, { count: 12 });
      const results = [];
      for (const w of q.words) results.push((await answer(speedy, q.sessionId, w.id)).data); // без пауз
      const blocked = results.filter((r) => r.xp === 0 && r.grains === 0);
      ok(results.length === 12, `слів у тесті: ${results.length}`);
      ok(blocked.length >= 5, `заблоковано лише ${blocked.length} з ${results.length}`);
    });
    await test('підсумок тесту рахує сервер, а не клієнт', async () => {
      const q = await quiz(alice, { count: 5 });
      await answer(alice, q.sessionId, q.words[0].id, true);
      await answer(alice, q.sessionId, q.words[1].id, false);
      const fin = await api('/quiz/finish', { method: 'POST', body: { sessionId: q.sessionId, total: 999, correct: 999 }, user: alice });
      eq(fin.data.total, 2, 'усього');
      eq(fin.data.correct, 1, 'правильних');
      eq((await api('/quiz/finish', { method: 'POST', body: { sessionId: q.sessionId }, user: alice })).status, 409, 'повторне завершення');
      eq((await answer(alice, q.sessionId, q.words[2].id)).status, 409, 'відповідь після завершення');
    });
    await test('помилка, а потім правильна відповідь того ж дня не платить', async () => {
      const carl = await register('carl');
      const deck = await firstDeck(carl);
      const w = (await addWord(carl, deck.id, 'window', 'вікно')).data.word;
      const q = await quiz(carl, { count: 5 });
      await sleep(800);
      await answer(carl, q.sessionId, w.id, false); // нове слово — помилка
      const before = (await api('/grains', { user: carl })).data.balance;
      const q2 = await quiz(carl, { count: 5 });
      await sleep(800);
      await answer(carl, q2.sessionId, w.id, true); // тепер «пора повторити» — але сьогодні вже помилялись
      eq((await api('/grains', { user: carl })).data.balance, before, 'баланс змінився');
    });
    let dave;
    await test('нові слова платять не більше ніж за 10 на день', async () => {
      dave = await register('dave');
      await api('/me', { method: 'PATCH', body: { dailyGoal: 10 }, user: dave });
      const deck = await firstDeck(dave);
      for (let i = 0; i < 14; i++) await addWord(dave, deck.id, `word${i}`, `слово${i}`);
      const q = await quiz(dave, { count: 14 });
      let grains = 0;
      for (const w of q.words) {
        await sleep(750);
        grains += (await answer(dave, q.sessionId, w.id, true)).data.grains;
      }
      const today = (await api('/grains', { user: dave })).data.today;
      eq(today.newWords, 10, 'оплачених нових слів');
      ok(grains <= 10 + 10, `забагато зерняток за раз: ${grains}`); // 10 за слова + 10 за денну ціль
    });
    await test('денна ціль зараховується один раз', async () => {
      const rows = (await api('/grains', { user: dave })).data.history.filter((r) => r.kind === 'goal');
      eq(rows.length, 1, 'записів про ціль');
      eq(rows[0].amount, 10, 'нараховано');
    });

    await test('видалити й додати слово знову — зернятка не нараховуються повторно', async () => {
      const greg = await register('greg');
      const deck = await firstDeck(greg);
      const first = (await addWord(greg, deck.id, 'unique-term', 'унікальне')).data.word;
      const q = await quiz(greg, { count: 5 });
      await sleep(800);
      const paid = (await answer(greg, q.sessionId, first.id, true)).data.grains;
      eq(paid, 1, 'за нове слово');
      await api(`/words/${first.id}`, { method: 'DELETE', user: greg });
      const again = (await addWord(greg, deck.id, 'unique-term', 'унікальне')).data.word;
      const q2 = await quiz(greg, { count: 5 });
      await sleep(800);
      eq((await answer(greg, q2.sessionId, again.id, true)).data.grains, 0, 'за те саме слово вдруге');
    });
    await test('скидання прогресу не дає заробити на слові ще раз', async () => {
      const hana = await register('hana');
      const deck = await firstDeck(hana);
      const w = (await addWord(hana, deck.id, 'reset-me', 'скинь мене')).data.word;
      const q = await quiz(hana, { count: 5 });
      await sleep(800);
      await answer(hana, q.sessionId, w.id, true);
      const before = (await api('/grains', { user: hana })).data.balance;
      await api(`/words/${w.id}`, { method: 'PATCH', body: { reset: true }, user: hana });
      const q2 = await quiz(hana, { count: 5 });
      await sleep(800);
      await answer(hana, q2.sessionId, w.id, true);
      eq((await api('/grains', { user: hana })).data.balance, before, 'баланс змінився');
    });
    await test('розмір тесту обмежений 50 словами', async () => {
      const q = await quiz(alice, { count: 9999 });
      ok(q.words.length <= 50, `слів у тесті: ${q.words.length}`);
    });

    /* ---------- магазин ---------- */
    group('Магазин');
    const shop = async (user) => (await api('/shop', { user })).data;
    const buy = (user, id, body = {}) => api(`/shop/${id}/buy`, { method: 'POST', body, user });
    const balance = async (user) => (await api('/me', { user })).data.user.grains;

    const eve = await register('eve');
    const catalog = await shop(eve);
    const gift = catalog.packs.find((p) => p.free);
    let cheap; // пак, який eve може дозволити собі за стартові 50 🌾 (визначаємо після подарунка)
    let pricey;

    await test('перший пак безкоштовний — але лише один', async () => {
      eq((await buy(eve, gift.id)).data.price, 0, 'ціна подарунка');
      eq(await balance(eve), 50, 'баланс після подарунка');
      const after = await shop(eve);
      eq(after.firstFree, false, 'подарунок не зник');
      const balanceNow = await balance(eve);
      cheap = after.packs.filter((p) => p.price > 0 && p.price <= balanceNow && !p.owned).sort((a, b) => a.price - b.price)[0];
      pricey = after.packs.filter((p) => p.price > balanceNow).sort((a, b) => b.price - a.price)[0];
      ok(cheap && pricey, 'у каталозі немає потрібних паків для тесту');
    });
    await test('той самий пак не купити двічі', async () => {
      eq((await buy(eve, gift.id)).status, 409, 'статус');
    });
    await test('ціну рахує сервер: підроблені price / free ігноруються', async () => {
      const before = await balance(eve);
      const r = await buy(eve, cheap.id, { price: 0, free: true, deckId: 1 });
      eq(r.status, 200, 'покупка');
      eq(r.data.price, cheap.price, 'списано за прайсом сервера');
      eq(await balance(eve), before - cheap.price, 'баланс');
    });
    await test('без зерняток пак не купити навіть прямим запитом', async () => {
      const before = await balance(eve);
      const r = await buy(eve, pricey.id, { price: 0, free: true });
      eq(r.status, 402, 'статус');
      eq(await balance(eve), before, 'баланс змінився');
      const decks = (await api('/decks', { user: eve })).data.decks;
      ok(!decks.some((d) => d.packId === pricey.id), 'словник усе одно створився');
    });
    await test('неіснуючий пак → 404', async () => {
      eq((await buy(eve, 'no-such-pack')).status, 404, 'статус');
    });
    await test('куплений пак повертається безкоштовно, якщо словник видалили', async () => {
      const deck = (await api('/decks', { user: eve })).data.decks.find((d) => d.packId === cheap.id);
      await api(`/decks/${deck.id}`, { method: 'DELETE', user: eve });
      const before = await balance(eve);
      const r = await buy(eve, cheap.id);
      eq(r.status, 200, 'відновлення');
      eq(r.data.price, 0, 'ціна відновлення');
      eq(await balance(eve), before, 'баланс');
    });
    await test('куплений пак стає словником зі словами', async () => {
      const decks = (await api('/decks', { user: eve })).data.decks;
      const deck = decks.find((d) => d.packId === gift.id);
      ok(deck && deck.total > 0, 'словник пака порожній');
    });
    await test('відомі слова не дублюються і здешевлюють пак', async () => {
      const frank = await register('frank');
      const deckF = await firstDeck(frank);
      const target = (await shop(frank)).packs.find((p) => p.count >= 20 && !p.free && p.price > 0);
      const preview = target.preview.slice(0, 3);
      for (const w of preview) await addWord(frank, deckF.id, w.term, w.translation);
      const after = (await shop(frank)).packs.find((p) => p.id === target.id);
      eq(after.knownCount, preview.length, 'відомих слів');
      ok(after.price < target.price, 'ціна не зменшилась');
    });

    /* ---------- ліміти ШІ ---------- */
    group('Ліміти ШІ');
    await test('великий запит понад годинний ліміт відхиляється', async () => {
      const deck = await firstDeck(bob);
      const r = await api('/ai/batch', { method: 'POST', body: { deckId: deck.id, words: ['one', 'two', 'three', 'four', 'five'] }, user: bob });
      eq(r.status, 429, 'статус');
      ok(/слів на годину/.test(r.data.error), `текст помилки: ${r.data.error}`);
    });
    await test('залишок ліміту видно в /ai/status', async () => {
      const r = await api('/ai/status', { user: bob });
      eq(r.data.allowance.limits.wordsPerHour, 3, 'ліміт на годину');
      eq(r.data.allowance.hour, 3, 'залишок');
    });

    /* ---------- адмінка ---------- */
    group('Адмінка');
    await test('звичайний користувач не бачить аналітику', async () => {
      eq((await api('/admin/stats', { user: bob })).status, 403, 'статус');
      eq((await api('/me', { user: bob })).data.user.isAdmin, false, 'позначка адміна');
    });
    await test('адмін бачить аналітику', async () => {
      const me = await api('/me', { user: alice });
      eq(me.data.user.isAdmin, true, 'позначка адміна');
      const r = await api('/admin/stats', { user: alice });
      eq(r.status, 200, 'статус');
      ok(r.data.users.total >= 2, 'користувачів');
      ok(r.data.learning.words > 0, 'слів');
      ok(Array.isArray(r.data.topUsers) && r.data.topUsers.length, 'список користувачів');
      ok(r.data.ai.limits.wordsPerDay === 5, 'ліміти ШІ у відповіді');
    });
    await test('аналітика без входу недоступна', async () => {
      eq((await api('/admin/stats')).status, 401, 'статус');
    });

    /* ---------- налаштування ---------- */
    group('Налаштування');
    await test('денна ціль менша за 10 не приймається', async () => {
      eq((await api('/me', { method: 'PATCH', body: { dailyGoal: 5 }, user: alice })).status, 400, 'статус');
      eq((await api('/me', { method: 'PATCH', body: { dailyGoal: 30 }, user: alice })).status, 200, 'нормальна ціль');
    });
    await test('часовий пояс можна змінити раз на тиждень', async () => {
      eq((await api('/me', { method: 'PATCH', body: { timezone: 'Europe/Warsaw' }, user: alice })).status, 200, 'перша зміна');
      eq((await api('/me', { method: 'PATCH', body: { timezone: 'Asia/Tokyo' }, user: alice })).status, 400, 'друга зміна');
      eq((await api('/me', { method: 'PATCH', body: { timezone: 'Невідомо/Місто' }, user: alice })).status, 400, 'невідомий пояс');
    });
    await test('журнал зерняток показує стартовий подарунок', async () => {
      const g = (await api('/grains', { user: alice })).data;
      ok(g.history.some((r) => r.kind === 'start' && r.amount === 50), 'немає запису про подарунок');
    });
  } finally {
    server.kill();
  }

  console.log(`\nПройдено: ${passed}, провалено: ${failures.length}`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exit(1);
  }
})();
