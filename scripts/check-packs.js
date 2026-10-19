// Перевіряє зміст паків: кількість, дублі, мову перекладу, наявність слова в прикладі, перетини паків «Основа».
//   node scripts/check-packs.js [id ...]
const fs = require('fs');
const path = require('path');
const plan = require('./pack-plan');
const { norm, findTermInSentence } = require('../public/text.js');

const DIR = path.join(__dirname, '..', 'packs');
const only = process.argv.slice(2);
const key = (t) => norm(t);
let problems = 0;
const coreTerms = new Map();

for (const meta of plan.filter((p) => !only.length || only.includes(p.id))) {
  const file = path.join(DIR, `${meta.id}.json`);
  if (!fs.existsSync(file)) { console.log(`✗ ${meta.id}: файлу немає`); problems++; continue; }
  const words = JSON.parse(fs.readFileSync(file, 'utf8')).words.map((w) => (Array.isArray(w) ? { term: w[0], translation: w[1], transcription: w[2], example: w[3] } : w));
  const issues = [];
  if (words.length !== meta.size) issues.push(`кількість ${words.length} замість ${meta.size}`);
  const seen = new Set();
  for (const w of words) {
    const tag = `«${w.term}»`;
    if (!w.term || !w.translation || !w.transcription || !w.example) { issues.push(`${tag}: порожнє поле`); continue; }
    if (seen.has(key(w.term))) issues.push(`${tag}: дубль`);
    seen.add(key(w.term));
    if (/[а-яіїєґ]/i.test(w.term)) issues.push(`${tag}: кирилиця в слові`);
    if (!/[а-яіїєґ]/i.test(w.translation)) issues.push(`${tag}: переклад не українською`);
    if (/[ыэъё]/i.test(w.translation)) issues.push(`${tag}: російські літери`);
    if (!/^\/.+\/$/.test(w.transcription)) issues.push(`${tag}: транскрипція без /…/`);
    if (!findTermInSentence(w.term, w.example)) issues.push(`${tag}: немає в прикладі «${w.example}»`);
    if (meta.id.startsWith('core-')) {
      if (coreTerms.has(key(w.term))) issues.push(`${tag}: вже є в ${coreTerms.get(key(w.term))}`);
      else coreTerms.set(key(w.term), meta.id);
    }
  }
  problems += issues.length;
  console.log(`${issues.length ? '✗' : '✓'} ${meta.id} (${words.length}/${meta.size})${issues.length ? '\n   ' + issues.join('\n   ') : ''}`);
}
console.log(problems ? `\nПроблем: ${problems}` : '\nУсе гаразд');
process.exitCode = problems ? 1 : 0;
