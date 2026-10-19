// Автозаповнення карток: Gemini розбирає слово в контексті речення.
// Без ключа або коли Gemini недоступний — простий переклад через MyMemory.

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS = (process.env.GEMINI_MODELS || 'gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-flash-lite-latest')
  .split(',').map((m) => m.trim()).filter(Boolean);
const HEDGE_MS = 4000; // якщо модель мовчить стільки часу — паралельно питаємо наступну
const REQUEST_TIMEOUT_MS = 20000;

const LANG_NAMES = {
  en: 'English', uk: 'Ukrainian', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pl: 'Polish',
  pt: 'Portuguese', cs: 'Czech', tr: 'Turkish', ja: 'Japanese', zh: 'Chinese (Simplified)', ko: 'Korean',
};

const enabled = () => Boolean(process.env.GEMINI_API_KEY);

class AiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

const SYSTEM = `You are a careful bilingual lexicographer who builds vocabulary flashcards for a language learner.
Rules:
- "term" is the dictionary (base) form in the source language: "left" -> "leave", "went" -> "go", "children" -> "child".
- English verbs start with "to" ("to leave"). Keep phrasal verbs and idioms whole ("to give up", "to break the ice").
- "translation" gives the meaning the word has IN THE GIVEN SENTENCE, in the learner's language: 1-3 natural synonyms separated by ", ", no explanations, no brackets.
- "otherMeanings": up to 4 other common meanings that differ from "translation", each 1-3 words in the learner's language. Empty array if none.
- "transcription": IPA in slashes of the word/phrase itself WITHOUT the leading "to" for alphabetic languages, reading (pinyin/romaji/romanization) for CJK; empty string if not applicable.
- "explanation": one short sentence in the learner's language explaining the meaning in this context.
- Never invent words; if the input is not a real word or phrase, still return your best guess with an explanation saying so.`;

const CARD_PROPS = {
  term: { type: 'STRING' },
  translation: { type: 'STRING' },
  transcription: { type: 'STRING' },
  partOfSpeech: { type: 'STRING' },
};

