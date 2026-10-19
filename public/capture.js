'use strict';

/* =========================================================
   Слово з речення → картка (Gemini). Використовує хелпери з app.js.
   ========================================================= */

function bookmarkletLink() {
  // Виділене слово + речення навколо нього → вікно Pippo
  const code = `(()=>{const s=getSelection();const w=String(s).trim().slice(0,100);let t='';`
    + `if(w&&s.anchorNode){const n=s.anchorNode.nodeType===3?s.anchorNode.parentElement:s.anchorNode;`
    + `t=((n&&n.closest('p,li,blockquote,td,dd,h1,h2,h3,h4'))||n||document.body).innerText||'';`
    + `const i=t.indexOf(w);if(i>=0){const a=Math.max(t.lastIndexOf('.',i-1),t.lastIndexOf('!',i-1),t.lastIndexOf('?',i-1),t.lastIndexOf(String.fromCharCode(10),i-1))+1;`
    + `let b=t.slice(i+w.length).search(/[.!?\\n]/);b=b<0?t.length:i+w.length+b+1;t=t.slice(a,b)}}`
    + `window.open('${location.origin}/#/dict?capture='+encodeURIComponent(JSON.stringify({w,t:t.trim().slice(0,1000)})),'pippo','width=780,height=860')})()`;
  return h('a', {
    class: 'btn btn-violet', href: `javascript:${code}`, title: 'Перетягни мене на панель закладок',
    onclick: (e) => { e.preventDefault(); toast('Перетягни цю кнопку на панель закладок 🔖'); },
  }, '➕ У Pippo');
}

function sentenceAround(text, start, end) {
  const before = text.slice(0, start);
  const a = Math.max(...['.', '!', '?', '…', '\n'].map((c) => before.lastIndexOf(c))) + 1;
  const rest = text.slice(end).search(/[.!?…\n]/);
  const b = rest < 0 ? text.length : end + rest + 1;
  return text.slice(a, b).trim();
}

// Вибір словника просто перед додаванням, з можливістю створити новий
function deckPicker(decks, initial) {
  const NEW = 'new';
  let current = initial;
  const label = (d) => `${d.name} (${d.langFrom.toUpperCase()} → ${d.langTo.toUpperCase()})`;
  const newOpt = h('option', { value: NEW }, '➕ Новий словник…');
  const name = h('input', { class: 'input', placeholder: 'Назва нового словника', maxlength: 60, hidden: true });
  const sel = h('select', {
    class: 'input',
    onchange: () => {
      name.hidden = sel.value !== NEW;
      if (sel.value === NEW) name.focus();
      else current = decks.find((d) => String(d.id) === sel.value);
    },
  }, decks.map((d) => h('option', { value: d.id, selected: d.id === initial.id }, label(d))), newOpt);

  return {
    el: h('label', { class: 'field deck-picker' }, h('span', null, 'Куди додати'), h('div', { class: 'deck-picker-row' }, sel, name)),
    get current() { return current; },
    async resolve() {
      if (sel.value !== NEW) return current;
      const n = name.value.trim();
      if (!n) { name.focus(); throw new Error('Введи назву нового словника'); }
      const { id } = await api('/decks', { method: 'POST', body: { name: n, langFrom: current.langFrom, langTo: current.langTo } });
      current = { id, name: n, langFrom: current.langFrom, langTo: current.langTo, total: 0, mastered: 0, due: 0, fresh: 0 };
      decks.push(current);
      sel.insertBefore(h('option', { value: id }, label(current)), newOpt);
      sel.value = String(id);
      name.value = '';
      name.hidden = true;
      return current;
    },
  };
}

