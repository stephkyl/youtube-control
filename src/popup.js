'use strict';

const { config, MSG, t, plural, esc, dayKey, midnightOf, fmtSpent, fmtLeft, fmtCounts } = YS;

// --- État ---------------------------------------------------------------------
let session = null;
let daily = null;
let renderedKey = null; // évite de reconstruire l'interface à chaque seconde
let refs = {}; // éléments mis à jour chaque seconde

document.documentElement.lang = YS.uiLang;
document.title = t('extName');
const app = document.getElementById('app');

// --- Textes ---------------------------------------------------------------------

// Bilan du jour : sessions terminées depuis minuit + partie déjà écoulée de la session en cours.
function todayText(running) {
  const now = Date.now();
  const base = daily?.day === dayKey(now) ? daily : { totalMs: 0, sessions: 0 };
  let total = base.totalMs;
  let count = base.sessions;
  if (running) {
    total += Math.max(0, now - Math.max(session.startedAt, midnightOf(now)));
    count += 1;
  }
  return t('popupToday', fmtSpent(total), plural(count, 'statSessionsOne', 'statSessionsMany'));
}

// --- Rendu ----------------------------------------------------------------------
const footerLinks = () => `
  <div class="links">
    <button type="button" class="link" data-action="stats">${esc(t('popupStats'))}</button>
    <button type="button" class="link" data-action="settings">${esc(t('popupSettings'))}</button>
  </div>`;

const idleHtml = () => `
  <div class="eyebrow">${esc(t('extName'))}</div>
  <p class="muted">${esc(t('popupIdle'))}</p>
  <p class="today" data-ref="today"></p>
  <button type="button" class="primary" data-action="open">${esc(t('popupOpen'))}</button>
  ${footerLinks()}`;

const runningHtml = () => `
  <div class="mode">${esc(t(session.mode === 'long' ? 'modeLong' : 'modeAll'))}</div>
  <div class="eyebrow">${esc(t(session.status === 'overtime' ? 'popupTimeUp' : 'popupTimeLeft'))}</div>
  <p class="big" data-ref="left"></p>
  <p class="muted" data-ref="sub"></p>
  <div class="bar"><div data-ref="bar"></div></div>
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
  settings: () => browser.runtime.openOptionsPage(),
};

function render() {
  const running = Boolean(session && session.status !== 'ended');
  const key = running ? `${session.id}-${session.status}` : 'idle';

  if (key !== renderedKey) {
    renderedKey = key;
    app.innerHTML = running ? runningHtml() : idleHtml();
    refs = Object.fromEntries([...app.querySelectorAll('[data-ref]')].map((node) => [node.dataset.ref, node]));
  }

  if (running) {
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

// --- Données ----------------------------------------------------------------------
browser.storage.local.get(['session', 'daily']).then((r) => {
  session = YS.normalizeSession(r.session);
  daily = r.daily || null;
  render();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.session || changes.daily)) return;
  if (changes.daily) daily = changes.daily.newValue || null;
  if (changes.session) session = YS.normalizeSession(changes.session.newValue);
  render();
});

setInterval(render, 1000);
