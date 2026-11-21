'use strict';

const { config, MSG, t, plural, modeLabel, h, midnightOf, fmtSpent, fmtLeft, fmtCounts, totalsSince } = YS;

// --- State --------------------------------------------------------------------
let session = null;
let history = [];
let renderedKey = null; // avoids rebuilding the UI every second
let refs = {}; // elements updated every second: { today, left?, sub?, bar? }

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
function openYouTube() {
  browser.tabs.create({ url: 'https://www.youtube.com/' });
  window.close();
}
function openStats() {
  browser.tabs.create({ url: browser.runtime.getURL(config.STATS_PAGE) });
  window.close();
}
const endNow = () => browser.runtime.sendMessage({ type: MSG.END_SESSION, reason: 'manual' });

const button = (attrs, label) => h('button', { type: 'button', ...attrs }, label);
const footerLinks = () => h('div', { class: 'links' }, button({ class: 'link', onclick: openStats }, t('popupStats')));

// Builds the UI for the current state and returns the elements updated every second.
function build(running) {
  const refs = { today: h('p', { class: 'today' }) };
  if (!running) {
    app.replaceChildren(
      h('div', { class: 'eyebrow' }, t('extName')),
      h('p', { class: 'muted' }, t('popupIdle')),
      refs.today,
      button({ class: 'primary', onclick: openYouTube }, t('popupOpen')),
      footerLinks()
    );
    return refs;
  }

  // The top block depends on the type: timer, or (one video) where we stand.
  let top;
  if (session.mode === 'one') {
    top = h('p', { class: 'big' }, t(session.chosenVideo ? 'oneVideoChosen' : 'oneVideoChoose'));
  } else {
    Object.assign(refs, { left: h('p', { class: 'big' }), sub: h('p', { class: 'muted' }), bar: h('div') });
    top = [
      h('div', { class: 'eyebrow' }, t(session.status === 'overtime' ? 'popupTimeUp' : 'popupTimeLeft')),
      refs.left,
      refs.sub,
      h('div', { class: 'bar' }, refs.bar),
    ];
  }
  app.replaceChildren(
    ...[
      h('div', { class: 'mode' }, modeLabel(session.mode)),
      top,
      h('p', { class: 'quote' }, t('quote', session.intention)),
      refs.today,
      button({ onclick: endNow }, t('popupEnd')),
      footerLinks(),
    ].flat()
  );
  return refs;
}

function render() {
  const running = Boolean(session && session.status !== 'ended');
  const key = running ? `${session.id}-${session.status}-${session.chosenVideo}` : 'idle';
  if (key !== renderedKey) {
    renderedKey = key;
    refs = build(running);
  }

  if (refs.left) {
    const left = Math.max(0, session.endsAt - Date.now());
    refs.left.textContent = session.status === 'overtime' ? t('lastVideo') : fmtLeft(left);
    refs.sub.textContent = [t('popupOf', session.durationMin), ...fmtCounts(session.videos.length, session.shorts.length)].join(' · ');
    refs.bar.style.width = `${(left / (session.endsAt - session.startedAt)) * 100}%`;
  }
  refs.today.textContent = todayText(running);
}

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
