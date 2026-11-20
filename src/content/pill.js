'use strict';

// Pastille en bas à gauche : temps restant ; au survol, bouton « Terminer » ;
// au clic, confirmation sur place.
YSC.pill = (() => {
  const { MSG, t, plural, esc, minutesLeft } = YS;
  const { T, state, isRunning, isOvertime, isOnLastShort, remainingMs, send } = YSC;

  let pill = null; // { host, box, txt }

  function create() {
    const host = document.createElement('div');
    host.setAttribute('data-ysess', 'pill');
    host.style.cssText = 'all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483646;';
    // Entrée ou Espace sur les boutons ne doivent pas déclencher les raccourcis de YouTube.
    for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (e) => e.stopPropagation());
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${YSC.styles.pill}</style>
      <div class="pill">
        <span class="dot"></span>
        <span class="txt"></span>
        <button type="button" class="end">${esc(t('pillEnd'))}</button>
        <span class="confirm">
          <span>${esc(t('pillConfirm'))}</span>
          <button type="button" class="yes">${esc(t('pillYes'))}</button>
          <button type="button" class="no">${esc(t('pillNo'))}</button>
        </span>
      </div>`;
    document.documentElement.appendChild(host);

    const box = root.querySelector('.pill');
    let timer = null;
    const closeConfirm = () => {
      clearTimeout(timer);
      box.classList.remove('confirming');
    };
    root.querySelector('.end').addEventListener('click', () => {
      box.classList.add('confirming');
      root.querySelector('.no').focus();
      clearTimeout(timer);
      timer = setTimeout(closeConfirm, T.PILL_CONFIRM_MS);
    });
    root.querySelector('.no').addEventListener('click', closeConfirm);
    root.querySelector('.yes').addEventListener('click', () => {
      closeConfirm();
      send({ type: MSG.END_SESSION, reason: 'manual' });
    });
    return { host, box, txt: root.querySelector('.txt') };
  }

  function text() {
    if (isOnLastShort()) return t('lastShort');
    if (isOvertime()) return t('lastVideo');
    return plural(minutesLeft(remainingMs()), 'pillLeftOne', 'pillLeftMany');
  }

  function update() {
    if (!isRunning() || state.overlay) {
      pill?.host.remove();
      pill = null;
      return;
    }
    if (!pill?.host.isConnected) pill = create();
    const label = text();
    if (pill.txt.textContent !== label) pill.txt.textContent = label;
    pill.box.classList.toggle('low', isOvertime() || remainingMs() < T.PILL_LOW_MS);
  }

  return { update };
})();
