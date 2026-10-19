'use strict';

/* Pippo — робота з текстом: нормалізація, перевірка відповідей, пошук слова в реченні.
   Працює і в браузері (глобальні функції), і в Node (скрипти перевірки паків). */

function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFC')
    .replace(/[’‘`ʼ]/g, "'")
    .replace(/ё/g, 'е')
    .replace(/[.,!?;:"«»()[\]…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(to|the|a|an) /, ''); // «to run» == «run», «the apple» == «apple»
}

function variants(answer) {
  const whole = norm(answer);
  const parts = String(answer).split(/[,;/]| або /).map(norm).filter(Boolean);
  return [...new Set([whole, ...parts])];
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// 'exact' | 'typo' | 'wrong'
function checkAnswer(given, answer) {
  const g = norm(given);
  if (!g) return 'wrong';
  const vs = variants(answer);
  if (vs.includes(g)) return 'exact';
  const typo = vs.some((v) => {
    const allowed = v.length >= 9 ? 2 : v.length >= 4 ? 1 : 0;
    return allowed && levenshtein(g, v) <= allowed;
  });
  return typo ? 'typo' : 'wrong';
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Найуживаніші неправильні дієслова — щоб знаходити «left» для «to leave» у реченні
const IRREGULAR = Object.fromEntries(`be was were been is are am|become became|begin began begun|break broke broken|bring brought|build built|buy bought|catch caught|choose chose chosen|come came|cost|cut|do did done does|draw drew drawn|bite bit bitten|bleed bled|blow blew blown|deal dealt|dig dug|feed fed|forbid forbade forbidden|light lit|spread|swear swore sworn|sweep swept|drink drank drunk|drive drove driven|eat ate eaten|fall fell fallen|feel felt|fight fought|find found|fly flew flown|forget forgot forgotten|forgive forgave forgiven|freeze froze frozen|get got gotten|give gave given|go went gone goes|grow grew grown|hang hung|have had has|hear heard|hide hid hidden|hit|hold held|hurt|keep kept|know knew known|lay laid|lead led|leave left|lend lent|let|lie lay lain|lose lost|make made|mean meant|meet met|overcome overcame|undergo underwent undergone|undertake undertook undertaken|pay paid|put|quit|read|ride rode ridden|ring rang rung|rise rose risen|run ran|say said|see saw seen|seek sought|sell sold|send sent|set|shake shook shaken|shine shone|shoot shot|show showed shown|shut|sing sang sung|sink sank sunk|sit sat|sleep slept|speak spoke spoken|spend spent|stand stood|steal stole stolen|stick stuck|strike struck|swim swam swum|take took taken|teach taught|tear tore torn|tell told|think thought|throw threw thrown|understand understood|wake woke woken|wear wore worn|win won|write wrote written`
  .split('|').map((row) => { const forms = row.split(' '); return [forms[0], forms]; }));

// Шукає слово/фразу з картки в реченні з урахуванням форм: leave → left, give up → gave up, lose your temper → lost his temper.
// Повертає { start, end } або null.
function findTermInSentence(term, sentence) {
  if (!term || !sentence) return null;
  const words = term.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/^to\s+/, '').split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')).filter(Boolean)
    .filter((w, i, arr) => arr.length === 1 || !/^(sb|sth|smb|smth|someone|something)$/.test(w));
  // «to be into» ↔ «I'm into»: допоміжне be часто скорочене, тому шукаємо решту фрази
  if (words.length > 1 && words[0] === 'be') words.shift();
  if (!words.length) return null;
  const L = '[\\p{L}\\p{M}\'’-]';
  // Між словами — пробіли й розділові знаки; фразові дієслова можуть бути розірвані: «put the decision off»
  const sep = '[\\s,;:—–]+';
  const gap = `(?:${sep}${L}+){0,3}?${sep}`;
  // «lose your temper» ↔ «lost his temper», «meet a target» ↔ «meet our target»: заповнювачі збігаються з будь-яким означенням
  const POSSESSIVE = /^(your|one's|one’s|someone's|someone’s|somebody's|somebody’s|sb's|sb’s)$/;
  const anyPossessive = `(?:my|your|his|her|its|our|their|${L}+['’]s)`;
  const DETERMINER = /^(a|an|the)$/;
  const anyDeterminer = `(?:a|an|the|my|your|his|her|its|our|their|this|that|these|those)`;
  // Точна форма: неправильні дієслова, закінчення, подвоєна приголосна (stop → stopped, mop → mopping)
  const exact = (w) => DETERMINER.test(w) ? anyDeterminer : POSSESSIVE.test(w) ? anyPossessive : `(?:${(IRREGULAR[w] || [w]).map(escapeRe).join('|')})(?:${escapeRe(w.slice(-1))}?(?:s|es|ed|d|ing|er|'s|’s))?`;
  const strategies = [
    exact,
    (w) => (w.length >= 4 ? `${escapeRe(w.replace(/[ey]$/, ''))}${L}{0,4}` : exact(w)),
    (w) => (w.length >= 5 ? `${escapeRe(w.slice(0, -2))}${L}{0,4}` : exact(w)),
  ];
  for (const make of strategies) {
    const parts = words.map(make);
    const re = new RegExp(`(?<![\\p{L}\\p{M}])${parts.join(gap)}(?![\\p{L}\\p{M}])`, 'iu');
    const m = re.exec(sentence);
    if (m) return { start: m.index, end: m.index + m[0].length };
  }
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = { norm, variants, levenshtein, checkAnswer, findTermInSentence, IRREGULAR };
}
