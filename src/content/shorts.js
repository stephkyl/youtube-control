'use strict';

// Dernier short de la session.
// À moins de 2 min de la fin, le défilement reste possible : le short suivant sur lequel on
// arrive est le dernier. Pendant celui-ci, rien n'apparaît en dessous, le défilement est
// bloqué, et la session se termine dès qu'il est fini.
YSC.shorts = (() => {
  const { MSG } = YS;
  const { T, state, isRunning, isOvertime, remainingMs, isOnLastShort, pageType, getMainVideo, send } = YSC;
  const html = document.documentElement;
  const AFTER_LAST = 'data-ysess-after-last';

  // 'off'   : rien à masquer.
  // 'armed' : moins de 2 min, le prochain short sera le dernier → on masque dès maintenant
  //           tout ce qui vient après lui, pour qu'il n'y ait aucun aperçu en arrivant dessus.
  // 'last'  : on est sur le dernier short → tout ce qui suit est masqué, défilement bloqué.
  function maskState() {
    if (!isRunning() || pageType() !== 'shorts') return 'off';
    if (isOnLastShort()) return 'last';
    if (isOvertime() || remainingMs() < T.LAST_SHORT_THRESHOLD_MS) return 'armed';
    return 'off';
  }

  function finish(video) {
    if (state.video.finished) return;
    state.video.finished = true;
    video.pause();
    send({ type: MSG.END_SESSION, reason: 'shorts' });
  }

  // --- Repérage dans le fil ---------------------------------------------------

  // Élément du fil qui contient le short en cours, repéré sans dépendre des noms d'éléments
  // de YouTube : on remonte depuis la vidéo jusqu'à un élément haut d'au moins un demi-écran
  // dont un frère du même type est empilé juste en dessous (le short suivant). Les calques
  // du lecteur (contrôles, etc.) se superposent au lieu de s'empiler : ils sont ignorés.
  function findCurrentReelItem() {
    const minHeight = window.innerHeight * 0.5;
    for (let node = getMainVideo('shorts'); node?.parentElement && node !== document.body; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (rect.height < minHeight) continue;
      for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
        if (sib.tagName !== node.tagName) continue;
        const r = sib.getBoundingClientRect();
        if (r.height >= minHeight && r.top >= rect.bottom - T.STACK_TOLERANCE_PX) return node;
      }
    }
    return null;
  }

  function findFeedScroller() {
    let node = document.querySelector('ytd-reel-video-renderer[is-active]') || getMainVideo('shorts');
    for (; node && node !== html; node = node.parentElement) {
      const overflowY = getComputedStyle(node).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    }
    return document.scrollingElement;
  }

  // --- Masquage de la suite du fil --------------------------------------------

  // Masque les éléments du fil situés après le short en cours, en laissant `keep` visibles
  // (1 en mode 'armed' : le short suivant, sur lequel on va arriver).
  function hideReelsAfter(keep) {
    const item = findCurrentReelItem();
    if (!item) return;
    item.removeAttribute(AFTER_LAST);
    let sib = item.nextElementSibling;
    for (let i = 0; i < keep && sib; i += 1, sib = sib.nextElementSibling) sib.removeAttribute(AFTER_LAST);
    for (; sib; sib = sib.nextElementSibling) sib.setAttribute(AFTER_LAST, '');
  }

  function showAllReels() {
    for (const el of document.querySelectorAll(`[${AFTER_LAST}]`)) el.removeAttribute(AFTER_LAST);
  }

  // Appelé à chaque rafraîchissement : le fil peut s'allonger entre deux passages.
  function applyMask() {
    const mask = maskState();
    if (mask === 'off') showAllReels();
    else hideReelsAfter(mask === 'armed' ? 1 : 0);
    setLastShortMode(mask === 'last');
  }

  // --- Blocage du défilement --------------------------------------------------

  // Verrou de position : si le fil défile malgré tout (barre de défilement, script de YouTube…),
  // on le remet là où il était. Au début, on suit la position pour laisser l'aimantation
  // (scroll-snap) finir de caler le short.
  let scrollLock = null; // { el, top, since }
  const inLastShortMode = () => html.classList.contains('ysess-last-short');

  function setLastShortMode(on) {
    if (on === inLastShortMode()) return;
    html.classList.toggle('ysess-last-short', on);
    const el = on ? findFeedScroller() : null;
    scrollLock = el ? { el, top: el.scrollTop, since: Date.now() } : null;
  }

  document.addEventListener(
    'scroll',
    (e) => {
      if (!scrollLock || !inLastShortMode()) return;
      const { el } = scrollLock;
      if ((e.target === document ? document.scrollingElement : e.target) !== el) return;
      if (Date.now() - scrollLock.since < T.SNAP_SETTLE_MS) scrollLock.top = el.scrollTop;
      else if (Math.abs(el.scrollTop - scrollLock.top) > 1) el.scrollTop = scrollLock.top;
    },
    true
  );

  // Molette, tactile, clavier : pas de passage au short suivant (sauf dans le panneau des commentaires).
  const blockFeedScroll = (e) => {
    if (!inLastShortMode()) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('ytd-engagement-panel-section-list-renderer, [data-ysess]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const NAV_KEYS = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'];
  const EDITABLE_SEL = 'input, textarea, [contenteditable=""], [contenteditable="true"]';

  window.addEventListener('wheel', blockFeedScroll, { capture: true, passive: false });
  window.addEventListener('touchmove', blockFeedScroll, { capture: true, passive: false });
  window.addEventListener(
    'keydown',
    (e) => {
      if (!NAV_KEYS.includes(e.key)) return;
      if (e.target instanceof Element && e.target.closest(EDITABLE_SEL)) return;
      blockFeedScroll(e);
    },
    true
  );

  // Fin du dernier short : on l'arrête juste avant qu'il ne reparte en boucle.
  document.addEventListener(
    'timeupdate',
    (e) => {
      const vs = state.video;
      // Tant que la vidéo n'est pas confirmée (checked), <video> peut encore porter le short précédent.
      if (!e.isTrusted || !vs.lastShort || !vs.checked || vs.finished || pageType() !== 'shorts') return;
      const video = getMainVideo('shorts');
      if (e.target !== video || !Number.isFinite(video.duration)) return;
      if (video.duration - video.currentTime < T.SHORT_END_MARGIN_S) finish(video);
    },
    true
  );

  return { maskState, applyMask, finish };
})();
