'use strict';

// Filtrage des suggestions selon le temps restant, et masquage des Shorts en session
// « vidéos longues ». Les règles d'affichage correspondantes sont dans content.css.
YSC.filter = (() => {
  const { T, state, isRunning, isLongMode, remainingMs, pageType, urlVideoId } = YSC;
  const html = document.documentElement;

  const CARD_SEL = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'yt-lockup-view-model',
    '.ytp-videowall-still',
    '.ytp-modern-videowall-still',
  ].join(',');

  const BADGE_SEL = [
    'ytd-thumbnail-overlay-time-status-renderer',
    'badge-shape',
    '.badge-shape-wiz__text',
    '.yt-badge-shape__text',
    '[class*="videowall-still-info-duration"]',
  ].join(',');

  const PROGRESS_SEL = [
    'ytd-thumbnail-overlay-resume-playback-renderer #progress',
    '[class*="WatchedProgressBarSegment"]',
    '[class*="ResumePlayback"] [style*="width"]',
    '[class*="resume-playback"] [style*="width"]',
  ].join(',');

  // Filtres de recherche et onglets de chaîne « Shorts » : pas de lien, repérés par leur texte.
  const SHORTS_LABEL_SEL = 'yt-chip-cloud-chip-renderer, chip-view-model, yt-chip-cloud-chip-view-model, yt-tab-shape, tp-yt-paper-tab';

  const TIME_RE = /(?:^|\s)((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s|$)/;

  const parseTime = (text) => text.split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0) * 1000;

  // Durée affichée sur la vignette, ou null si inconnue (direct, short, playlist, pas encore chargée).
  function readCardDuration(card) {
    for (const badge of card.querySelectorAll(BADGE_SEL)) {
      const text = (badge.textContent || '').trim();
      if (!text || text.length > T.BADGE_MAX_CHARS) continue;
      const match = TIME_RE.exec(text);
      if (match) return parseTime(match[1]);
    }
    return null;
  }

  function readWatchedFraction(card) {
    const bar = card.querySelector(PROGRESS_SEL);
    const match = bar && /([\d.]+)%/.exec(bar.style.width || '');
    return match ? Math.min(100, parseFloat(match[1])) / 100 : 0;
  }

  function filterCards() {
    const rem = remainingMs();
    for (const card of document.querySelectorAll(CARD_SEL)) {
      // Ne traiter que la carte la plus externe (ex. ytd-rich-item-renderer > yt-lockup-view-model).
      if (card.parentElement?.closest(CARD_SEL)) continue;
      const duration = readCardDuration(card);
      const left = duration === null ? null : duration * (1 - readWatchedFraction(card)); // si déjà entamée
      const hide = left !== null && left > rem + T.FIT_TOLERANCE_MS;
      if (hide !== card.hasAttribute('data-ysess-hidden')) card.toggleAttribute('data-ysess-hidden', hide);
    }
  }

  function clearFilter() {
    for (const el of document.querySelectorAll('[data-ysess-hidden]')) el.removeAttribute('data-ysess-hidden');
  }

  function markShortsLabels() {
    if (!isLongMode()) {
      for (const el of document.querySelectorAll('[data-ysess-noshorts]')) el.removeAttribute('data-ysess-noshorts');
      return;
    }
    for (const el of document.querySelectorAll(SHORTS_LABEL_SEL)) {
      if ((el.textContent || '').trim() === 'Shorts') el.setAttribute('data-ysess-noshorts', '');
    }
  }

  // Short ouvert par lien direct en session « vidéos longues » : lecteur classique.
  // Renvoie true si une redirection est en cours (rien d'autre à faire sur cette page).
  function redirectShortsToWatch() {
    if (state.redirecting) return true;
    if (!isLongMode() || pageType() !== 'shorts') return false;
    state.redirecting = true;
    const id = urlVideoId('shorts');
    location.replace(id ? `/watch?v=${id}` : '/');
    return true;
  }

  let lastRunAt = 0;
  function run() {
    lastRunAt = Date.now();
    if (isRunning()) filterCards();
    else clearFilter();
    markShortsLabels();
  }
  const runIfDue = () => {
    if (Date.now() - lastRunAt >= T.FILTER_EVERY_MS) run();
  };

  // YouTube ajoute des vignettes en continu : on refiltre peu après chaque vague de changements.
  let debounce = null;
  new MutationObserver(() => {
    if (debounce || !isRunning()) return;
    debounce = setTimeout(() => {
      debounce = null;
      run();
    }, T.MUTATION_DEBOUNCE_MS);
  }).observe(html, { childList: true, subtree: true, characterData: true });

  return { run, runIfDue, redirectShortsToWatch };
})();
