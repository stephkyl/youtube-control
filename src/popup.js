'use strict';

const { t, dayKey, midnightOf, fmtSpent, fmtCounts } = YS;
const fmtMinutes = (ms) => t('minutesShort', Math.max(1, Math.ceil(ms / 60000)));
let daily = null;

// Bilan du jour : sessions terminées depuis minuit + partie déjà écoulée de la session en cours.
function todayText(running) {
  const now = Date.now();
  const base = daily && daily.day === dayKey(now) ? daily : { totalMs: 0, sessions: 0 };
  let total = base.totalMs;
  let count = base.sessions;
  if (running) {
    total += Math.max(0, now - Math.max(session.startedAt, midnightOf(now)));
    count += 1;
  }
  const sessions = count === 1 ? t('statSessionsOne') : t('statSessionsMany', count);
  return t('popupToday', fmtSpent(total), sessions);
}

document.documentElement.lang = YS.uiLang;
document.title = t('extName');

const app = document.getElementById('app');
let session = null;
let renderedKey = null;

// Construit l'interface sans innerHTML : aucun texte n'est interprété comme du HTML.
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

// Liens du bas : historique (nouvel onglet) et réglages.
function settingsLink() {
  return el('div', { className: 'links' }, [
    el('button', {
      className: 'link',
      textContent: t('popupStats'),
      onclick: () => {
        browser.tabs.create({ url: browser.runtime.getURL('src/stats.html') });
        window.close();
      },
    }),
    el('button', { className: 'link', textContent: t('popupSettings'), onclick: () => browser.runtime.openOptionsPage() }),
  ]);
}

function render() {
  const running = session && session.status !== 'ended';
  const key = running ? `${session.id}-${session.status}` : 'idle';

  if (key !== renderedKey) {
    renderedKey = key;
    if (!running) {
      app.replaceChildren(
        el('div', { className: 'eyebrow', textContent: t('extName') }),
        el('p', { className: 'muted', textContent: t('popupIdle') }),
        el('p', { className: 'today', id: 'today' }),
        el('button', {
          className: 'primary',
          textContent: t('popupOpen'),
          onclick: () => {
            browser.tabs.create({ url: 'https://www.youtube.com/' });
            window.close();
          },
        }),
        settingsLink()
      );
    } else {
      app.replaceChildren(
        el('div', { className: 'mode', textContent: t(session.mode === 'long' ? 'modeLong' : 'modeAll') }),
        el('div', { className: 'eyebrow', textContent: t(session.status === 'overtime' ? 'popupTimeUp' : 'popupTimeLeft') }),
        el('p', { className: 'big', id: 'left' }),
        el('p', { className: 'muted', id: 'sub' }),
        el('div', { className: 'bar' }, [el('div', { id: 'bar' })]),
        el('p', { className: 'quote', textContent: t('quote', session.intention) }),
        el('p', { className: 'today', id: 'today' }),
        el('button', {
          textContent: t('popupEnd'),
          onclick: () => browser.runtime.sendMessage({ type: 'END_SESSION', reason: 'manual' }),
        }),
        settingsLink()
      );
    }
  }

  if (running) {
    const total = session.endsAt - session.startedAt;
    const left = Math.max(0, session.endsAt - Date.now());
    document.getElementById('left').textContent = session.status === 'overtime' ? t('lastVideo') : fmtMinutes(left);
    const nVideos = (session.videos || []).length;
    const nShorts = (session.shorts || []).length;
    document.getElementById('sub').textContent = [t('popupOf', session.durationMin), ...fmtCounts(nVideos, nShorts)].join(' · ');
    document.getElementById('bar').style.width = `${(left / total) * 100}%`;
  }
  document.getElementById('today').textContent = todayText(running);
}

browser.storage.local.get(['session', 'daily']).then((r) => {
  session = r.session || null;
  daily = r.daily || null;
  render();
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.daily) daily = changes.daily.newValue || null;
  if (changes.session) session = changes.session.newValue || null;
  if (changes.session || changes.daily) render();
});
setInterval(render, 1000);