async function requestModel(model, prompt, schema, signal) {
  const res = await fetch(`${API}/${model}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AiError(`${model}: ${data.error?.message || res.status}`, res.status);
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return JSON.parse(text);
}

// Моделі Gemini інколи перевантажені або «зависають» на хвилину.
// Тому запускаємо першу модель, а якщо вона не встигла за HEDGE_MS чи впала —
// паралельно наступну. Перемагає перша успішна відповідь, решта скасовуються.
function callGemini(prompt, schema) {
  return new Promise((resolve, reject) => {
    const controllers = [];
    let started = 0;
    let running = 0;
    let finished = false;
    let lastError = null;

    const settle = (fn, value) => {
      if (finished) return;
      finished = true;
      controllers.forEach((c) => c.abort());
      fn(value);
    };

    const launch = () => {
      if (finished || started >= MODELS.length) return;
      const model = MODELS[started++];
      const controller = new AbortController();
      controllers.push(controller);
      running++;
      let hedged = false;
      const hedge = setTimeout(() => { hedged = true; launch(); }, HEDGE_MS);
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      requestModel(model, prompt, schema, controller.signal)
        .then((data) => settle(resolve, data))
        .catch((e) => {
          if (finished) return;
          lastError = e.name === 'AbortError' ? new AiError(`${model}: не відповів вчасно`, 504) : e;
          console.warn('[ai]', lastError.message);
          if (!hedged) { clearTimeout(hedge); launch(); }
        })
        .finally(() => {
          clearTimeout(hedge);
          clearTimeout(timeout);
          running--;
          if (!finished && running === 0 && started >= MODELS.length) settle(reject, lastError || new AiError('Gemini недоступний'));
        });
    };

    launch();
  });
}

const clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanCard(c, sentence) {
  return {
    term: clip(c.term, 200),
    translation: clip(c.translation, 200),
    transcription: clip(c.transcription, 100),
    partOfSpeech: clip(c.partOfSpeech, 40),
    otherMeanings: Array.isArray(c.otherMeanings) ? c.otherMeanings.map((m) => clip(m, 80)).filter(Boolean).slice(0, 4) : [],
    explanation: clip(c.explanation, 300),
    example: clip(c.example || sentence, 500),
  };
}

async function myMemory(word, from, to) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${from}|${to}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await res.json().catch(() => ({}));
  const translation = data.responseData?.translatedText;
  if (!res.ok || !translation || data.responseStatus !== 200) throw new AiError('Не вдалося отримати переклад');
  const others = (data.matches || [])
    .map((m) => clip(m.translation, 80))
    .filter((t) => t && t.toLowerCase() !== translation.toLowerCase());
  return { translation, otherMeanings: [...new Set(others)].slice(0, 4) };
}

async function lookup({ word, sentence, from, to }) {
  if (enabled()) {
    try {
      // Без речення беремо найуживаніші значення й просимо модель скласти приклад
      const prompt = sentence
        ? `Source language: ${LANG_NAMES[from]}. Learner's language: ${LANG_NAMES[to]}.
Sentence: """${sentence}"""
Word or phrase to explain: """${word}"""`
        : `Source language: ${LANG_NAMES[from]}. Learner's language: ${LANG_NAMES[to]}.
There is no context sentence: put the 1-3 most common meanings into "translation" and other common meanings into "otherMeanings".
If the word is misspelled, put the closest correctly spelled word in "term" (same word and part of speech, e.g. "apointment" → "appointment", never a different word) and translate that. "example" is a short natural sentence in the source language that contains the term.
Word or phrase: """${word}"""`;
      const card = await callGemini(prompt, {
        type: 'OBJECT',
        properties: { ...CARD_PROPS, otherMeanings: { type: 'ARRAY', items: { type: 'STRING' } }, explanation: { type: 'STRING' }, example: { type: 'STRING' } },
        required: ['term', 'translation', 'transcription', 'partOfSpeech', 'otherMeanings', 'explanation', ...(sentence ? [] : ['example'])],
      });
      return { ...cleanCard(card, sentence), source: 'gemini' };
    } catch (e) {
      console.warn('[ai] Gemini lookup failed, fallback to MyMemory:', e.message);
    }
  }
  const mm = await myMemory(word, from, to);
  return { ...cleanCard({ term: word, ...mm }, sentence), source: 'mymemory' };
}

// Картки для списку окремих слів (без речення — беремо найуживаніші значення)
async function translateMany({ words, from, to }) {
  let cards = [];
  if (enabled()) {
    try {
      const data = await callGemini(
        `Source language: ${LANG_NAMES[from]}. Learner's language: ${LANG_NAMES[to]}.
Make one flashcard for EACH item below, in the same order, and copy the item unchanged into "input".
There is no context sentence: put the 1-3 most common meanings into "translation" and other common meanings into "otherMeanings".
If an item is misspelled, put the closest correctly spelled word in "term" (same word and part of speech, e.g. "apointment" → "appointment", never a different word). "example" is a short natural sentence in the source language that contains the term.
Items: ${JSON.stringify(words)}`,
        {
          type: 'OBJECT',
          properties: {
            items: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { input: { type: 'STRING' }, ...CARD_PROPS, example: { type: 'STRING' }, otherMeanings: { type: 'ARRAY', items: { type: 'STRING' } } },
                required: ['input', 'term', 'translation', 'transcription', 'example'],
              },
            },
          },
          required: ['items'],
        },
      );
      cards = data.items || [];
    } catch (e) {
      console.warn('[ai] Gemini batch failed, fallback to MyMemory:', e.message);
    }
  }

  const out = [];
  for (const [i, word] of words.entries()) {
    const found = cards.find((c) => String(c.input || '').trim().toLowerCase() === word.toLowerCase())
      || (cards.length === words.length ? cards[i] : null);
    if (found && found.term && found.translation) {
      out.push({ input: word, ...cleanCard(found, ''), source: 'gemini' });
      continue;
    }
    try {
      const mm = await myMemory(word, from, to);
      out.push({ input: word, ...cleanCard({ term: word, ...mm }, ''), source: 'mymemory' });
    } catch {
      out.push({ input: word, ...cleanCard({ term: word, translation: '' }, ''), source: 'none' });
    }
  }
  return out;
}

async function extract({ text, from, to, limit = 15 }) {
  if (!enabled()) throw new AiError('Для пошуку слів у тексті потрібен GEMINI_API_KEY', 501);
  const prompt = `Source language: ${LANG_NAMES[from]}. Learner's language: ${LANG_NAMES[to]}.
From the text below pick up to ${limit} words or phrases most worth learning for an intermediate learner
(skip proper names, numbers and the most basic words like "the", "is", "and", "my"). Prefer idioms and phrasal verbs as a whole.
For each item give the flashcard fields for the meaning used in the text, "example" = the exact sentence from the text where it occurs,
and "level" = approximate CEFR level (A1..C2).
Text: """${text}"""`;
  const data = await callGemini(prompt, {
    type: 'OBJECT',
    properties: {
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { ...CARD_PROPS, example: { type: 'STRING' }, level: { type: 'STRING' } },
          required: ['term', 'translation', 'transcription', 'example', 'level'],
        },
      },
    },
    required: ['items'],
  });
  return (data.items || []).slice(0, limit).map((c) => ({ ...cleanCard(c, ''), level: clip(c.level, 3) })).filter((c) => c.term && c.translation);
}

module.exports = { lookup, translateMany, extract, enabled, AiError };