async function captureModal(deck, decks, { text = '', word = '' } = {}) {
  if (state.ai == null) state.ai = await api('/ai/status').then((r) => r.gemini).catch(() => false);
  const picker = deckPicker(decks, deck);
  let tokens = [];
  let selRange = null;
  let selSentence = '';
  let seq = 0;
  let added = 0;

  const area = h('textarea', { class: 'input capture-text', rows: 3, placeholder: 'Встав речення або абзац, де трапилось слово…', oninput: debounce(renderTokens, 200) });
  area.value = text;
  const tokensBox = h('div', { class: 'tokens' });
  const manual = h('input', {
    class: 'input', placeholder: 'або введи слово чи фразу', maxlength: 100, value: word,
    oninput: () => { if (selRange) { selRange = null; highlight(); } },
  });
  const analyzeBtn = h('button', { class: 'btn btn-primary' }, 'Розібрати');
  const result = h('div', { class: 'capture-result' });

  const body = h('div', { class: 'grid', style: { gap: '12px' } },
    area,
    tokensBox,
    h('form', { class: 'capture-manual', onsubmit: (e) => { e.preventDefault(); analyze(); } }, manual, analyzeBtn),
    state.ai ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: extractAll }, '🔎 Знайти в тексті всі слова, які варто вивчити') : null,
    state.ai ? null : h('p', { class: 'muted small' }, 'Gemini не налаштовано — переклад буде простим, без урахування контексту.'),
    result);

  modal('✨ Слово з речення', body, [], {
    wide: true,
    onClose: () => { if (added && location.hash.startsWith('#/dict')) render(); },
  });

  function renderTokens() {
    const txt = area.value.slice(0, 3000);
    tokens = [];
    selRange = null;
    const out = [];
    let last = 0;
    for (const m of txt.matchAll(/[\p{L}\p{M}][\p{L}\p{M}\p{N}'’-]*/gu)) {
      if (m.index > last) out.push(txt.slice(last, m.index));
      const i = tokens.length;
      const el = h('button', { type: 'button', class: 'tok', onclick: (e) => pickToken(i, e.shiftKey) }, m[0]);
      tokens.push({ start: m.index, end: m.index + m[0].length, el });
      out.push(el);
      last = m.index + m[0].length;
    }
    out.push(txt.slice(last));
    tokensBox.replaceChildren(h('div', { class: 'muted small tokens-hint' }, 'Натисни на слово, потім «Розібрати». Shift + клік — виділити фразу (напр. «give up»).'), ...out);
    tokensBox.hidden = !tokens.length;
  }

  function highlight() {
    tokens.forEach((t, i) => t.el.classList.toggle('sel', !!selRange && i >= selRange[0] && i <= selRange[1]));
  }

  function selectRange(a, b) {
    selRange = [a, b];
    highlight();
    const txt = area.value;
    const start = tokens[a].start;
    const end = tokens[b].end;
    manual.value = txt.slice(start, end);
    selSentence = sentenceAround(txt, start, end);
    // Лише виділяємо: розбір коштує ліміт ШІ, а клік міг бути випадковим
    analyzeBtn.focus();
  }

  function analyze() {
    const phrase = manual.value.trim();
    if (!phrase) { manual.focus(); return; }
    lookup(phrase, selRange ? selSentence : findSentence(phrase));
  }

  function pickToken(i, extend) {
    if (extend && selRange) selectRange(Math.min(selRange[0], i), Math.max(selRange[1], i));
    else selectRange(i, i);
  }

  function findSentence(phrase) {
    const txt = area.value;
    const i = txt.toLowerCase().indexOf(phrase.toLowerCase());
    return i >= 0 ? sentenceAround(txt, i, i + phrase.length) : txt.trim().slice(0, 1000);
  }

  const thinking = (label) => h('div', { class: 'thinking' }, svg(pippoSvg('think')), h('b', null, label));
  const failure = (message) => h('div', { class: 'feedback bad' }, svg(pippoSvg('sad')), h('div', { class: 'grow' }, h('b', null, 'Не вийшло'), h('span', null, message)));

  async function lookup(phrase, sentence) {
    const my = ++seq;
    const checked = picker.current;
    result.replaceChildren(thinking(`Pippo розбирає «${phrase}»…`));
    try {
      const { card, exists } = await api('/ai/lookup', { method: 'POST', body: { deckId: checked.id, word: phrase, sentence } });
      if (my === seq) result.replaceChildren(cardEditor(card, exists && checked));
    } catch (e) {
      if (my === seq) result.replaceChildren(failure(e.message));
    }
  }

  // existsIn — словник, у якому слово вже є (або false)
  function cardEditor(card, existsIn) {
    const exists = Boolean(existsIn);
    const term = h('input', { class: 'input', value: card.term, maxlength: 200 });
    const tr = h('input', { class: 'input', value: card.translation, maxlength: 200 });
    const tx = h('input', { class: 'input', value: card.transcription, maxlength: 100 });
    const ex = h('textarea', { class: 'input example-input', rows: 2, maxlength: 500 });
    ex.value = card.example;
    const addBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, exists ? 'Все одно додати' : '+ Додати в словник');

    return h('form', {
      class: 'ai-card',
      onsubmit: async (e) => {
        e.preventDefault();
        addBtn.disabled = true;
        try {
          const target = await picker.resolve();
          await api('/words', { method: 'POST', body: { deckId: target.id, term: term.value, translation: tr.value, transcription: tx.value, example: ex.value } });
          added++;
          toast(`«${term.value.trim()}» додано в «${target.name}» 👍`, 'good');
          if (selRange) tokens.slice(selRange[0], selRange[1] + 1).forEach((t) => t.el.classList.add('added'));
          selRange = null;
          highlight();
          result.replaceChildren(h('p', { class: 'muted small' }, 'Готово! Вибери інше слово й натисни «Розібрати», якщо хочеш додати ще.'));
        } catch (err) {
          toast(err.message, 'error');
          addBtn.disabled = false;
        }
      },
    },
    h('div', { class: 'ai-head' },
      h('div', { class: 'ai-term' }, card.term, speakBtn(card.term, picker.current.langFrom)),
      h('span', { class: 'badge' }, card.source === 'gemini' ? '✨ Gemini' : 'MyMemory'),
      card.partOfSpeech ? h('span', { class: 'muted small' }, card.partOfSpeech) : null),
    card.explanation ? h('p', { class: 'muted' }, card.explanation) : null,
    exists ? h('p', { class: 'warn' }, `⚠️ Це слово вже є в словнику «${existsIn.name}»`) : null,
    h('div', { class: 'ai-fields' },
      h('label', { class: 'field' }, h('span', null, 'Слово'), term),
      h('label', { class: 'field' }, h('span', null, 'Транскрипція'), tx)),
    h('label', { class: 'field' }, h('span', null, 'Переклад у цьому реченні'), tr),
    card.otherMeanings.length ? h('div', { class: 'field' }, h('span', null, 'Інші значення — натисни, щоб додати до перекладу'),
      h('div', { class: 'chips' }, card.otherMeanings.map((m) => h('button', {
        type: 'button', class: 'chip', onclick: (e) => {
          const parts = tr.value.split(',').map((x) => x.trim()).filter(Boolean);
          if (!parts.includes(m)) tr.value = [...parts, m].join(', ');
          e.currentTarget.classList.add('active');
        },
      }, m)))) : null,
    h('label', { class: 'field' }, h('span', null, 'Приклад'), ex),
    picker.el,
    h('div', { class: 'modal-actions' }, addBtn));
  }

  async function extractAll() {
    const txt = area.value.trim();
    if (txt.length < 3) { area.focus(); return toast('Спершу встав текст', 'error'); }
    const my = ++seq;
    result.replaceChildren(thinking('Pippo читає текст і шукає цікаві слова…'));
    let items;
    try {
      ({ items } = await api('/ai/extract', { method: 'POST', body: { deckId: picker.current.id, text: txt } }));
    } catch (e) {
      if (my === seq) result.replaceChildren(failure(e.message));
      return;
    }
    if (my !== seq) return;
    if (!items.length) return result.replaceChildren(h('p', { class: 'muted' }, 'Нічого цікавого не знайшлося 🤷'));

    result.replaceChildren(reviewList(items, () => picker.resolve(), (n) => { added += n; }, picker.el));
  }

  renderTokens();
  const wanted = word.trim();
  if (wanted) {
    const i = area.value.toLowerCase().indexOf(wanted.toLowerCase());
    const a = i >= 0 ? tokens.findIndex((t) => t.end > i) : -1;
    const b = i >= 0 ? tokens.findIndex((t) => t.end >= i + wanted.length) : -1;
    // Слово прийшло із закладки чи розширення — його вибрали свідомо, тож розбираємо одразу
    if (a >= 0 && b >= a) selectRange(a, b);
    analyze();
  } else {
    setTimeout(() => (text ? manual : area).focus(), 50);
  }
}

