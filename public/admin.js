'use strict';

/* =========================================================
   Адмінка: аналітика по користувачах, навчанні, економіці та ШІ.
   Доступ перевіряє сервер (403 для не-адміна), тут лише показ.
   ========================================================= */

const adminDate = (ts) => new Date(ts).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: '2-digit' });

// Дні без даних теж мають бути на графіку, інакше два записи виглядають як суцільна смуга
function lastDays(n, rows, pick) {
  const byDay = Object.fromEntries(rows.map((r) => [r.day, r]));
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() - n + 1);
  for (let i = 0; i < n; i++) {
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ day, ...pick(byDay[day]) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function tiles(items) {
  return h('div', { class: 'tiles' }, items.map(([value, label]) =>
    h('div', { class: 'tile-stat' }, h('b', null, String(value)), h('span', null, label))));
}

// Стовпчики за днями: [{ label, value, extra }]
function barChart(rows, { unit = '' } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('div', { class: 'bars' }, rows.map((r) => h('div', {
    class: 'bar-col', title: `${r.label}: ${r.value}${unit}${r.extra ? ` · ${r.extra}` : ''}`,
  },
  h('div', { class: 'bar-fill', style: { height: `${(r.value / max) * 100}%` } }),
  h('span', { class: 'bar-label' }, r.short || ''))));
}

function table(headers, rows) {
  return h('div', { style: { overflowX: 'auto' } },
    h('table', { class: 'table' },
      h('thead', null, h('tr', null, headers.map((th) => h('th', null, th)))),
      h('tbody', null, rows.map((cells) => h('tr', null, cells.map((c) => h('td', null, c)))))));
}

async function viewAdmin(main, params, alive) {
  let data;
  try {
    data = await api('/admin/stats');
  } catch (e) {
    main.append(h('div', { class: 'card empty' }, svg(pippoSvg('think')), h('h2', null, 'Немає доступу'),
      h('p', { class: 'muted' }, e.status === 403 ? 'Ця сторінка лише для адміністратора.' : e.message)));
    return;
  }
  if (!alive()) return;

  const { users, learning, economy, ai } = data;
  const shortDay = (day) => day.slice(8);

  main.append(
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, '📊 Адмінка'), h('p', { class: 'muted' }, 'Що відбувається в Pippo')),
      h('button', { class: 'btn btn-sm', onclick: render }, '↻ Оновити')),

    h('div', { class: 'grid' },
      h('div', { class: 'card' },
        h('h3', null, '👥 Користувачі'),
        h('div', { style: { marginTop: '12px' } }, tiles([
          [users.total, 'усього'],
          [users.newWeek, 'нових за тиждень'],
          [users.activeToday, 'активні сьогодні'],
          [users.activeWeek, 'активні за тиждень'],
        ]))),

      h('div', { class: 'card' },
        h('h3', null, '📚 Навчання'),
        h('div', { style: { marginTop: '12px' } }, tiles([
          [learning.words, 'слів у словниках'],
          [learning.mastered, 'вивчено'],
          [learning.answersToday, 'відповідей сьогодні'],
          [learning.answersWeek, 'відповідей за тиждень'],
          [`${learning.accuracy}%`, 'точність'],
          [learning.tests, 'тренувань'],
        ])),
        learning.byMode.length
          ? h('div', { class: 'chips', style: { marginTop: '14px' } }, learning.byMode.map((m) =>
            h('span', { class: 'chip' }, `${(MODES[m.mode] || { icon: '', name: m.mode }).icon} ${(MODES[m.mode] || { name: m.mode }).name}`, h('span', { class: 'count' }, m.n))))
          : null),

      h('div', { class: 'card' },
        h('h3', null, '📈 Активність за 30 днів'),
        h('div', { style: { marginTop: '14px' } },
          barChart(lastDays(30, data.activity, (r) => ({ value: r ? r.answers : 0, users: r ? r.users : 0 }))
            .map((r) => ({ label: r.day, short: shortDay(r.day), value: r.value, extra: `${r.users} користувачів` })), { unit: ' відповідей' })),
        h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'Висота — відповіді за день; наведи, щоб побачити точні числа.')),

      h('div', { class: 'card' },
        h('h3', null, '🌾 Економіка'),
        h('div', { style: { marginTop: '12px' } }, tiles([
          [economy.granted, 'нараховано всього'],
          [economy.spent, 'витрачено'],
          [economy.balance, 'на рахунках'],
          [economy.purchases, 'куплених паків'],
        ])),
        economy.byKind.length
          ? h('div', { style: { marginTop: '14px' } }, table(['Джерело', 'Разів', 'Зерняток'],
            economy.byKind.map((k) => [KIND_LABELS[k.kind] || k.kind, k.n, k.total])))
          : null),

      economy.topPacks.length
        ? h('div', { class: 'card' },
          h('h3', null, '🛍️ Найпопулярніші паки'),
          h('div', { style: { marginTop: '10px' } }, table(['Пак', 'Куплень', 'Зерняток'],
            economy.topPacks.map((p) => [
              h('span', { class: 'pack-cell' }, packIcon(p.packId, 'pack-icon pack-icon-sm'), p.packId),
              p.n, p.spent,
            ]))))
        : null,

      h('div', { class: 'card' },
        h('h3', null, '✨ Навантаження на ШІ'),
        h('div', { style: { marginTop: '12px' } }, tiles([
          [ai.wordsToday, 'слів за добу'],
          [ai.requestsToday, 'запитів за добу'],
          [ai.failedToday, 'невдалих'],
          [ai.wordsWeek, 'слів за тиждень'],
        ])),
        h('div', { style: { marginTop: '14px' } },
          h('div', { class: 'meter-label' },
            h('span', null, 'Спільний денний ліміт сервера'),
            h('b', null, `${ai.wordsToday} / ${ai.limits.wordsPerDayTotal}`)),
          progressBar(ai.wordsToday, ai.limits.wordsPerDayTotal)),
        h('p', { class: 'muted small', style: { marginTop: '10px' } },
          `На акаунт: ${ai.limits.wordsPerHour} слів/год, ${ai.limits.wordsPerDay} слів/добу, ${ai.limits.requestsPerHour} запитів/год.`),
        ai.byKind.length
          ? h('div', { style: { marginTop: '10px' } }, table(['Дія', 'Запитів', 'Слів'],
            ai.byKind.map((k) => [({ lookup: 'Слово з речення / автопереклад', batch: 'Кілька слів одразу', extract: 'Пошук слів у тексті' })[k.kind] || k.kind, k.n, k.words])))
          : null),

      h('div', { class: 'card' },
        h('h3', null, '🧑‍🎓 Користувачі'),
        h('div', { style: { marginTop: '10px' } }, table(['Ім’я', 'З нами з', 'Остання активність', '🔥', 'XP', '🌾', 'Слів', 'Відповідей', 'ШІ за добу'],
          data.topUsers.map((u) => [
            h('span', null, u.username, u.isAdmin ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'адмін') : null),
            adminDate(u.createdAt), u.lastDay || '—', u.streak, u.xp, u.grains, u.words, u.answers, u.aiWords,
          ])))),

      h('div', { class: 'card' },
        h('h3', null, '🆕 Реєстрації за 30 днів'),
        h('div', { style: { marginTop: '14px' } },
          barChart(lastDays(30, data.signups, (r) => ({ value: r ? r.n : 0 }))
            .map((r) => ({ label: r.day, short: shortDay(r.day), value: r.value })), { unit: ' нових' })))));
}
