'use strict';

const app = document.getElementById('app');
let session = null;
let renderedKey = null;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function render() {
  const running = session && session.status !== 'ended';
  const key = running ? `${session.id}-${session.status}` : 'idle';

  if (key !== renderedKey) {
    renderedKey = key;
    if (!running) {
      app.innerHTML = `
        <div class="eyebrow">Session YouTube</div>
        <p class="muted">Aucune session en cours. YouTube reste fermé jusqu'à ce que tu en démarres une depuis la page YouTube.</p>
        <button class="primary" id="open">Ouvrir YouTube</button>`;
      document.getElementById('open').addEventListener('click', () => {
        browser.tabs.create({ url: 'https://www.youtube.com/' });
        window.close();
      });
    } else {
      app.innerHTML = `
        <div class="eyebrow">${session.status === 'overtime' ? 'Temps écoulé' : 'Temps restant'}</div>
        <p class="big" id="left"></p>
        <p class="muted">sur ${session.durationMin} min · <span id="count"></span></p>
        <div class="bar"><div id="bar"></div></div>
        <p class="quote">« ${esc(session.intention)} »</p>
        <button id="end">Terminer la session maintenant</button>`;
      document.getElementById('end').addEventListener('click', () => {
        browser.runtime.sendMessage({ type: 'END_SESSION', reason: 'manual' });
      });
    }
  }

  if (running) {
    const total = session.endsAt - session.startedAt;
    const left = Math.max(0, session.endsAt - Date.now());
    const n = session.videos.length;
    document.getElementById('left').textContent =
      session.status === 'overtime' ? 'Dernière vidéo' : fmtClock(left);
    document.getElementById('count').textContent = `${n} vidéo${n > 1 ? 's' : ''}`;
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