/* =========================================================
   Спільний список карток для перегляду перед додаванням
   (слова з тексту та «кілька слів одразу»)
   ========================================================= */

function reviewList(items, getDeck, onAdded, deckEl = null) {
  const rows = items.map((it) => {
    const check = h('input', { type: 'checkbox', 'aria-label': `Додати ${it.term}` });
    check.checked = !it.exists && Boolean(it.translation);
    const term = h('input', { class: 'input input-sm term-input', value: it.term, maxlength: 200, 'aria-label': 'Слово' });
    const tr = h('input', { class: 'input input-sm', value: it.translation, maxlength: 200, placeholder: 'Переклад', 'aria-label': 'Переклад' });
    tr.addEventListener('input', () => { if (tr.value.trim()) check.checked = true; });
    const fixed = it.input && norm(it.input) !== norm(it.term);
    const el = h('div', { class: `extract-item${it.exists ? ' known' : ''}` },
      h('label', { class: 'extract-check' }, check),
      h('div', { class: 'grid', style: { gap: '4px' } },
        h('div', { class: 'review-head' }, term, h('span', { class: 'tx' }, it.transcription),
          it.level ? h('span', { class: 'badge' }, it.level) : null,
          it.exists ? h('span', { class: 'muted small' }, 'вже є') : null,
          fixed ? h('span', { class: 'muted small' }, `✏️ було «${it.input}»`) : null),
        tr,
        it.otherMeanings && it.otherMeanings.length ? h('div', { class: 'chips' }, it.otherMeanings.map((m) => h('button', {
          type: 'button', class: 'chip chip-sm', title: 'Додати до перекладу',
          onclick: (e) => {
            const parts = tr.value.split(',').map((x) => x.trim()).filter(Boolean);
            if (!parts.includes(m)) tr.value = [...parts, m].join(', ');
            e.currentTarget.classList.add('active');
            check.checked = true;
          },
        }, `+ ${m}`))) : null,
        it.example ? h('span', { class: 'ex' }, it.example) : null,
        it.source === 'none' ? h('span', { class: 'warn small' }, 'Перекласти не вдалося — впиши переклад сам') : null));
    return { it, check, term, tr, el };
  });

  const addBtn = h('button', { class: 'btn btn-primary', onclick: addSelected }, '+ Додати вибрані');
  const toggle = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
    const open = rows.filter((r) => !r.el.classList.contains('added'));
    const all = open.every((r) => r.check.checked);
    open.forEach((r) => { r.check.checked = !all; });
  } }, 'Вибрати всі / жодного');

  async function addSelected() {
    const chosen = rows.filter((r) => r.check.checked && !r.el.classList.contains('added'));
    if (!chosen.length) return toast('Вибери хоча б одне слово', 'error');
    const empty = chosen.find((r) => !r.tr.value.trim() || !r.term.value.trim());
    if (empty) { empty.tr.focus(); return toast('У вибраного слова немає перекладу', 'error'); }
    addBtn.disabled = true;
    let deck;
    try { deck = await getDeck(); } catch (e) { addBtn.disabled = false; return toast(e.message, 'error'); }
    let ok = 0;
    for (const r of chosen) {
      try {
        await api('/words', { method: 'POST', body: { deckId: deck.id, term: r.term.value, translation: r.tr.value, transcription: r.it.transcription, example: r.it.example } });
        ok++;
        r.check.checked = false;
        r.check.disabled = true;
        r.el.classList.add('known', 'added');
      } catch { /* дублікат — пропускаємо */ }
    }
    onAdded(ok);
    addBtn.disabled = false;
    toast(`Додано ${wordsN(ok)} в «${deck.name}»${ok < chosen.length ? `, пропущено ${chosen.length - ok}` : ''}`, ok ? 'good' : 'error');
  }

  return h('div', { class: 'grid', style: { gap: '10px' } },
    h('div', { class: 'extract' }, rows.map((r) => r.el)),
    deckEl,
    h('div', { class: 'modal-actions' }, toggle, addBtn));
}

