// Робить паки зі сценаріїв серіалу чи фільму: Gemini вибирає з тексту слова, фразові дієслова й ідіоми,
// приклад — справжня репліка з серії.
//   node --env-file=.env scripts/build-screen-pack.js <тека-або-файл> <seriesId> --title "Альф" [опції]
//
// Вхід — .txt / .srt / .vtt. Номер серії береться з назви файлу: S01E02, 1x02, s1e2, alf-1-2
// (що після нього — назва серії: «S01E02 Looking for Lucky.txt»). Один файл без номера — це фільм, один пак.
//
// Опції:
//   --title "Альф"      назва серіалу/фільму в магазині (обов'язково)
//   --level B1          мінімальний рівень слів (A2…C1), нижче — не беремо; за замовчуванням B1
//   --words 30          скільки слів брати з однієї серії
//   --group season      один пак на сезон замість пака на серію
//   --only S01E01,S01E02  прогнати лише ці серії
//   --fresh             не брати відповіді з кешу, запитати серії заново
//   --upgrade           перепитати серії, які зробила запасна (слабша) модель, бо основна була перевантажена
//   --cover alf.jpg     обкладинка серіалу для магазину (копіюється в public/series/<seriesId>.jpg)
//
// Кожна серія — один запит до Gemini. Відповіді кешуються в packs/.<seriesId>.cache.json,
// тож якщо денний ліміт вичерпався — просто запусти ще раз завтра. Слово, що вже було в попередній
// серії або в паках «Основа A1/A2», повторно не потрапляє.

const fs = require('fs');
const path = require('path');
const { norm, findTermInSentence } = require('../public/text.js');

