'use strict';

const { t, plural, modeLabel, esc, dayKey, midnightOf, DAY_MS, fmtClock, fmtDayLabel, fmtSpent, fmtCounts, totalsSince } = YS;

document.documentElement.lang = YS.uiLang;
document.title = t('statsPageTitle');
for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);

const $ = (id) => document.getElementById(id);
const spent = (h) => Math.max(0, h.endedAt - h.startedAt);
const sum = (rows, fn) => rows.reduce((acc, h) => acc + fn(h), 0);

// One session: start time, duration, videos/shorts, tags, then the intention.
function sessionRowHtml(h) {
  const meta = [fmtClock(h.startedAt), fmtSpent(spent(h)), ...fmtCounts(h.videos, h.shorts)];
  const tags = [];
  if (h.mode !== 'all') tags.push(modeLabel(h.mode));
  if (h.endReason === 'manual') tags.push(t('histEarly'));
  return `<li class="hist-row">
    <div class="hist-meta">${esc(meta.join(' · '))}${tags.map((x) => ` <span class="hist-tag">${esc(x)}</span>`).join('')}</div>
    <div class="hist-intent">${esc(t('quote', h.intention))}</div>
  </li>`;
}

// Tiles: today, last 7 days (today included), total number of sessions.
function tilesHtml(history) {
  const todayStart = midnightOf(Date.now());
  const weekStart = midnightOf(todayStart - 6 * DAY_MS + DAY_MS / 2); // DAY_MS / 2: robust to DST changes
  const tiles = [
    { value: fmtSpent(totalsSince(history, todayStart).ms), label: t('statToday') },
    { value: fmtSpent(totalsSince(history, weekStart).ms), label: t('statsLast7') },
    { value: String(history.length), label: t(history.length === 1 ? 'statsSessionOne' : 'statsSessionMany') },
  ];
  return tiles
    .map((tile) => `<div class="tile"><div class="tile-value">${esc(tile.value)}</div><div class="tile-label">${esc(tile.label)}</div></div>`)
    .join('');
}

// Sessions grouped by end day, most recent first (the history is already sorted).
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
        <ul class="hist-list">${rows.map(sessionRowHtml).join('')}</ul>
      </section>`;
    })
    .join('');
}

function render(history = []) {
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
  if (window.confirm(t('statsClearConfirm'))) browser.storage.local.remove('history');
});