/* ---------- кілька слів одразу ---------- */

function batchModal(deck, decks) {
  let current = deck;
  let added = 0;
  let seq = 0;
  const deckSel = h('select', { class: 'input', onchange: () => { current = decks.find((d) => String(d.id) === deckSel.value); } },
    decks.map((d) => h('option', { value: d.id, selected: d.id === deck.id }, `${d.name} (${d.langFrom.toUpperCase()} → ${d.langTo.toUpperCase()})`)));
  const area = h('textarea', { class: 'input capture-text', rows: 5, placeholder: 'apple\nto borrow\nweather, journey, cheerful' });
  const result = h('div', { class: 'capture-result' });
  const count = h('span', { class: 'muted small' });

  const parse = () => [...new Map(area.value.split(/[\n,;]+/).map((w) => w.trim()).filter(Boolean).map((w) => [w.toLowerCase(), w])).values()];
  area.addEventListener('input', () => {
    const n = parse().length;
    count.textContent = n ? `${wordsN(Math.min(n, 30))}${n > 30 ? ' (максимум 30 за раз)' : ''}` : '';
  });

  async function run() {
    const words = parse().slice(0, 30);
    if (!words.length) { area.focus(); return toast('Введи хоча б одне слово', 'error'); }
    const my = ++seq;
    result.replaceChildren(h('div', { class: 'thinking' }, svg(pippoSvg('think')), h('b', null, `Pippo перекладає ${wordsN(words.length)}…`)));
    try {
      const { items } = await api('/ai/batch', { method: 'POST', body: { deckId: current.id, words } });
      if (my === seq) result.replaceChildren(reviewList(items, () => current, (n) => { added += n; }));
    } catch (e) {
      if (my === seq) result.replaceChildren(h('div', { class: 'feedback bad' }, svg(pippoSvg('sad')), h('div', { class: 'grow' }, h('b', null, 'Не вийшло'), h('span', null, e.message))));
    }
  }

  modal('📝 Кілька слів одразу', h('div', { class: 'grid', style: { gap: '12px' } },
    decks.length > 1 ? h('label', { class: 'field' }, h('span', null, 'Словник'), deckSel) : null,
    h('label', { class: 'field' }, h('span', null, 'Слова — кожне з нового рядка або через кому (до 30)'), area),
    h('div', { class: 'start-bar' }, h('button', { class: 'btn btn-violet', type: 'button', onclick: run }, '✨ Перекласти'), count),
    h('p', { class: 'muted small' }, 'Pippo підбере переклад, транскрипцію й приклад і виправить описки. Усе можна змінити перед додаванням.'),
    result), [], {
    wide: true,
    onClose: () => { if (added && location.hash.startsWith('#/dict')) render(); },
  });
  setTimeout(() => area.focus(), 50);
}

