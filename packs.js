// Каталог паків слів: план (scripts/pack-plan.js) + згенерований зміст (packs/<id>.json).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const plan = require('./scripts/pack-plan');

const DIR = path.join(__dirname, 'packs');
const PER_WORD = { A1: 1.6, A2: 1.8, B1: 2.2, B2: 2.6, C1: 3 };
// Чим більший пак, тим дешевше слово (плавно, щоб більший пак ніколи не коштував менше)
const sizeFactor = (n) => Math.max(0.7, 1 - Math.max(0, n - 20) * 0.0022);
const DEAL_DISCOUNT = 0.3;
const FIRST_FREE_MAX_SIZE = 50;

const roundTo5 = (n) => Math.max(5, Math.ceil(n / 5) * 5);
const termKey = (t) => t.toLowerCase().trim().replace(/^to\s+/, '');

let catalog = [];

function load() {
  catalog = plan
    .map((meta) => {
      const file = path.join(DIR, `${meta.id}.json`);
      if (!fs.existsSync(file)) return null;
      // Слова зберігаються або об'єктами, або компактно: [term, translation, transcription, example]
      const words = JSON.parse(fs.readFileSync(file, 'utf8')).words.map((w) =>
        Array.isArray(w) ? { term: w[0], translation: w[1], transcription: w[2], example: w[3] } : w);
      if (!Array.isArray(words) || words.length < 10) return null;
      const basePrice = roundTo5(words.length * PER_WORD[meta.level] * sizeFactor(words.length));
      return { ...meta, words, count: words.length, basePrice };
    })
    .filter(Boolean);
  return catalog;
}

const all = () => catalog;
const get = (id) => catalog.find((p) => p.id === id);

// Пак дня — однаковий для всіх у межах дня
function dealId(day) {
  if (!catalog.length) return null;
  const n = crypto.createHash('sha1').update(`deal:${day}`).digest().readUInt32BE(0);
  return catalog[n % catalog.length].id;
}

// Ціна для конкретного користувача: пак дня, уже відомі слова, перший пак у подарунок
function quote(pack, { known, day, firstFree }) {
  const fresh = pack.words.filter((w) => !known.has(termKey(w.term)));
  const isDeal = dealId(day) === pack.id;
  let price = pack.basePrice * (isDeal ? 1 - DEAL_DISCOUNT : 1);
  if (fresh.length < pack.count) price *= fresh.length / pack.count;
  price = fresh.length ? roundTo5(price) : 0;
  const free = firstFree && pack.count <= FIRST_FREE_MAX_SIZE && fresh.length > 0;
  return { price: free ? 0 : price, fresh, knownCount: pack.count - fresh.length, isDeal, free };
}

load();

module.exports = { load, all, get, quote, dealId, termKey, DEAL_DISCOUNT, FIRST_FREE_MAX_SIZE };