const flags = {};
const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const next = process.argv[i + 1];
  flags[a.slice(2)] = next && !next.startsWith('--') ? (i++, next) : true;
}
const opt = (name, def) => (typeof flags[name] === 'string' ? flags[name] : def);
const [src, seriesId] = positional;
const TITLE = opt('title');
const MIN_LEVEL = opt('level', 'B1').toUpperCase();
const PER_EPISODE = Number(opt('words', 30));
const GROUP = opt('group', 'episode');
const COVER = opt('cover');
const FRESH = Boolean(flags.fresh);
const UPGRADE = Boolean(flags.upgrade);
const ONLY = (opt('only', '') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

if (!src || !seriesId || !TITLE) {
  console.error('Використання: build-screen-pack.js <тека-або-файл> <seriesId> --title "Назва" [--level B1] [--words 30] [--group season]');
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(seriesId)) { console.error('seriesId — латиниця, цифри й дефіс: alf, friends, shrek'); process.exit(1); }
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY не задано'); process.exit(1); }

const ROOT = path.join(__dirname, '..');
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS = (process.env.PACK_MODELS || 'gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest').split(',');
const CACHE = path.join(ROOT, 'packs', `.${seriesId}.cache.json`);
const PLAN = path.join(__dirname, 'screen-plan.json');
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const MAX_TEXT = 60000; // символів сценарію на запит — із запасом для серії ситкому
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

// ---------- Читання й очищення сценаріїв ----------

function cleanTranscript(raw) {
  return raw
    .replace(/^﻿/, '')
    .replace(/^WEBVTT.*$/m, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\d+\s*$/.test(l)) // номери субтитрів
    .filter((l) => !/-->/.test(l)) // таймкоди
    .map((l) => l
      .replace(/<[^>]+>|\{[^}]+\}/g, '') // теги <i>, {\an8}
      .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ') // [laughter], (door slams)
      .replace(/^\s*[-–]\s*/, '')
      .replace(/^\s*[A-Z][A-Za-z .']{0,20}:\s+/, '') // «ALF: », «Willie: »
      .trim())
    .filter(Boolean)
    .join('\n');
}

// Репліки → речення; рядки субтитрів без розділового знаку склеюються з наступними
function sentences(text) {
  return text.replace(/\n+/g, ' ').replace(/\s+/g, ' ')
    .split(/(?<=[.!?…]['"”’)]*)\s+(?=["'“‘.A-Z0-9])/)
    .map(tidy).filter((s) => /[a-z]/i.test(s));
}

// Репліка без закадрових лапок і трикрапок по краях: «'...freshen up..'» → «freshen up»
function tidy(s) {
  let t = s.trim();
  if (/^'.*'$/.test(t) || (t.startsWith("'") && !t.slice(1).includes("'"))) t = t.replace(/^'|'$/g, '');
  return t.replace(/^(\.{2,}|…)\s*/, '').replace(/\s*(\.{2,}|…)$/, (m) => (m.trim() === '...' ? '...' : '.')).trim();
}

function episodeCode(name) {
  const m = name.match(/s(\d{1,2})\s*e(\d{1,3})/i) || name.match(/(?<!\d)(\d{1,2})x(\d{1,3})(?!\d)/i)
    || name.match(/(?<!\d)(\d{1,2})[-_.](\d{1,3})(?=\D*$)/); // alf-1-2.txt
  if (!m) return null;
  const season = Number(m[1]);
  const episode = Number(m[2]);
  const rest = name.slice(m.index + m[0].length).replace(/\.[a-z0-9]+$/i, '').replace(/^[\s._–—-]+/, '').replace(/[._]+/g, ' ').trim();
  return { season, episode, code: `S${pad(season)}E${pad(episode)}`, name: rest };
}

function readSources() {
  const stat = fs.statSync(src);
  const files = stat.isDirectory()
    ? fs.readdirSync(src).filter((f) => /\.(txt|srt|vtt)$/i.test(f)).map((f) => path.join(src, f))
    : [src];
  if (!files.length) { console.error('У теці немає .txt / .srt / .vtt'); process.exit(1); }
  const episodes = files.map((file) => {
    const text = cleanTranscript(fs.readFileSync(file, 'utf8'));
    return { file, text, sentences: sentences(text), ...(episodeCode(path.basename(file)) || {}) };
  });
  const movie = episodes.length === 1 && !episodes[0].code;
  if (!movie) {
    const bad = episodes.filter((e) => !e.code);
    if (bad.length) { console.error(`Не знайшов номер серії в назві: ${bad.map((e) => path.basename(e.file)).join(', ')}`); process.exit(1); }
  } else {
    Object.assign(episodes[0], { code: 'MOVIE', season: 0, episode: 0, name: '' });
  }
  episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  return { episodes, movie };
}

// ---------- Gemini ----------

async function gemini(prompt, schema) {
  let lastError;
  // Найкраща модель часто відповідає 503 «high demand» — даємо їй кілька спроб, а потім уже легші
  const order = [MODELS[0], MODELS[0], MODELS[0], ...MODELS.slice(1), ...MODELS.slice(1)];
  for (const model of order) {
    try {
      const res = await fetch(`${API}/${model}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(180000),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(`${model} ${res.status}: ${data.error?.message?.slice(0, 90)}`), { status: res.status });
      return { model, ...JSON.parse((data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')) };
    } catch (e) {
      lastError = e;
      console.warn(`   ⚠ ${e.message}`);
      await sleep(e.status === 429 || e.status === 503 ? 20000 : 5000);
    }
  }
  throw lastError;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          term: { type: 'STRING' },
          quote: { type: 'STRING' },
          translation: { type: 'STRING' },
          transcription: { type: 'STRING' },
          level: { type: 'STRING', enum: LEVELS },
        },
        required: ['term', 'quote', 'translation', 'transcription', 'level'],
      },
    },
  },
  required: ['summary', 'items'],
};

function extract(ep, skip) {
  const what = ep.code === 'MOVIE' ? `the film "${TITLE}"` : `the TV series "${TITLE}", episode ${ep.code}${ep.name ? ` "${ep.name}"` : ''}`;
  return gemini(`You build a vocabulary list for Ukrainian learners of English from the script of ${what}.
Pick about ${PER_EPISODE} words and expressions from the script that are most worth learning for a ${MIN_LEVEL}+ learner who wants to understand this show.
Prefer, in this order: phrasal verbs, idioms and set expressions, colloquial words typical of spoken English, then useful single words.
Skip: proper names, interjections (uh, hey, wow), swear words, words below CEFR ${MIN_LEVEL}, rare words nobody uses today, and these already-covered terms: ${skip.slice(0, 400).join(', ') || 'none'}.

For each item:
- "term": the dictionary headword as a learner's dictionary lists it: "to" ONLY before verbs ("to sneak", "to give up"), never before nouns, adjectives or phrases;
  whole idioms with placeholders where needed ("to keep one's distance", "to keep one's end of the bargain", "the ball is in sb's court", "I'm out of here");
  never cut an idiom into a meaningless piece;
- "quote": ONE sentence copied EXACTLY, character for character, from the script where the term is used (trim to the single sentence, max ~150 characters, do not paraphrase);
- "translation": natural, correctly spelled Ukrainian (never Russian or surzhyk), 1-3 short synonyms separated by ", ", in the meaning used in the quote; for idioms — the Ukrainian equivalent; no explanations;
- "transcription": IPA in slashes of the term WITHOUT the leading "to" ("/ɡɪv ʌp/");
- "level": CEFR level of the term.
Also return "summary": one short sentence in Ukrainian (names in Ukrainian Cyrillic: Альф, Віллі, Кейт, Лінн, Браян, Таннери) about what happens in this ${ep.code === 'MOVIE' ? 'film' : 'episode'} (no spoilers of the ending).

SCRIPT:
${ep.text.slice(0, MAX_TEXT)}`, SCHEMA);
}

// ---------- Перевірка відповіді ----------

// Репліка має справді бути в сценарії; якщо модель її переказала — шукаємо справжнє речення зі словом
function realQuote(item, ep) {
  const q = norm(item.quote);
  const exact = q && ep.sentences.find((s) => norm(s).includes(q) || (q.length > 20 && q.includes(norm(s)) && norm(s).length > q.length * 0.6));
  if (exact && findTermInSentence(item.term, exact)) {
    return norm(exact) === q ? exact : item.quote.trim();
  }
  const withTerm = ep.sentences.filter((s) => s.length <= 200 && findTermInSentence(item.term, s));
  return withTerm.sort((a, b) => Math.abs(a.length - 70) - Math.abs(b.length - 70))[0] || null;
}

function knownBasics() {
  const set = new Set();
  for (const id of ['core-a1', 'core-a2']) {
    const file = path.join(ROOT, 'packs', `${id}.json`);
    if (!fs.existsSync(file)) continue;
    for (const w of JSON.parse(fs.readFileSync(file, 'utf8')).words) set.add(norm(Array.isArray(w) ? w[0] : w.term));
  }
  return set;
}

const levelAtLeast = (lv, min) => LEVELS.indexOf(lv) >= LEVELS.indexOf(min);
// Рівень пака — медіана рівнів слів, у межах цін магазину (A1…C1)
function packLevel(rows) {
  const ls = rows.map((r) => LEVELS.indexOf(r.level)).filter((i) => i >= 0).sort((a, b) => a - b);
  const mid = ls.length ? ls[Math.floor(ls.length / 2)] : LEVELS.indexOf(MIN_LEVEL);
  return LEVELS[Math.min(Math.max(mid, 1), 4)];
}

// ---------- Головне ----------

(async () => {
  const { episodes, movie } = readSources();
  if (COVER) {
    fs.mkdirSync(path.join(ROOT, 'public', 'series'), { recursive: true });
    const dest = path.join(ROOT, 'public', 'series', `${seriesId}.jpg`);
    if (path.resolve(COVER) !== dest) fs.copyFileSync(COVER, dest);
  }
  const todo = ONLY.length ? episodes.filter((e) => ONLY.includes(e.code)) : episodes;
  console.log(`${movie ? 'Фільм' : `Серій: ${episodes.length}`} · рівень від ${MIN_LEVEL} · до ${PER_EPISODE} слів на серію`);

  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const seen = knownBasics();
  const problems = [];
  const result = []; // { ep, rows }

  for (const ep of episodes) {
    if (!ep.sentences.length) { problems.push(`${ep.code}: порожній сценарій`); continue; }
    const stale = !cache[ep.code] || FRESH || (UPGRADE && cache[ep.code].model !== MODELS[0]);
    if (stale && todo.includes(ep)) {
      console.log(`→ ${ep.code}${ep.name ? ` ${ep.name}` : ''} (${ep.text.length} символів)`);
      const skip = [...seen].filter(Boolean);
      const out = await extract(ep, skip);
      // при --upgrade відповідь знову запасної моделі не затирає попередню
      if (!(UPGRADE && cache[ep.code] && out.model !== MODELS[0])) cache[ep.code] = { model: out.model, summary: out.summary, items: out.items };
      fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
    }
    if (!cache[ep.code]) continue; // ще не прогнана — пропускаємо, наступні серії все одно перевіряємо на дублі

    const rows = [];
    for (const item of cache[ep.code].items || []) {
      const term = String(item.term || '').trim();
      const translation = String(item.translation || '').trim();
      const k = norm(term);
      const tag = `${ep.code} «${term}»`;
      if (!k || seen.has(k)) continue;
      if (!levelAtLeast(item.level, MIN_LEVEL)) continue;
      if (!/[а-яіїєґ]/i.test(translation) || /[ыэъё]/i.test(translation)) { problems.push(`${tag}: переклад «${translation}»`); continue; }
      const example = realQuote(item, ep);
      if (!example) { problems.push(`${tag}: не знайшов у сценарії`); continue; }
      let transcription = String(item.transcription || '').trim();
      transcription = `/${transcription.replace(/^\/|\/$/g, '').replace(/^t[uəʊ]ː? (?=\S)/, '').trim()}/`;
      seen.add(k);
      rows.push({ term, translation, transcription, example: tidy(example), level: item.level });
    }
    result.push({ ep, rows });
    console.log(`   ${ep.code}: ${rows.length} слів`);
  }

  // Групування в паки
  const packsOut = [];
  if (movie) {
    const { rows } = result[0] || { rows: [] };
    packsOut.push({ id: seriesId, title: TITLE, description: cache.MOVIE?.summary || `Слова з фільму «${TITLE}».`, rows, label: '🎬', season: 0, episode: 0 });
  } else if (GROUP === 'season') {
    const seasons = new Map();
    for (const r of result) {
      if (!seasons.has(r.ep.season)) seasons.set(r.ep.season, []);
      seasons.get(r.ep.season).push(r);
    }
    for (const [season, list] of seasons) {
      packsOut.push({
        id: `${seriesId}-s${pad(season)}`, title: `${TITLE} · Сезон ${season}`, label: `S${season}`, season, episode: 0,
        description: `Слова з ${list.length} серій ${season}-го сезону — у реченнях із самих серій.`,
        rows: list.flatMap((r) => r.rows),
      });
    }
  } else {
    for (const { ep, rows } of result) {
      packsOut.push({
        id: `${seriesId}-${ep.code.toLowerCase()}`, title: `${TITLE} · ${ep.season}×${pad(ep.episode)}${ep.name ? ` ${ep.name}` : ''}`,
        label: `${ep.season}·${pad(ep.episode)}`, season: ep.season, episode: ep.episode, episodeTitle: ep.name, description: cache[ep.code]?.summary || '', rows,
      });
    }
  }

  // Зміст паків + метадані для магазину (scripts/screen-plan.json, решта серіалів не чіпається)
  const plan = fs.existsSync(PLAN) ? JSON.parse(fs.readFileSync(PLAN, 'utf8')) : [];
  const other = plan.filter((p) => p.series !== seriesId);
  const mine = [];
  for (const p of packsOut) {
    if (p.rows.length < 10) { problems.push(`${p.id}: лише ${p.rows.length} слів — пак не створено (мінімум 10)`); continue; }
    const file = path.join(ROOT, 'packs', `${p.id}.json`);
    const words = p.rows.map((r) => JSON.stringify([r.term, r.translation, r.transcription, r.example]));
    fs.writeFileSync(file, `{"id":"${p.id}","source":"${TITLE} (script)","words":[\n${words.join(',\n')}\n]}\n`);
    mine.push({ id: p.id, type: 'screen', series: seriesId, seriesTitle: TITLE, season: p.season, episode: p.episode, episodeTitle: p.episodeTitle || '', label: p.label, level: packLevel(p.rows), size: p.rows.length, title: p.title, description: p.description, focus: `vocabulary from ${movie ? 'the film' : 'the TV series'} "${TITLE}"` });
    console.log(`✓ ${p.id}: ${p.rows.length} слів`);
  }
  fs.writeFileSync(PLAN, `${JSON.stringify([...other, ...mine], null, 1)}\n`);

  const left = episodes.filter((e) => !cache[e.code]).length;
  if (left) console.log(`\nЩе не прогнано серій: ${left} — запусти скрипт ще раз (кеш збережено).`);
  const weak = episodes.filter((e) => cache[e.code] && cache[e.code].model !== MODELS[0]).map((e) => e.code);
  if (weak.length) console.log(`\nЗроблено запасною моделлю: ${weak.join(', ')} — пізніше можна покращити з --upgrade.`);
  if (problems.length) {
    console.log(`\nВідкинуто / потребує уваги (${problems.length}):`);
    problems.slice(0, 60).forEach((p) => console.log('  ', p));
  }
  console.log('\nДалі: node scripts/make-icons.js && node scripts/check-packs.js, потім перезапуск сервера.');
})();
