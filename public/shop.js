'use strict';

/* =========================================================
   Магазин паків слів і зернятка 🌾. Використовує хелпери з app.js.
   ========================================================= */

const PACK_TYPES = {
  topic: ['🧭', 'Теми'],
  profession: ['💼', 'Професії'],
  situation: ['🎯', 'Ситуації'],
  language: ['🧩', 'Мовні явища'],
  level: ['📈', 'Рівні'],
  course: ['📘', 'Підручники'],
  screen: ['🎬', 'Серіали й фільми'],
};

const KIND_LABELS = {
  start: '🎁 Подарунок на старт',
  review: '🔁 Повторення',
  new: '🌱 Нове слово',
  master: '🏆 Слово вивчено',
  goal: '🎯 Денна ціль',
  streak: '🔥 Серія',
  'pack-done': '📦 Пак вивчено',
  purchase: '🛍️ Покупка',
};

const packIcon = (id, cls = 'pack-icon') => h('img', { class: cls, src: `/packs/${id}.svg`, alt: '', loading: 'lazy', width: 64, height: 64 });
const grainsText = (n) => `${n} 🌾`;

function progressBar(value, max, cls = '') {
  return h('div', { class: `meter ${cls}` }, h('i', { style: { width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` } }));
}

/* ---------- модалка «Зернятка» ---------- */

async function grainsModal() {
  let data;
  try { data = await api('/grains'); } catch (e) { return toast(e.message, 'error'); }
  const { today, rewards, history } = data;
  const fmt = (ts) => new Date(ts).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const m = modal('🌾 Зернятка', h('div', { class: 'grid', style: { gap: '16px' } },
    h('div', { class: 'grains-balance' }, h('b', null, data.balance), h('span', { class: 'muted' }, 'зерняток на рахунку')),
    h('div', { class: 'grid', style: { gap: '10px' } },
      h('div', null, h('div', { class: 'meter-label' }, h('span', null, 'Сьогодні за навчання'), h('b', null, `${today.learned} / ${today.learnCap}`)), progressBar(today.learned, today.learnCap)),
      h('div', null, h('div', { class: 'meter-label' }, h('span', null, 'Нові слова, що платять'), h('b', null, `${today.newWords} / ${today.newCap}`)), progressBar(today.newWords, today.newCap, 'meter-green')),
      h('div', { class: 'meter-label' }, h('span', null, 'Денна ціль'), h('b', null, today.goalDone ? '✓ +10 🌾' : `ще не виконана (+${rewards.goal} 🌾)`))),
    h('details', { class: 'how' },
      h('summary', null, 'Як заробити зернятка'),
      h('ul', null,
        h('li', null, `+${rewards.review} 🌾 — правильно повторене слово, якого настав час (у картках +${rewards.reviewFlash})`),
        h('li', null, `+${rewards.newWord} 🌾 — перша правильна відповідь на нове слово`),
        h('li', null, `+${rewards.master} 🌾 — слово дійшло до останньої полички`),
        h('li', null, `+${rewards.goal} 🌾 — виконана денна ціль`),
        h('li', null, `+${rewards.streak[7]} / ${rewards.streak[30]} / ${rewards.streak[100]} 🌾 — серія 7 / 30 / 100 днів`),
        h('li', null, `${Math.round(rewards.packDoneShare * 100)}% ціни назад — коли пак вивчено повністю`)),
      h('p', { class: 'muted small' }, `За навчання можна отримати до ${today.learnCap} 🌾 на день. Тренуватися більше корисно, але зернятка прийдуть завтра — так Pippo заохочує вчитися щодня, а не за один вечір.`)),
    h('div', null,
      h('h3', null, 'Історія'),
      history.length
        ? h('div', { class: 'ledger' }, history.map((r) => h('div', { class: 'ledger-row' },
          h('span', { class: `amt ${r.amount < 0 ? 'neg' : ''}` }, r.amount > 0 ? `+${r.amount}` : r.amount),
          h('span', { class: 'what' }, KIND_LABELS[r.kind] || r.kind, r.note ? h('span', { class: 'muted' }, ` · ${r.note}`) : null),
          h('span', { class: 'muted small when' }, fmt(r.createdAt)))))
        : h('p', { class: 'muted' }, 'Поки порожньо'))),
  [h('a', { class: 'btn btn-primary', href: '#/shop', onclick: () => m.close() }, '🛍️ До паків')]);
}

/* ---------- магазин ---------- */

async function viewShop(main, params, alive) {
  const shop = await api('/shop');
  if (!alive()) return;
  setUser({ ...state.user, grains: shop.balance });

  const saved = store.get('shop', {});
  const f = { type: saved.type || 'all', level: saved.level || 'all', size: saved.size || 'all', hideOwned: !!saved.hideOwned, q: '', series: params.get('series') || null, season: null };
  const deal = shop.packs.find((p) => p.id === shop.dealId);

  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, 'Паки слів'), h('p', { class: 'muted' }, `${shop.packs.length} готових наборів із перекладом, транскрипцією та прикладами`)),
    h('button', { class: 'card grains-card', onclick: grainsModal },
      h('div', { class: 'grains-card-top' }, h('b', null, grainsText(shop.balance)), h('span', { class: 'muted small' }, 'що це?')),
      h('div', { class: 'meter-label small' }, h('span', { class: 'muted' }, 'сьогодні за навчання'), h('span', null, `${shop.today.learned}/${shop.today.learnCap}`)),
      progressBar(shop.today.learned, shop.today.learnCap)));

  const gift = shop.firstFree
    ? h('div', { class: 'gift-banner' }, h('span', { class: 'gift-emoji' }, '🎁'),
      h('div', null, h('b', null, 'Перший пак — у подарунок!'), h('p', { class: 'muted small' }, `Вибери будь-який пак до ${shop.firstFreeMaxSize} слів — він безкоштовний.`)))
    : null;

  const dealCard = deal && !deal.owned ? h('button', { class: 'card deal', onclick: () => packModal(deal, shop) },
    packIcon(deal.id, 'pack-icon pack-icon-lg'),
    h('div', { class: 'deal-body' },
      h('span', { class: 'deal-tag' }, `Пак дня · −${Math.round(shop.dealDiscount * 100)}%`),
      h('h2', null, deal.title),
      h('p', { class: 'muted' }, deal.description),
      h('div', { class: 'pack-meta' }, h('span', { class: 'badge' }, deal.level), h('span', { class: 'muted small' }, wordsN(deal.count)))),
    priceTag(deal)) : null;

  const search = h('input', { class: 'input search', type: 'search', placeholder: '🔎 Пошук пака…', oninput: debounce(() => { f.q = search.value; draw(); }, 120) });
  const filters = h('div', { class: 'shop-filters' });
  const grid = h('div', { class: 'pack-grid' });

  function saveFilters() { store.set('shop', { type: f.type, level: f.level, size: f.size, hideOwned: f.hideOwned }); }

  function draw() {
    const chip = (active, label, onclick) => h('button', { class: `chip${active ? ' active' : ''}`, onclick }, label);
    const set = (patch) => () => { Object.assign(f, patch); saveFilters(); draw(); };
    filters.replaceChildren(
      h('div', { class: 'chips' },
        chip(f.type === 'all', 'Усі', set({ type: 'all' })),
        Object.entries(PACK_TYPES).map(([key, [icon, label]]) => chip(f.type === key, `${icon} ${label}`, set({ type: key })))),
      h('div', { class: 'chips' },
        ['all', 'A1', 'A2', 'B1', 'B2', 'C1'].map((lv) => chip(f.level === lv, lv === 'all' ? 'Будь-який рівень' : lv, set({ level: lv }))),
        h('span', { class: 'chip-sep' }),
        ['all', 20, 50, 100].map((n) => chip(String(f.size) === String(n), n === 'all' ? 'Будь-який розмір' : `${n} слів`, set({ size: n }))),
        h('span', { class: 'chip-sep' }),
        chip(f.hideOwned, f.hideOwned ? '✓ Без моїх' : 'Сховати мої', set({ hideOwned: !f.hideOwned }))));

    const q = norm(f.q);
    const shown = shop.packs.filter((p) =>
      (f.type === 'all' || p.type === f.type || (f.series && p.series === f.series))
      && (f.level === 'all' || p.level === f.level)
      && (f.size === 'all' || p.size === Number(f.size) || (f.series && p.series === f.series))
      && (!f.hideOwned || !p.owned)
      && (!q || norm(`${p.title} ${p.description}`).includes(q)));

    // Серіал відкрито — сезони й серії; інакше серії згортаються в картку серіалу (крім пошуку)
    const cards = f.series ? seriesView(shown.filter((p) => p.series === f.series))
      : q ? shown.map(packCard)
        : groupSeries(shown).map((x) => (x.series ? seriesCard(x) : packCard(x)));
    grid.replaceChildren(...(cards.length ? cards : [h('div', { class: 'empty' }, svg(pippoSvg('think')), h('p', { class: 'muted' }, 'Таких паків немає'))]));
  }

  function groupSeries(list) {
    const out = [];
    const bySeries = new Map();
    for (const p of list) {
      if (!p.series) { out.push(p); continue; }
      if (!bySeries.has(p.series)) {
        const group = { series: p.series, title: p.seriesTitle, packs: [] };
        bySeries.set(p.series, group);
        out.push(group);
      }
      bySeries.get(p.series).packs.push(p);
    }
    return out;
  }

  const seasonsOf = (list) => [...new Set(list.map((p) => p.season))].sort((a, b) => a - b);
  const openSeries = (id) => () => { f.series = id; f.season = null; draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  function seriesCover(g, cls) {
    return h('img', { class: cls, src: `/series/${g.series}.jpg`, alt: '', loading: 'lazy', onerror: (e) => { e.currentTarget.onerror = null; e.currentTarget.src = `/packs/${g.packs[0].id}.svg`; } });
  }

  function seriesCard(g) {
    const all = shop.packs.filter((p) => p.series === g.series);
    const seasons = seasonsOf(all).filter(Boolean);
    const owned = all.filter((p) => p.owned).length;
    const words = all.reduce((n, p) => n + p.count, 0);
    const prices = g.packs.filter((p) => !p.owned && p.price).map((p) => p.price);
    return h('button', { class: `pack-card series-card${owned === all.length ? ' owned' : ''}`, onclick: openSeries(g.series) },
      seriesCover(g, 'series-cover'),
      h('b', { class: 'pack-title' }, g.title),
      h('div', { class: 'pack-meta' },
        h('span', { class: 'badge' }, '🎬'),
        h('span', { class: 'muted small' }, seasons.length
          ? `${plural(seasons.length, 'сезон', 'сезони', 'сезонів')} · ${plural(all.length, 'серія', 'серії', 'серій')} · ${wordsN(words)}`
          : wordsN(words))),
      owned
        ? h('div', { class: 'pack-owned' }, h('div', { class: 'meter-label small' }, h('span', null, 'Куплено серій'), h('span', { class: 'muted' }, `${owned}/${all.length}`)), progressBar(owned, all.length, 'meter-green'))
        : prices.length ? h('div', { class: 'price' }, h('span', { class: 'muted small' }, 'серія від'), h('b', null, grainsText(Math.min(...prices)))) : null);
  }

  function seriesView(list) {
    const all = shop.packs.filter((p) => p.series === f.series);
    if (!all.length) { f.series = null; return groupSeries(list).map((x) => (x.series ? seriesCard(x) : packCard(x))); }
    const g = { series: f.series, title: all[0].seriesTitle, packs: all };
    const seasons = seasonsOf(all).filter(Boolean);
    const chip = (active, label, onclick) => h('button', { class: `chip${active ? ' active' : ''}`, onclick }, label);
    const owned = all.filter((p) => p.owned).length;
    const head = h('div', { class: 'card series-head' },
      seriesCover(g, 'series-cover series-cover-lg'),
      h('div', { class: 'series-head-body' },
        h('button', { class: 'btn btn-ghost small', onclick: () => { f.series = null; draw(); } }, '← Усі паки'),
        h('h2', null, g.title),
        h('p', { class: 'muted small' }, `${seasons.length ? `${plural(seasons.length, 'сезон', 'сезони', 'сезонів')} · ` : ''}${plural(all.length, 'пак', 'паки', 'паків')} · куплено ${owned}. Кожна серія — окремий словник із реченнями з самої серії.`),
        seasons.length > 1 ? h('div', { class: 'chips' },
          chip(f.season === null, 'Усі сезони', () => { f.season = null; draw(); }),
          seasons.map((n) => chip(f.season === n, `Сезон ${n}`, () => { f.season = n; draw(); }))) : null));
    const eps = list.filter((p) => f.season === null || p.season === f.season)
      .sort((a, b) => a.season - b.season || a.episode - b.episode);
    const blocks = [head];
    for (const n of f.season === null ? seasonsOf(eps) : [f.season]) {
      const inSeason = eps.filter((p) => p.season === n);
      if (!inSeason.length) continue;
      if (n) blocks.push(h('h3', { class: 'series-season' }, `Сезон ${n}`, h('span', { class: 'muted small' }, ` · ${plural(inSeason.length, 'серія', 'серії', 'серій')}`)));
      blocks.push(...inSeason.map(packCard));
    }
    return blocks;
  }

  function packCard(p) {
    return h('button', { class: `pack-card${p.owned ? ' owned' : ''}`, onclick: () => packModal(p, shop) },
      h('div', { class: 'pack-card-top' }, packIcon(p.id), p.isDeal && !p.owned ? h('span', { class: 'deal-dot' }, '−30%') : null),
      h('b', { class: 'pack-title' }, p.title),
      h('div', { class: 'pack-meta' }, h('span', { class: 'badge' }, p.level), h('span', { class: 'muted small' }, `${wordsN(p.count)} · ${PACK_TYPES[p.type][1].toLowerCase()}`)),
      h('p', { class: 'pack-desc muted small' }, p.description),
      p.owned
        ? h('div', { class: 'pack-owned' }, h('div', { class: 'meter-label small' }, h('span', null, p.owned.deckId ? '✓ У словниках' : 'Словник видалено'), h('span', { class: 'muted' }, `${p.owned.mastered}/${p.owned.total}`)), progressBar(p.owned.mastered, p.owned.total, 'meter-green'))
        : priceTag(p));
  }

  main.append(head, gift, dealCard, h('div', { class: 'card shop-panel' }, h('div', { class: 'toolbar' }, search), filters), grid);
  draw();
  if (params.get('pack')) {
    const p = shop.packs.find((x) => x.id === params.get('pack'));
    if (p) packModal(p, shop);
  }
}

function priceTag(p) {
  if (p.free) return h('div', { class: 'price' }, h('b', { class: 'free' }, '🎁 Безкоштовно'));
  if (!p.price) return h('div', { class: 'price' }, h('span', { class: 'muted small' }, 'усі слова вже знаєш'));
  const discounted = p.price < p.basePrice;
  return h('div', { class: 'price' },
    discounted ? h('s', { class: 'muted small' }, p.basePrice) : null,
    h('b', null, grainsText(p.price)));
}

function packModal(p, shop) {
  const balance = state.user.grains;
  const owned = p.owned;
  let action;

  const buy = async (btn) => {
    btn.disabled = true;
    try {
      const res = await api(`/shop/${p.id}/buy`, { method: 'POST', body: {} });
      setUser(res.user);
      m.close();
      confetti();
      toast(res.restored ? `Пак «${p.title}» відновлено 📦` : `Пак «${p.title}» твій! Додано ${wordsN(res.added)} 🎉`, 'good');
      go(`#/dict?deck=${res.deckId}`);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
    }
  };

  if (owned && owned.deckId) {
    action = [
      h('a', { class: 'btn', href: `#/dict?deck=${owned.deckId}`, onclick: () => m.close() }, '📖 Відкрити словник'),
      h('a', { class: 'btn btn-primary', href: `#/train?deck=${owned.deckId}`, onclick: () => m.close() }, '▶ Тренувати'),
    ];
  } else if (owned) {
    action = [h('button', { class: 'btn btn-primary', onclick: (e) => buy(e.currentTarget) }, '↺ Відновити безкоштовно')];
  } else if (!p.price && !p.free) {
    action = [h('button', { class: 'btn', disabled: true }, 'Усі слова вже є у словниках')];
  } else if (p.free) {
    action = [h('button', { class: 'btn btn-primary', onclick: (e) => buy(e.currentTarget) }, '🎁 Забрати в подарунок')];
  } else if (balance >= p.price) {
    action = [h('button', { class: 'btn btn-primary', onclick: (e) => buy(e.currentTarget) }, `Купити за ${grainsText(p.price)}`)];
  } else {
    const need = p.price - balance;
    const days = Math.max(1, Math.ceil(need / 50));
    action = [h('button', { class: 'btn', disabled: true }, `Не вистачає ${grainsText(need)}`)];
    action.unshift(h('span', { class: 'muted small need-hint' }, `≈ ${plural(days, 'день', 'дні', 'днів')} тренувань`));
  }

  const notes = [];
  if (p.isDeal && !owned) notes.push(`🔥 Пак дня: знижка ${Math.round(shop.dealDiscount * 100)}%`);
  if (p.knownCount && !owned) notes.push(`✂️ ${wordsN(p.knownCount)} вже є у твоїх словниках — вони не дублюватимуться, і ціна менша`);
  if (p.free) notes.push('🎁 Перший пак безкоштовно');

  const m = modal(p.title, h('div', { class: 'grid', style: { gap: '14px' } },
    h('div', { class: 'pack-hero' }, packIcon(p.id, 'pack-icon pack-icon-lg'),
      h('div', null,
        h('div', { class: 'pack-meta' }, h('span', { class: 'badge' }, p.level), h('span', { class: 'muted small' }, `${wordsN(p.count)} · ${PACK_TYPES[p.type][1]}`)),
        h('p', { style: { marginTop: '6px' } }, p.description))),
    h('div', { class: 'preview' },
      h('span', { class: 'q-label' }, 'Приклади слів'),
      p.preview.map((w) => h('div', { class: 'preview-row' },
        h('div', null, h('b', null, w.term), ' ', h('span', { class: 'tx' }, w.transcription), h('span', { class: 'muted' }, ` — ${w.translation}`)),
        h('div', { class: 'ex' }, w.example)))),
    notes.length ? h('div', { class: 'notes' }, notes.map((n) => h('p', { class: 'small' }, n))) : null,
    !owned && (p.price || p.free) ? h('div', { class: 'modal-price' }, h('span', { class: 'muted' }, `На рахунку: ${grainsText(balance)}`), priceTag(p)) : null),
  action, { wide: true });
}
