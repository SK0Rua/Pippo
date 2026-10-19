// Генерує зміст паків слів через Gemini.
//   node --env-file=.env scripts/generate-packs.js            — усі паки, яких ще немає
//   node --env-file=.env scripts/generate-packs.js it law     — лише вказані (перегенерувати)
// Кожен пак: генерація порціями → локальні перевірки → рецензія моделлю → packs/<id>.json
// Увага: безкоштовний тариф gemini-3.5-flash дає лише ~20 запитів на день, а lite-моделі для паків слабкі,
// тому більшість паків написано вручну; після змін завжди запускай scripts/check-packs.js.

const fs = require('fs');
const path = require('path');
const plan = require('./pack-plan');
const { norm, findTermInSentence } = require('../public/text.js');

const OUT = path.join(__dirname, '..', 'packs');
const MODELS = (process.env.PACK_MODELS || 'gemini-3.5-flash,gemini-3.8-flash').split(',');
const BATCH = 25;
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY не задано'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WORD = {
  type: 'OBJECT',
  properties: { term: { type: 'STRING' }, translation: { type: 'STRING' }, transcription: { type: 'STRING' }, example: { type: 'STRING' } },
  required: ['term', 'translation', 'transcription', 'example'],
};

async function gemini(prompt, schema) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt++) {
    const model = MODELS[attempt % MODELS.length];
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(180000),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, responseMimeType: 'application/json', responseSchema: schema },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(`${model} ${res.status}: ${data.error?.message?.slice(0, 120)}`), { status: res.status });
      return JSON.parse((data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
    } catch (e) {
      lastError = e;
      const wait = e.status === 429 ? 30000 : 4000 * (attempt + 1);
      console.warn(`   ⚠ ${e.message} — повтор через ${wait / 1000} с`);
      await sleep(wait);
    }
  }
  throw lastError;
}

const RULES = `Rules for every entry:
- "term": English, dictionary form. Verbs start with "to" ("to dispatch"). Phrasal verbs, idioms and collocations stay whole ("to give up", "to break the ice", "to make a decision"). Nouns without articles.
- "translation": natural Ukrainian (never Russian), 1-3 synonyms separated by ", " — no explanations or brackets unless essential.
- "transcription": British IPA in slashes, without the leading "to".
- "example": one natural English sentence of 7-16 words that contains the term (an inflected form is fine) and makes its meaning clear from context.
- Every term must be distinct in meaning from the others. Prefer genuinely useful, frequent words for this theme and level.`;

function describe(pack) {
  return `Vocabulary pack for Ukrainian learners of English.
Pack title (Ukrainian): "${pack.title}". Theme: ${pack.focus}. Target CEFR level: ${pack.level}.`;
}

function localIssues(w, seen) {
  if (!w.term || !w.translation || !w.example) return 'порожнє поле';
  if (/[а-яіїєґ]/i.test(w.term)) return 'кирилиця в слові';
  if (!/[а-яіїєґ]/i.test(w.translation)) return 'переклад не українською';
  if (/[ыэъё]/i.test(w.translation)) return 'російські літери в перекладі';
  if (seen.has(norm(w.term))) return 'дубль';
  const len = w.example.split(/\s+/).length;
  if (len < 5 || len > 25) return 'довжина прикладу';
  if (!findTermInSentence(w.term, w.example)) return 'слова немає в прикладі';
  return null;
}

