'use strict';

const { MSG, t, plural, esc, dayKey, midnightOf, DAY_MS, fmtDayLabel, fmtSpent, fmtCounts, sessionRowHtml } = YS;

document.documentElement.lang = YS.uiLang;
document.title = t('statsPageTitle');
for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);

const $ = (id) => document.getElementById(id);
const spent = (h) => Math.max(0, h.endedAt - h.startedAt);
const sum = (rows, fn) => rows.reduce((acc, h) => acc + fn(h), 0);

// Temps passé depuis `from` : seule la partie après cet instant compte (session à cheval sur minuit).
const spentSince = (rows, from) => sum(rows, (h) => Math.max(0, h.endedAt - Math.max(h.startedAt, from)));

// Tuiles : aujourd'hui, 7 derniers jours (aujourd'hui compris), nombre total de sessions.
function tilesHtml(history) {
  const todayStart = midnightOf(Date.now());
  const weekStart = midnightOf(todayStart - 6 * DAY_MS + DAY_MS / 2); // DAY_MS / 2 : robuste aux changements d'heure
  const tiles = [
    { value: fmtSpent(spentSince(history, todayStart)), label: t('statToday') },
    { value: fmtSpent(spentSince(history, weekStart)), label: t('statsLast7') },
    { value: String(history.length), label: t(history.length === 1 ? 'statsSessionOne' : 'statsSessionMany') },
  ];
  return tiles
    .map((tile) => `<div class="tile"><div class="tile-value">${esc(tile.value)}</div><div class="tile-label">${esc(tile.label)}</div></div>`)
    .join('');
}

// Sessions groupées par jour de fin, la plus récente en premier (l'historique est déjà trié).
function daysHtml(history) {
  const days = Map.groupBy(history, (h) => dayKey(h.endedAt));
  return [...days.values()]
    .map((rows) => {
      const summary = [
        fmtSpent(sum(rows, spent)),
        plural(rows.length, 'statSessionsOne', 'statSessionsMany'),
        ...fmtCounts(sum(rows, (h) => h.videos), sum(rows, (h) => h.shorts)),
      ];
      return `<section class="day">
        <h2><span>${esc(fmtDayLabel(rows[0].endedAt))}</span><span class="day-sum">${esc(summary.join(' · '))}</span></h2>
        <ul class="hist-list">${rows.map((h) => sessionRowHtml(h)).join('')}</ul>
      </section>`;
    })
    .join('');
}

function render(stored) {
  const history = YS.normalizeHistory(stored);
  $('empty').hidden = history.length > 0;
  $('clear').hidden = history.length === 0;
  $('tiles').innerHTML = tilesHtml(history);
  $('days').innerHTML = daysHtml(history);
}

browser.storage.local.get('history').then(({ history }) => render(history));
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.history) render(changes.history.newValue);
});

$('clear').addEventListener('click', () => {
  if (window.confirm(t('statsClearConfirm'))) browser.runtime.sendMessage({ type: MSG.CLEAR_HISTORY });
});
