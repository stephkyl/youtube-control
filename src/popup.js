'use strict';

const t = (key, ...subs) => browser.i18n.getMessage(key, subs.map(String));
const fmtVideos = (n) => (n === 0 ? t('videosNone') : n === 1 ? t('videosOne') : t('videosMany', n));
const fmtMinutes = (ms) => t('minutesShort', Math.max(1, Math.ceil(ms / 60000)));

document.documentElement.lang = browser.i18n.getUILanguage();
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

function settingsLink() {
  return el('button', { className: 'link', textContent: t('popupSettings'), onclick: () => browser.runtime.openOptionsPage() });
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
        el('div', { className: 'eyebrow', textContent: t(session.status === 'overtime' ? 'popupTimeUp' : 'popupTimeLeft') }),
        el('p', { className: 'big', id: 'left' }),
        el('p', { className: 'muted', id: 'sub' }),
        el('div', { className: 'bar' }, [el('div', { id: 'bar' })]),
        el('p', { className: 'quote', textContent: t('quote', session.intention) }),
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
    document.getElementById('sub').textContent = `${t('popupOf', session.durationMin)} · ${fmtVideos(session.videos.length)}`;
    document.getElementById('bar').style.width = `${(left / total) * 100}%`;
  }
}

browser.storage.local.get('session').then((r) => {
  session = r.session || null;
  render();
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.session) {
    session = changes.session.newValue || null;
    render();
  }
});
setInterval(render, 1000);