async function buildPack(pack, exclude) {
  const words = [];
  const seen = new Set(exclude.map(norm));
  for (let round = 0; round < 8 && words.length < pack.size; round++) {
    const need = Math.min(BATCH, pack.size - words.length);
    const ask = need + Math.ceil(need * 0.3); // із запасом — частина відсіється
    const avoid = [...seen].slice(-400).join(', ');
    const { words: batch = [] } = await gemini(
      `${describe(pack)}\nGive exactly ${ask} NEW entries.\n${RULES}\nDo NOT use any of these terms: ${avoid || '(none yet)'}`,
      { type: 'OBJECT', properties: { words: { type: 'ARRAY', items: WORD } }, required: ['words'] },
    );

    const candidates = [];
    for (const raw of batch) {
      const w = { term: String(raw.term || '').trim(), translation: String(raw.translation || '').trim(), transcription: String(raw.transcription || '').trim(), example: String(raw.example || '').trim() };
      const issue = localIssues(w, seen);
      if (issue) { console.log(`   [${pack.id}] ✗ ${w.term || "?"}: ${issue}`); continue; }
      seen.add(norm(w.term));
      candidates.push(w);
    }
    if (!candidates.length) continue;

    // Рецензія: друга думка моделі щодо перекладів, прикладів і доречності
    const { entries = [] } = await gemini(
      `${describe(pack)}
You are a strict reviewer. Check each entry below.
- Set "keep" to false if the entry is off-theme, clearly below/above level ${pack.level} for this pack, not standard English, or duplicates the meaning of another entry.
- Otherwise set "keep" to true and return the entry with any mistakes FIXED: wrong or unnatural Ukrainian translation, Russian words, wrong IPA, unnatural example or example that does not contain the term.
${RULES}
Entries (JSON): ${JSON.stringify(candidates)}`,
      { type: 'OBJECT', properties: { entries: { type: 'ARRAY', items: { ...WORD, properties: { ...WORD.properties, keep: { type: 'BOOLEAN' } }, required: [...WORD.required, 'keep'] } } }, required: ['entries'] },
    );

    const reviewed = new Map(entries.map((e) => [norm(e.term), e]));
    for (const c of candidates) {
      if (words.length >= pack.size) break;
      const r = reviewed.get(norm(c.term));
      if (r && r.keep === false) { console.log(`   [${pack.id}] ✗ ${c.term}: відхилено рецензентом`); continue; }
      const fixed = r ? { term: c.term, translation: r.translation.trim(), transcription: r.transcription.trim(), example: r.example.trim() } : c;
      const localSeen = new Set(words.map((w) => norm(w.term)));
      const issue = localIssues(fixed, localSeen);
      words.push(issue ? c : fixed);
    }
    console.log(`   [${pack.id}] ${words.length}/${pack.size}`);
  }
  return words;
}

(async () => {
  const only = process.argv.slice(2);
  const todo = plan.filter((p) => (only.length ? only.includes(p.id) : !fs.existsSync(path.join(OUT, `${p.id}.json`))));
  console.log(`Паків до генерації: ${todo.length}`);

  // Паки «Основа» залежать один від одного (виключення слів), тому йдуть в одному потоці по черзі
  const core = todo.filter((p) => p.id.startsWith('core-')).sort((a, b) => a.id.localeCompare(b.id));
  const rest = todo.filter((p) => !p.id.startsWith('core-'));
  const workers = Math.max(1, Number(process.env.PACK_CONCURRENCY) || 3);
  await Promise.all(Array.from({ length: workers }, async (_, i) => {
    for (;;) {
      const pack = (i === 0 && core.shift()) || rest.shift();
      if (!pack) return;
      await runPack(pack);
    }
  }));
  console.log('Готово');
})();

async function runPack(pack) {
  console.log(`▶ ${pack.id} (${pack.title}, ${pack.level}, ${pack.size})`);
  // Паки «Основа» не повинні перетинатися між собою
  const exclude = [];
  if (pack.type === 'level' && pack.id.startsWith('core-')) {
    for (const other of plan.filter((p) => p.id.startsWith('core-') && p.id < pack.id)) {
      const file = path.join(OUT, `${other.id}.json`);
      if (fs.existsSync(file)) exclude.push(...JSON.parse(fs.readFileSync(file, 'utf8')).words.map((w) => w.term));
    }
  }
  try {
    const words = await buildPack(pack, exclude);
    if (words.length < pack.size) console.warn(`   [${pack.id}] ⚠ лише ${words.length} з ${pack.size}`);
    fs.writeFileSync(path.join(OUT, `${pack.id}.json`), JSON.stringify({ id: pack.id, generatedAt: new Date().toISOString(), words }, null, 1));
    console.log(`   [${pack.id}] ✓ збережено ${words.length}`);
  } catch (e) {
    console.error(`   ✗ ${pack.id}: ${e.message}`);
  }
}
