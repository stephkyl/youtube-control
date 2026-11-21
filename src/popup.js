'use strict';

const { config, MSG, t, plural, modeLabel, esc, midnightOf, fmtSpent, fmtLeft, fmtCounts, totalsSince } = YS;

// --- State --------------------------------------------------------------------
let session = null;
let history = [];
let renderedKey = null; // avoids rebuilding the UI every second
let refs = {}; // elements updated every second

document.documentElement.lang = YS.uiLang;
document.title = t('extName');
for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
const app = document.getElementById('app');

// --- Text -----------------------------------------------------------------------

// Today's total: sessions finished since midnight + elapsed part of the running session.
function todayText(running) {
  const now = Date.now();
  const midnight = midnightOf(now);
  let { ms, sessions } = totalsSince(history, midnight);
  if (running) {
    ms += now - Math.max(session.startedAt, midnight);
    sessions += 1;
  }
  return t('popupToday', fmtSpent(ms), plural(sessions, 'statSessionsOne', 'statSessionsMany'));
}

// --- Rendering ------------------------------------------------------------------
const footerLinks = () => `
  <div class="links">
    <button type="button" class="link" data-action="stats">${esc(t('popupStats'))}</button>
  </div>`;

const idleHtml = () => `
  <div class="eyebrow">${esc(t('extName'))}</div>
  <p class="muted">${esc(t('popupIdle'))}</p>
  <p class="today" data-ref="today"></p>
  <button type="button" class="primary" data-action="open">${esc(t('popupOpen'))}</button>
  ${footerLinks()}`;

// Running session. The top block depends on the type: timer, or (one video) where we stand.
const timerHtml = () => `
  <div class="eyebrow">${esc(t(session.status === 'overtime' ? 'popupTimeUp' : 'popupTimeLeft'))}</div>
  <p class="big" data-ref="left"></p>
  <p class="muted" data-ref="sub"></p>
  <div class="bar"><div data-ref="bar"></div></div>`;

const oneVideoHtml = () => `
  <p class="big">${esc(t(session.chosenVideo ? 'oneVideoChosen' : 'oneVideoChoose'))}</p>`;

const runningHtml = () => `
  <div class="mode">${esc(modeLabel(session.mode))}</div>
  ${session.mode === 'one' ? oneVideoHtml() : timerHtml()}
  <p class="quote">${esc(t('quote', session.intention))}</p>
  <p class="today" data-ref="today"></p>
  <button type="button" data-action="end">${esc(t('popupEnd'))}</button>
  ${footerLinks()}`;

const actions = {
  open() {
    browser.tabs.create({ url: 'https://www.youtube.com/' });
    window.close();
  },
  end: () => browser.runtime.sendMessage({ type: MSG.END_SESSION, reason: 'manual' }),
  stats() {
    browser.tabs.create({ url: browser.runtime.getURL(config.STATS_PAGE) });
    window.close();
  },
};

function render() {
  const running = Boolean(session && session.status !== 'ended');
  const oneVideo = running && session.mode === 'one';
  const key = running ? `${session.id}-${session.status}-${session.chosenVideo}` : 'idle';

  if (key !== renderedKey) {
    renderedKey = key;
    app.innerHTML = running ? runningHtml() : idleHtml();
    refs = Object.fromEntries([...app.querySelectorAll('[data-ref]')].map((node) => [node.dataset.ref, node]));
  }

  if (running && !oneVideo) {
    const left = Math.max(0, session.endsAt - Date.now());
    refs.left.textContent = session.status === 'overtime' ? t('lastVideo') : fmtLeft(left);
    refs.sub.textContent = [t('popupOf', session.durationMin), ...fmtCounts(session.videos.length, session.shorts.length)].join(' · ');
    refs.bar.style.width = `${(left / (session.endsAt - session.startedAt)) * 100}%`;
  }
  refs.today.textContent = todayText(running);
}

app.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action) actions[action]();
});

// --- Settings ---------------------------------------------------------------------
// A single setting for now: applied immediately in YouTube tabs.
const radios = [...document.querySelectorAll('input[name="watchSuggestions"]')];
function showSettings(stored) {
  const { watchSuggestions } = YS.withDefaultSettings(stored);
  for (const radio of radios) radio.checked = radio.value === watchSuggestions;
}
for (const radio of radios) {
  radio.addEventListener('change', () => browser.storage.local.set({ settings: { watchSuggestions: radio.value } }));
}

// --- Data -------------------------------------------------------------------------
browser.storage.local.get(['session', 'history', 'settings']).then((r) => {
  session = r.session ?? null;
  history = r.history ?? [];
  showSettings(r.settings);
  render();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.session || changes.history)) return;
  if (changes.history) history = changes.history.newValue ?? [];
  if (changes.session) session = changes.session.newValue ?? null;
  render();
});

setInterval(render, 1000);
