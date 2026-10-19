// Перетворює вилучений список слів (з PDF підручника) на пак Pippo: перекладає через Gemini,
// транскрипцію та приклади бере з підручника.
//   node --env-file=.env scripts/build-wordlist-pack.js <extracted.json> <packId>
// Результат зберігається порціями, тож скрипт можна запускати повторно — уже перекладене не чіпається.

const fs = require('fs');
const path = require('path');
const { norm, findTermInSentence } = require('../public/text.js');

// --split — окремий пак на кожен File підручника: <packId>-1, <packId>-2, …
const args = process.argv.slice(2);
const SPLIT = args.includes('--split');
const [srcFile, packId = 'ef4e-intermediate'] = args.filter((a) => !a.startsWith('--'));
if (!srcFile) { console.error('Вкажи файл із вилученими словами'); process.exit(1); }
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY не задано'); process.exit(1); }

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS = (process.env.PACK_MODELS || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash').split(',');
const BATCH = Number(process.env.BATCH) || 25;
const OUT = path.join(__dirname, '..', 'packs', `${packId}.json`);
const CACHE = path.join(__dirname, '..', 'packs', `.${packId}.cache.json`);

const POS = ['n pl', 'phr v', 'adj', 'adv', 'prep', 'pron', 'conj', 'exclam', 'phr', 'n', 'v'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function splitPos(raw) {
  for (const p of POS) if (raw.endsWith(` ${p}`)) return { word: raw.slice(0, -p.length - 1).trim(), pos: p };
  return { word: raw.trim(), pos: '' };
}

// Дієслова в Pippo мають словникову форму з «to»
const dictionaryForm = ({ word, pos }) => (['v', 'phr v'].includes(pos) && !/^to /i.test(word) ? `to ${word}` : word);

async function gemini(prompt, schema) {
  let lastError;
  for (let attempt = 0; attempt < MODELS.length * 3; attempt++) {
    const model = MODELS[attempt % MODELS.length];
    try {
      const res = await fetch(`${API}/${model}:generateContent`, {
        method: 'POST',
        signal: AbortSignal.timeout(120000),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(`${model} ${res.status}: ${data.error?.message?.slice(0, 90)}`), { status: res.status });
      return JSON.parse((data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
    } catch (e) {
      lastError = e;
      console.warn(`   ⚠ ${e.message}`);
      await sleep(e.status === 429 ? 20000 : 5000);
    }
  }
  throw lastError;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { term: { type: 'STRING' }, translation: { type: 'STRING' } },
        required: ['term', 'translation'],
      },
    },
  },
  required: ['items'],
};

async function translateBatch(items) {
  const list = items.map((it, i) => `${i + 1}. ${it.term}${it.pos ? ` (${it.pos})` : ''} — topic: ${it.section} — example: ${it.example}`).join('\n');
  const { items: out = [] } = await gemini(
    `You translate English vocabulary for Ukrainian learners (English File 4e Intermediate, CEFR B1).
For each numbered item return the same "term" (copy it exactly as given, without the part-of-speech tag) and "translation".
Rules for "translation":
- natural Ukrainian (never Russian), 1-3 synonyms separated by ", ";
- the meaning the word has in the given example sentence and topic;
- no explanations or brackets, except a short clarifier in brackets when the word is ambiguous;
- for verbs use the infinitive ("залишати"), for adjectives the masculine form ("гарний"), for plural nouns the plural ("боби");
- for whole phrases and exclamations give the natural Ukrainian equivalent ("Never mind." → "Пусте, нічого страшного").
Return exactly ${items.length} items in the same order.

${list}`,
    SCHEMA,
  );
  return out;
}

(async () => {
  const source = JSON.parse(fs.readFileSync(srcFile, 'utf8'))
    .filter((e) => e.term && e.example && e.pron)
    .map((e) => {
      const { word, pos } = splitPos(e.term);
      return { term: dictionaryForm({ word, pos }), pos, transcription: e.pron, example: e.example, section: e.section, file: e.file };
    });

  // один термін — один запис
  const unique = [];
  const seen = new Set();
  for (const e of source) {
    const key = norm(e.term);
    if (key && !seen.has(key)) { seen.add(key); unique.push(e); }
  }
  console.log(`Слів: ${unique.length}`);

  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const todo = unique.filter((e) => !cache[norm(e.term)]);
  console.log(`Треба перекласти: ${todo.length}`);

  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const out = await translateBatch(chunk);
    chunk.forEach((item, j) => {
      const found = out.find((o) => norm(o.term) === norm(item.term)) || (out.length === chunk.length ? out[j] : null);
      const translation = found ? String(found.translation || '').trim() : '';
      if (translation) cache[norm(item.term)] = translation;
    });
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
    console.log(`   ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }

  const problems = [];
  const toRow = (e) => {
    const translation = cache[norm(e.term)] || '';
    if (!translation) { problems.push(`${e.term}: без перекладу`); return null; }
    if (!/[а-яіїєґ]/i.test(translation)) problems.push(`${e.term}: переклад не українською — «${translation}»`);
    else if (/[ыэъё]/i.test(translation)) problems.push(`${e.term}: російські літери — «${translation}»`);
    else if (!findTermInSentence(e.term, e.example)) problems.push(`${e.term}: немає в прикладі «${e.example}»`);
    return [e.term, translation, e.transcription, e.example];
  };

  const save = (id, rows) => {
    const file = path.join(__dirname, '..', 'packs', `${id}.json`);
    fs.writeFileSync(file, `{"id":"${id}","source":"English File 4e Intermediate Wordlist","words":[\n${rows.map((w) => JSON.stringify(w)).join(',\n')}\n]}\n`);
    console.log(`✓ ${id}: ${rows.length} слів`);
  };

  if (SPLIT) {
    const groups = new Map();
    for (const e of unique) {
      const n = Number((e.file.match(/\d+/) || [0])[0]);
      if (!n) continue;
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n).push(e);
    }
    for (const n of [...groups.keys()].sort((a, b) => a - b)) {
      save(`${packId}-${n}`, groups.get(n).map(toRow).filter(Boolean));
    }
  } else {
    save(packId, unique.map(toRow).filter(Boolean));
  }

  if (problems.length) {
    console.log(`\nПотребує уваги (${problems.length}):`);
    problems.slice(0, 40).forEach((p) => console.log('  ', p));
  }
})();