/* ---------- автопереклад у формі додавання слова ---------- */

// Коли поле перекладу порожнє, Pippo сам пропонує переклад (а також приклад і транскрипцію).
// Те, що користувач уже ввів, ніколи не перезаписується.
function autoTranslate({ term, translation, example = null, getDeckId, hint }) {
  let seq = 0;
  let filled = null; // { term, translation, example, transcription }

  const clearHint = () => hint.replaceChildren();

  function forget() {
    if (!filled) return;
    if (translation.value === filled.translation) translation.value = '';
    if (example && example.value === filled.example) example.value = '';
    filled = null;
    clearHint();
  }

  const addMeaning = (m) => (e) => {
    const parts = translation.value.split(',').map((x) => x.trim()).filter(Boolean);
    if (!parts.includes(m)) translation.value = [...parts, m].join(', ');
    e.currentTarget.classList.add('active');
    translation.focus();
  };

  let pending = null; // щоб blur і Enter не робили два однакові запити
  function suggest() {
    const word = term.value.trim();
    if (!word || translation.value.trim()) return Promise.resolve(false);
    if (pending && pending.word === word && pending.seq === seq) return pending.promise;
    const promise = request(word, ++seq);
    pending = { word, seq, promise };
    return promise;
  }

  async function request(word, my) {
    hint.replaceChildren(h('span', { class: 'muted' }, '✨ Pippo шукає переклад…'));
    try {
      const { card } = await api('/ai/lookup', { method: 'POST', body: { deckId: getDeckId(), word, sentence: '' } });
      if (my !== seq || term.value.trim() !== word || translation.value.trim()) return false;
      translation.value = card.translation;
      if (example && !example.value.trim()) example.value = card.example || '';
      filled = { term: word, translation: card.translation, example: example ? example.value : '', transcription: card.transcription };
      const corrected = norm(card.term) !== norm(word) ? card.term : null;
      hint.replaceChildren(
        h('span', null, card.source === 'gemini' ? '✨ Переклад від Pippo' : '🌐 Простий переклад', card.transcription ? ` · ${card.transcription}` : ''),
        corrected ? h('button', {
          type: 'button', class: 'chip chip-sm', title: 'Pippo вважає, що тут описка',
          onclick: (e) => { term.value = corrected; filled.term = corrected; e.currentTarget.remove(); translation.focus(); },
        }, `✏️ Мабуть, «${corrected}»?`) : null,
        card.otherMeanings.length ? h('span', { class: 'muted' }, 'ще:') : null,
        ...card.otherMeanings.map((m) => h('button', { type: 'button', class: 'chip chip-sm', title: 'Додати до перекладу', onclick: addMeaning(m) }, `+ ${m}`)),
        h('span', { class: 'muted' }, '· Enter — додати'));
      translation.focus();
      translation.select();
      return true;
    } catch (e) {
      if (my === seq) hint.replaceChildren(h('span', { class: 'warn' }, `Не вдалося перекласти: ${e.message}`));
      return false;
    }
  }

  term.addEventListener('blur', () => { if (term.value.trim() && !translation.value.trim()) suggest(); });
  term.addEventListener('input', () => { seq++; if (filled && term.value.trim() !== filled.term) forget(); });

  return {
    suggest,
    transcription: () => (filled && term.value.trim() === filled.term ? filled.transcription : ''),
    reset: () => { seq++; filled = null; clearHint(); },
  };
}
