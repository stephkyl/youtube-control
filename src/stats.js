'use strict';

const { t, plural, modeLabel, h, dayKey, midnightOf, DAY_MS, fmtClock, fmtDayLabel, fmtSpent, fmtCounts, totalsSince } = YS;

document.documentElement.lang = YS.uiLang;
document.title = t('statsPageTitle');
for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);

const $ = (id) => document.getElementById(id);
const spent = (h) => Math.max(0, h.endedAt - h.startedAt);
const sum = (rows, fn) => rows.reduce((acc, h) => acc + fn(h), 0);

// One session: start time, duration, videos/shorts, tags, then the intention.
function sessionRow(entry) {
  const meta = [fmtClock(entry.startedAt), fmtSpent(spent(entry)), ...fmtCounts(entry.videos, entry.shorts)];
  const tags = [];
  if (entry.mode !== 'all') tags.push(modeLabel(entry.mode));
  if (entry.endReason === 'manual') tags.push(t('histEarly'));
  return h(
    'li',
    { class: 'hist-row' },
    h('div', { class: 'hist-meta' }, meta.join(' · '), tags.map((tag) => [' ', h('span', { class: 'hist-tag' }, tag)])),
    h('div', { class: 'hist-intent' }, t('quote', entry.intention))
  );
}

// Tiles: today, last 7 days (today included), total number of sessions.
function tiles(history) {
  const todayStart = midnightOf(Date.now());
  const weekStart = midnightOf(todayStart - 6 * DAY_MS + DAY_MS / 2); // DAY_MS / 2: robust to DST changes
  return [
    { value: fmtSpent(totalsSince(history, todayStart).ms), label: t('statToday') },
    { value: fmtSpent(totalsSince(history, weekStart).ms), label: t('statsLast7') },
    { value: history.length, label: t(history.length === 1 ? 'statsSessionOne' : 'statsSessionMany') },
  ].map((tile) => h('div', { class: 'tile' }, h('div', { class: 'tile-value' }, tile.value), h('div', { class: 'tile-label' }, tile.label)));
}

// Sessions grouped by end day, most recent first (the history is already sorted).
function days(history) {
  return [...Map.groupBy(history, (entry) => dayKey(entry.endedAt)).values()].map((rows) => {
    const summary = [
      fmtSpent(sum(rows, spent)),
      plural(rows.length, 'statSessionsOne', 'statSessionsMany'),
      ...fmtCounts(sum(rows, (entry) => entry.videos), sum(rows, (entry) => entry.shorts)),
    ];
    return h(
      'section',
      { class: 'day' },
      h('h2', null, h('span', null, fmtDayLabel(rows[0].endedAt)), h('span', { class: 'day-sum' }, summary.join(' · '))),
      h('ul', { class: 'hist-list' }, rows.map(sessionRow))
    );
  });
}

function render(history = []) {
  $('empty').hidden = history.length > 0;
  $('clear').hidden = history.length === 0;
  $('tiles').replaceChildren(...tiles(history));
  $('days').replaceChildren(...days(history));
}

browser.storage.local.get('history').then(({ history }) => render(history));
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.history) render(changes.history.newValue);
});

$('clear').addEventListener('click', () => {
  if (window.confirm(t('statsClearConfirm'))) browser.storage.local.remove('history');
});
