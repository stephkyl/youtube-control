(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Réglages
  // ---------------------------------------------------------------------------
  const DURATIONS = [5, 10, 15, 30, 60];
  const MIN_DURATION = 1;   // durée libre : bornes (en minutes), aussi vérifiées par background.js
  const MAX_DURATION = 180;
  const MIN_INTENTION = 10;              // caractères
  const COUNTDOWN_S = 10;                // temps de réflexion avant de pouvoir démarrer
  const FIT_TOLERANCE_MS = 5000;         // marge pour l'arrondi des durées affichées
  const END_SCREEN_TTL = 30 * 60 * 1000; // l'écran de fin reste affiché 30 min, puis formulaire
  const SCARCE_MS = 2 * 60 * 1000;       // en dessous : on arrête de charger des suggestions
  const LAST_SHORT_THRESHOLD_MS = 2 * 60 * 1000; // short commencé à moins de 2 min de la fin → le dernier

  const html = document.documentElement;
  html.classList.add('ysess-pending');

  let session = null;
  // watchSuggestions : 'fit' = suggestions qui tiennent dans la session (la liste raccourcit
  // sans être complétée) ; 'hide' = aucune suggestion pendant la lecture.
  const DEFAULT_SETTINGS = { watchSuggestions: 'fit' };
  let settings = { ...DEFAULT_SETTINGS };
  let stateLoaded = false;
  let dismissedEndFor = null; // id de session dont l'écran de fin a été quitté dans cet onglet
  let tooLong = null;        // { videoId, videoMs, remainingMs }

  let currentVideoId = null;
  let videoNavAt = 0;
  let checkedVideoId = null;
  let lastTime = 0;
  let shortsFinished = false; // dernier short terminé : plus rien ne doit jouer
  let lastShortFor = null;    // id du short identifié comme le dernier de la session

  const now = () => Date.now();
  const isRunning = () => !!session && (session.status === 'active' || session.status === 'overtime');
  const remainingMs = () => (session && session.status === 'active' ? Math.max(0, session.endsAt - now()) : 0);
  const send = (msg) => browser.runtime.sendMessage(msg).catch(() => undefined);

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Traductions : _locales/en (par défaut) et _locales/fr, selon la langue de Firefox.
  const t = (key, ...subs) => browser.i18n.getMessage(key, subs.map(String));
  const fmtVideos = (n) => (n === 0 ? t('videosNone') : n === 1 ? t('videosOne') : t('videosMany', n));

  function parseTime(t) {
    const parts = t.split(':').map(Number);
    return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
  }

  function fmtSpent(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return t('minutesShort', m);
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? t('hoursMinutesShort', h, String(r).padStart(2, '0')) : t('hoursShort', h);
  }

  // Toujours en minutes, même à la fin : pas de compte à rebours en secondes.
  const minutesLeft = (ms) => Math.max(1, Math.ceil(ms / 60000));
  const fmtLeft = (ms) => t('minutesShort', minutesLeft(ms));

  function pageType() {
    const p = location.pathname;
    if (p === '/watch') return 'watch';
    if (p.startsWith('/shorts/')) return 'shorts';
    return 'other';
  }

  // L'URL est contrôlée par la page : on n'accepte que le format d'un identifiant YouTube.
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  function urlVideoId(type) {
    let id = null;
    if (type === 'watch') id = new URLSearchParams(location.search).get('v');
    else if (type === 'shorts') id = location.pathname.split('/')[2];
    return id && VIDEO_ID_RE.test(id) ? id : null;
  }

  function getPlayer(type) {
    if (type === 'shorts') return document.querySelector('#shorts-player');
    return document.querySelector('#movie_player');
  }

  function getMainVideo(type) {
    if (type === 'shorts') {
      return (
        document.querySelector('#shorts-player video') ||
        document.querySelector('ytd-reel-video-renderer[is-active] video') ||
        document.querySelector('ytd-shorts video')
      );
    }
    return document.querySelector('#movie_player video.html5-main-video') || document.querySelector('#movie_player video');
  }

  const isAdShowing = (type) => !!getPlayer(type)?.classList.contains('ad-showing');

  // L'API du lecteur YouTube vit dans la page ; Firefox y donne accès via wrappedJSObject.
  // Permet de s'assurer que <video> contient bien la nouvelle vidéo après une navigation.
  function playerVideoId(type) {
    try {
      const p = getPlayer(type);
      const data = p && p.wrappedJSObject && p.wrappedJSObject.getVideoData && p.wrappedJSObject.getVideoData();
      // Valeur fournie par la page : traitée comme donnée non fiable.
      const id = data && data.video_id;
      return typeof id === 'string' && VIDEO_ID_RE.test(id) ? id : null;
    } catch (_) {
      return null;
    }
  }

  function pauseAllVideos() {
    for (const v of document.querySelectorAll('video')) if (!v.paused) v.pause();
  }

  // ---------------------------------------------------------------------------
  // Filtrage des suggestions
  // ---------------------------------------------------------------------------
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

  const TIME_RE = /(?:^|\s)((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s|$)/;

  function readCardDuration(card) {
    for (const el of card.querySelectorAll(BADGE_SEL)) {
      const t = (el.textContent || '').trim();
      if (!t || t.length > 24) continue;
      const m = TIME_RE.exec(t);
      if (m) return parseTime(m[1]);
    }
    return null; // inconnu (direct, short, playlist, pas encore chargé) → on laisse affiché
  }

  function readWatchedFraction(card) {
    const el = card.querySelector(PROGRESS_SEL);
    if (!el) return 0;
    const m = /([\d.]+)%/.exec(el.style.width || '');
    return m ? Math.min(100, parseFloat(m[1])) / 100 : 0;
  }

  function filterCards() {
    if (!isRunning()) return;
    const rem = remainingMs();
    html.classList.toggle('ysess-scarce', rem < SCARCE_MS);
    for (const card of document.querySelectorAll(CARD_SEL)) {
      // Ne traiter que la carte la plus externe (ex. ytd-rich-item-renderer > yt-lockup-view-model).
      if (card.parentElement && card.parentElement.closest(CARD_SEL)) continue;
      const duration = readCardDuration(card);
      let hide = false;
      if (duration !== null) {
        const left = duration * (1 - readWatchedFraction(card)); // temps restant si déjà entamée
        hide = left > rem + FIT_TOLERANCE_MS;
      }
      if (hide !== card.hasAttribute('data-ysess-hidden')) card.toggleAttribute('data-ysess-hidden', hide);
    }
  }

  function clearFilter() {
    html.classList.remove('ysess-scarce');
    for (const el of document.querySelectorAll('[data-ysess-hidden]')) el.removeAttribute('data-ysess-hidden');
  }

  let filterTimer = null;
  new MutationObserver(() => {
    if (filterTimer || !isRunning()) return;
    filterTimer = setTimeout(() => {
      filterTimer = null;
      filterCards();
    }, 200);
  }).observe(html, { childList: true, subtree: true, characterData: true });

  // ---------------------------------------------------------------------------
  // Suivi de la vidéo en cours
  // ---------------------------------------------------------------------------
  function trackVideo() {
    const type = pageType();
    const id = urlVideoId(type);

    if (id !== currentVideoId) {
      currentVideoId = id;
      videoNavAt = now();
      checkedVideoId = null;
      lastTime = 0;
      shortsFinished = false;
      lastShortFor = null;
      if (tooLong && tooLong.videoId !== id) tooLong = null;
    }
    if (!id) return;

    const v = getMainVideo(type);
    if (!v) return;

    if (checkedVideoId !== id && Number.isFinite(v.duration) && v.duration > 0 && !isAdShowing(type)) {
      const pid = playerVideoId(type);
      const loaded = pid ? pid === id : now() - videoNavAt > 1200;
      if (loaded) {
        checkedVideoId = id;
        evaluateVideo(type, id, v);
      }
    }

    if (type === 'shorts' && checkedVideoId === id && !shortsFinished) {
      // Temps écoulé alors qu'on n'a pas encore défilé : le short en cours devient le dernier.
      if (lastShortFor !== id && session.status === 'overtime') lastShortFor = id;
      // Filet de sécurité si 'timeupdate' a raté la fin : la boucle a redémarré.
      if (lastShortFor === id && v.currentTime + 0.5 < lastTime) finishLastShort(v);
    }
    if (shortsFinished && !v.paused) v.pause();
    lastTime = v.currentTime;
  }

  function evaluateVideo(type, id, v) {
    if (type === 'shorts') {
      // Un short n'est jamais coupé ni refusé. S'il commence à moins de 2 min de la fin
      // (ou après), c'est le dernier : lu en entier, même au-delà de la session.
      if (session.status === 'overtime' || remainingMs() < LAST_SHORT_THRESHOLD_MS) lastShortFor = id;
      send({ type: 'VIDEO_STARTED', videoId: id });
      return;
    }
    const rate = v.playbackRate || 1;
    const videoMs = Math.max(0, ((v.duration - v.currentTime) * 1000) / rate);
    const rem = remainingMs();
    const fits = session.status === 'active' && videoMs <= rem + FIT_TOLERANCE_MS;
    if (fits) {
      send({ type: 'VIDEO_STARTED', videoId: id });
      return;
    }
    v.pause();
    tooLong = { videoId: id, videoMs, remainingMs: rem };
  }

  // --- Dernier short ----------------------------------------------------------
  // À moins de 2 min de la fin, le défilement reste possible : le short suivant sur
  // lequel on arrive est le dernier. Pendant celui-ci, rien n'apparaît en dessous,
  // le défilement est bloqué, et l'écran de fin s'affiche dès qu'il se termine.

  function finishLastShort(v) {
    if (shortsFinished) return;
    shortsFinished = true;
    v.pause();
    send({ type: 'END_SESSION', reason: 'shorts' });
  }

  const inLastShortMode = () => html.classList.contains('ysess-last-short');

  // Verrou de position : si le fil défile malgré tout (barre de défilement, script de
  // YouTube…), on le remet là où il était. Pendant la première seconde, on suit la
  // position pour laisser l'aimantation (scroll-snap) finir de caler le short.
  const SNAP_SETTLE_MS = 1200;
  let scrollLock = null; // { el, top, since }

  function findFeedScroller() {
    let node = document.querySelector('ytd-reel-video-renderer[is-active]') || getMainVideo('shorts');
    while (node && node !== document.documentElement) {
      const oy = getComputedStyle(node).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
      node = node.parentElement;
    }
    return document.scrollingElement;
  }

  // Repère l'élément du fil qui contient le short en cours, sans dépendre des noms
  // d'éléments de YouTube : on remonte depuis la vidéo jusqu'à un élément haut d'au moins
  // un demi-écran dont un frère du même type est empilé juste en dessous (le short suivant).
  // Les calques du lecteur (contrôles, etc.) se superposent au lieu de s'empiler : ignorés.
  function findCurrentReelItem() {
    let node = getMainVideo('shorts');
    const minHeight = window.innerHeight * 0.5;
    while (node && node.parentElement && node !== document.body) {
      const rect = node.getBoundingClientRect();
      if (rect.height >= minHeight) {
        for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
          if (sib.tagName !== node.tagName) continue;
          const r = sib.getBoundingClientRect();
          if (r.height >= minHeight && r.top >= rect.bottom - 2) return node;
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  // Masque tout ce qui suit le dernier short dans le fil (y compris ce que YouTube ajoute ensuite).
  function hideFollowingReels() {
    const item = findCurrentReelItem();
    if (!item) return;
    for (let sib = item.nextElementSibling; sib; sib = sib.nextElementSibling) {
      if (!sib.hasAttribute('data-ysess-after-last')) sib.setAttribute('data-ysess-after-last', '');
    }
  }

  function showFollowingReels() {
    for (const el of document.querySelectorAll('[data-ysess-after-last]')) el.removeAttribute('data-ysess-after-last');
  }

  function setLastShortMode(on) {
    if (on) hideFollowingReels(); // à chaque passage : le fil peut s'allonger
    if (on === inLastShortMode()) return;
    if (!on) showFollowingReels();
    html.classList.toggle('ysess-last-short', on);
    if (on) {
      const el = findFeedScroller();
      scrollLock = el ? { el, top: el.scrollTop, since: now() } : null;
    } else {
      scrollLock = null;
    }
  }

  document.addEventListener(
    'scroll',
    (e) => {
      if (!scrollLock || !inLastShortMode()) return;
      const el = scrollLock.el;
      const target = e.target === document ? document.scrollingElement : e.target;
      if (target !== el) return;
      if (now() - scrollLock.since < SNAP_SETTLE_MS) scrollLock.top = el.scrollTop;
      else if (Math.abs(el.scrollTop - scrollLock.top) > 1) el.scrollTop = scrollLock.top;
    },
    true
  );

  // Fin du dernier short : on l'arrête juste avant qu'il ne reparte en boucle.
  document.addEventListener(
    'timeupdate',
    (e) => {
      if (!e.isTrusted || shortsFinished || !lastShortFor || lastShortFor !== currentVideoId) return;
      if (pageType() !== 'shorts') return;
      const v = getMainVideo('shorts');
      if (e.target !== v || !Number.isFinite(v.duration)) return;
      if (v.duration - v.currentTime < 0.35) finishLastShort(v);
    },
    true
  );

  // Bloque le passage au short suivant (molette, tactile, clavier), sauf dans le panneau des commentaires.
  const blockFeedScroll = (e) => {
    if (!inLastShortMode()) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target && target.closest('ytd-engagement-panel-section-list-renderer, [data-ysess]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener('wheel', blockFeedScroll, { capture: true, passive: false });
  window.addEventListener('touchmove', blockFeedScroll, { capture: true, passive: false });
  window.addEventListener(
    'keydown',
    (e) => {
      if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(e.key)) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target && target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
      blockFeedScroll(e);
    },
    true
  );

  function disableAutoplay() {
    const btn = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (btn) btn.click();
  }

  function isMainVideoPlaying() {
    const type = pageType();
    if (type === 'other' || overlay || shortsFinished) return false;
    const v = getMainVideo(type);
    return !!v && !v.paused && !v.ended;
  }

  // Les événements média ne remontent pas, mais la phase de capture les voit.
  document.addEventListener(
    'ended',
    (e) => {
      if (!e.isTrusted || !isRunning() || pageType() !== 'watch') return;
      if (e.target !== getMainVideo('watch') || isAdShowing('watch')) return;
      send({ type: 'VIDEO_ENDED' });
    },
    true
  );

  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'IS_PLAYING') return Promise.resolve(isMainVideoPlaying());
    return undefined;
  });

  // ---------------------------------------------------------------------------
  // Overlays (Shadow DOM pour être isolé du CSS de YouTube)
  // ---------------------------------------------------------------------------
  let overlay = null; // { host, view, cleanup }

  function mountOverlay(view, build) {
    if (overlay && overlay.view === view && overlay.host.isConnected) return;
    unmountOverlay();
    const host = document.createElement('div');
    host.setAttribute('data-ysess', 'overlay');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    // Empêche les raccourcis clavier / la molette de YouTube (navigation Shorts, etc.).
    for (const t of ['keydown', 'keyup', 'keypress', 'wheel', 'touchmove']) {
      host.addEventListener(t, (e) => e.stopPropagation());
    }
    // 'closed' : les scripts de YouTube ne peuvent pas lire le contenu (intention, bilan).
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${OVERLAY_CSS}</style>`;
    const screen = document.createElement('div');
    screen.className = `screen screen-${view}`;
    root.appendChild(screen);
    html.appendChild(host);
    html.classList.add('ysess-locked');
    overlay = { host, view, cleanup: null };
    overlay.cleanup = build(screen) || null;
  }

  function unmountOverlay() {
    if (!overlay) return;
    if (overlay.cleanup) overlay.cleanup();
    overlay.host.remove();
    overlay = null;
    html.classList.remove('ysess-locked');
  }

  // --- Démarrage : intention + durée + temps de réflexion --------------------
  function buildStart(screen) {
    let duration = null;
    let customDuration = ''; // texte saisi dans le champ de durée libre
    let intention = '';
    let timer = null;
    let onVisibility = null;

    const stopTimer = () => {
      clearInterval(timer);
      timer = null;
      if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
      onVisibility = null;
    };

    function renderForm() {
      stopTimer();
      screen.innerHTML = `
        <div class="card">
          <div class="eyebrow">${esc(t('startEyebrow'))}</div>
          <h1>${esc(t('startTitle'))}</h1>
          <p class="lead">${esc(t('startLead'))}</p>
          <div class="field">
            <div class="label">${esc(t('startDurationLabel'))}</div>
            <div class="chips">
              ${DURATIONS.map((d) => `<button type="button" class="chip" data-d="${d}" aria-pressed="${d === duration && !customDuration}">${esc(t('minutesShort', d))}</button>`).join('')}
              <label class="chip custom">
                <input type="number" id="custom" inputmode="numeric" min="${MIN_DURATION}" max="${MAX_DURATION}" step="1"
                  placeholder="${esc(t('startCustomPlaceholder'))}" aria-label="${esc(t('startCustomLabel'))}">
                <span>min</span>
              </label>
            </div>
          </div>
          <div class="field">
            <label class="label" for="intent">${esc(t('startIntentionLabel'))}</label>
            <textarea id="intent" rows="2" maxlength="200" placeholder="${esc(t('startIntentionPlaceholder'))}"></textarea>
            <div class="hint" id="hint"></div>
          </div>
          <button type="button" class="primary" id="go" disabled>${esc(t('startCommit'))}</button>
        </div>`;

      const $ = (s) => screen.querySelector(s);
      const ta = $('#intent');
      const custom = $('#custom');
      const customChip = screen.querySelector('.chip.custom');
      const presetChips = [...screen.querySelectorAll('.chip[data-d]')];
      ta.value = intention;
      custom.value = customDuration;
      customChip.classList.toggle('active', !!customDuration);

      const update = () => {
        intention = ta.value;
        const missing = MIN_INTENTION - intention.trim().length;
        const badCustom = customDuration !== '' && duration === null;
        $('#hint').textContent = badCustom
          ? t('startCustomRange', MIN_DURATION, MAX_DURATION)
          : missing <= 0
            ? ''
            : missing === 1
              ? t('startHintOne')
              : t('startHintMany', missing);
        $('#go').disabled = !(duration && missing <= 0);
      };
      for (const chip of presetChips) {
        chip.addEventListener('click', () => {
          duration = Number(chip.dataset.d);
          customDuration = '';
          custom.value = '';
          customChip.classList.remove('active');
          for (const c of presetChips) c.setAttribute('aria-pressed', String(c === chip));
          update();
        });
      }
      // Durée libre : saisir une valeur désélectionne les durées proposées.
      custom.addEventListener('input', () => {
        customDuration = custom.value.trim();
        const n = Number(customDuration);
        duration = Number.isInteger(n) && n >= MIN_DURATION && n <= MAX_DURATION ? n : null;
        if (!customDuration) duration = null;
        customChip.classList.toggle('active', !!customDuration);
        for (const c of presetChips) c.setAttribute('aria-pressed', 'false');
        update();
      });
      ta.addEventListener('input', update);
      $('#go').addEventListener('click', renderConfirm);
      update();
    }

    function renderConfirm() {
      stopTimer();
      screen.innerHTML = `
        <div class="card center">
          <div class="eyebrow">${esc(t('confirmEyebrow'))}</div>
          <h1>${esc(duration === 1 ? t('confirmTitleOne') : t('confirmTitle', duration))}</h1>
          <p class="quote" id="quote"></p>
          <div class="ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle class="ring-bg" cx="60" cy="60" r="52"/>
              <circle class="ring-fg" cx="60" cy="60" r="52" style="animation-duration:${COUNTDOWN_S}s"/>
            </svg>
            <span id="count">${COUNTDOWN_S}</span>
          </div>
          <p class="lead small" id="msg">${esc(t('confirmPrompt'))}</p>
          <button type="button" class="primary" id="start" disabled>${esc(t('confirmWait'))}</button>
          <button type="button" class="link" id="back">${esc(t('confirmBack'))}</button>
        </div>`;

      const $ = (s) => screen.querySelector(s);
      // textContent : le texte saisi n'est jamais interprété comme du HTML.
      $('#quote').textContent = t('quote', intention.trim());
      let left = COUNTDOWN_S;
      timer = setInterval(() => {
        left -= 1;
        $('#count').textContent = String(Math.max(0, left));
        if (left <= 0) {
          stopTimer();
          $('#start').disabled = false;
          $('#start').textContent = t('confirmStart');
          $('#msg').textContent = t('confirmReady');
          screen.querySelector('.ring').classList.add('done');
        }
      }, 1000);
      // Quitter l'onglet pendant la réflexion remet le compteur à zéro.
      onVisibility = () => {
        if (document.hidden) renderConfirm();
      };
      document.addEventListener('visibilitychange', onVisibility);

      $('#back').addEventListener('click', renderForm);
      $('#start').addEventListener('click', async () => {
        $('#start').disabled = true;
        await send({ type: 'START_SESSION', durationMin: duration, intention });
      });
    }

    renderForm();
    return stopTimer;
  }

  // --- Fin de session ---------------------------------------------------------
  function buildEnd(screen) {
    const s = session;
    const early = s.endReason === 'manual';
    const title = early ? t(pick(['endEarly1', 'endEarly2'])) : t(pick(['endTitle1', 'endTitle2', 'endTitle3', 'endTitle4']));
    const next = t(pick(['endNext1', 'endNext2', 'endNext3', 'endNext4', 'endNext5']));
    const stats = t('endStats', fmtVideos((s.videos || []).length), fmtSpent(s.endedAt - s.startedAt), s.durationMin);
    const particles = Array.from({ length: 18 }, () => {
      const left = Math.round(Math.random() * 100);
      const delay = (Math.random() * 4).toFixed(2);
      const dur = (6 + Math.random() * 6).toFixed(2);
      const size = (3 + Math.random() * 5).toFixed(1);
      return `<span class="p" style="left:${left}%;animation-delay:${delay}s;animation-duration:${dur}s;width:${size}px;height:${size}px"></span>`;
    }).join('');

    screen.innerHTML = `
      <div class="particles" aria-hidden="true">${particles}</div>
      <div class="card center end">
        <svg class="check" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="check-circle" cx="60" cy="60" r="52"/>
          <path class="check-mark" d="M38 62 L54 77 L84 45"/>
        </svg>
        <h1 class="fade d1">${esc(title)}</h1>
        <p class="stats fade d2">${esc(stats)}</p>
        <p class="quote fade d3" id="quote"></p>
        <p class="lead fade d4">${esc(next)}</p>
        <button type="button" class="primary fade d5" id="close">${esc(t('endClose'))}</button>
        <button type="button" class="link fade d5" id="again">${esc(t('endAgain'))}</button>
      </div>`;

    screen.querySelector('#quote').textContent = t('endIntention', s.intention);
    screen.querySelector('#close').addEventListener('click', () => send({ type: 'CLOSE_TAB' }));
    // Mène au formulaire de démarrage (intention + temps de réflexion), pas directement à YouTube.
    screen.querySelector('#again').addEventListener('click', () => {
      dismissedEndFor = s.id;
      render();
    });
  }

  // --- Vidéo trop longue ------------------------------------------------------
  function buildTooLong(screen) {
    const info = tooLong;
    const overtime = session.status !== 'active';
    const detail = overtime ? t('tooLongOvertime') : t('tooLongDetail', fmtLeft(info.videoMs), fmtLeft(info.remainingMs));
    screen.innerHTML = `
      <div class="card center">
        <div class="eyebrow">${esc(t('tooLongEyebrow'))}</div>
        <h1>${esc(t('tooLongTitle'))}</h1>
        <p class="lead">${esc(detail)}</p>
        <div class="row">
          <button type="button" class="secondary" id="back">${esc(t('tooLongBack'))}</button>
          <button type="button" class="primary" id="home">${esc(t('tooLongHome'))}</button>
        </div>
      </div>`;
    screen.querySelector('#back').addEventListener('click', () => history.back());
    screen.querySelector('#home').addEventListener('click', () => {
      location.href = '/';
    });
  }

  // ---------------------------------------------------------------------------
  // Pastille de temps restant
  // ---------------------------------------------------------------------------
  let pill = null;
  function updatePill() {
    if (!isRunning() || overlay) {
      if (pill) pill.host.remove();
      pill = null;
      return;
    }
    if (!pill || !pill.host.isConnected) {
      const host = document.createElement('div');
      host.setAttribute('data-ysess', 'pill');
      host.style.cssText = 'all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483646;pointer-events:none;';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>${PILL_CSS}</style><div class="pill"><span class="dot"></span><span class="txt"></span></div>`;
      html.appendChild(host);
      pill = { host, txt: root.querySelector('.txt'), box: root.querySelector('.pill') };
    }
    const m = minutesLeft(remainingMs());
    const onLastShort = pageType() === 'shorts' && !!lastShortFor && lastShortFor === currentVideoId;
    const text = onLastShort
      ? t('lastShort')
      : session.status === 'overtime'
        ? t('lastVideo')
        : m === 1
          ? t('pillLeftOne')
          : t('pillLeftMany', m);
    if (pill.txt.textContent !== text) pill.txt.textContent = text;
    pill.box.classList.toggle('low', session.status === 'overtime' || remainingMs() < 5 * 60 * 1000);
  }

  // ---------------------------------------------------------------------------
  // Boucle principale
  // ---------------------------------------------------------------------------
  function desiredView() {
    if (!session) return 'start';
    if (session.status === 'ended') {
      const recent = now() - session.endedAt < END_SCREEN_TTL;
      return recent && dismissedEndFor !== session.id ? 'end' : 'start';
    }
    if (tooLong && tooLong.videoId === currentVideoId) return 'toolong';
    return null;
  }

  let tickCount = 0;
  function render() {
    if (!stateLoaded) return;
    tickCount += 1;

    const running = isRunning();
    html.classList.toggle('ysess-hide-related', running && settings.watchSuggestions === 'hide');
    html.classList.toggle('ysess-freeze-related', running && settings.watchSuggestions === 'fit');
    setLastShortMode(running && pageType() === 'shorts' && !!lastShortFor && lastShortFor === currentVideoId);

    if (running) {
      trackVideo();
      disableAutoplay();
      if (tickCount % 4 === 0) filterCards(); // les durées baissent avec le temps
    } else {
      clearFilter();
    }

    const view = desiredView();
    if (view === 'start') mountOverlay('start', buildStart);
    else if (view === 'end') mountOverlay('end', buildEnd);
    else if (view === 'toolong') mountOverlay('toolong', buildTooLong);
    else unmountOverlay();

    if (view) pauseAllVideos();
    updatePill();
  }

  browser.storage.local.get(['session', 'settings']).then((r) => {
    session = r.session || null;
    settings = { ...DEFAULT_SETTINGS, ...r.settings };
    stateLoaded = true;
    render();
    filterCards();
    html.classList.remove('ysess-pending');
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
      render();
    }
    if (!changes.session) return;
    const prev = session;
    session = changes.session.newValue || null;
    if (!prev || !session || prev.id !== session.id) {
      // Nouvelle session : on réévalue la vidéo affichée.
      checkedVideoId = null;
      tooLong = null;
      shortsFinished = false;
    }
    render();
    filterCards();
  });

  setInterval(render, 500);

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  const OVERLAY_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .screen {
      position: fixed; inset: 0; overflow: auto;
      display: grid; place-items: center; padding: 24px 16px;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #eef0f6; -webkit-font-smoothing: antialiased;
      background:
        radial-gradient(1100px 800px at 15% 10%, #26345e 0%, transparent 60%),
        radial-gradient(900px 700px at 90% 95%, #3a2a55 0%, transparent 55%),
        #10121a;
    }
    .screen-end {
      background:
        radial-gradient(1000px 800px at 20% 0%, #1f5a52 0%, transparent 60%),
        radial-gradient(900px 700px at 90% 100%, #6a4a2a 0%, transparent 55%),
        #0f1716;
    }
    .card {
      position: relative; z-index: 1;
      width: min(560px, 100%);
      background: rgba(255,255,255,.045);
      border: 1px solid rgba(255,255,255,.09);
      border-radius: 22px; padding: 36px 32px;
      box-shadow: 0 30px 80px rgba(0,0,0,.35);
      animation: rise .55s cubic-bezier(.2,.8,.2,1) both;
    }
    .center { text-align: center; }
    .eyebrow { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: #9aa6c9; margin-bottom: 12px; }
    h1 { font-size: 27px; line-height: 1.25; margin: 0 0 12px; font-weight: 650; letter-spacing: -.01em; }
    .lead { color: #b9c0d6; font-size: 15px; line-height: 1.55; margin: 0 0 26px; }
    .lead.small { font-size: 14px; margin-bottom: 20px; }
    .quote { font-size: 16px; line-height: 1.5; color: #f3e3b5; margin: 0 0 22px; font-style: italic; overflow-wrap: anywhere; }
    .stats { font-size: 14px; color: #a9c9c1; margin: 0 0 18px; letter-spacing: .02em; }
    .field { margin-bottom: 22px; }
    .label { display: block; font-size: 13px; font-weight: 600; color: #cdd3e6; margin-bottom: 10px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      font: inherit; font-size: 14px; padding: 9px 15px; border-radius: 999px;
      border: 1px solid rgba(255,255,255,.16); background: transparent; color: #e3e7f3;
      cursor: pointer; transition: background .15s, border-color .15s, color .15s;
    }
    .chip:hover { border-color: rgba(255,255,255,.4); }
    .chip[aria-pressed="true"] { background: #e9c46a; border-color: #e9c46a; color: #1b1d27; font-weight: 600; }
    .chip.custom { display: inline-flex; align-items: center; gap: 4px; padding: 5px 14px 5px 10px; cursor: text; }
    .chip.custom:focus-within, .chip.custom.active { border-color: #e9c46a; }
    .chip.custom input {
      width: 5.5em; font: inherit; font-size: 14px; padding: 4px 6px; border: 0; border-radius: 6px;
      background: rgba(0,0,0,.25); color: #eef0f6; outline: none; -moz-appearance: textfield; text-align: right;
    }
    .chip.custom input::placeholder { color: #6f7895; text-align: left; }
    .chip.custom span { color: #b9c0d6; }
    textarea {
      width: 100%; font: inherit; font-size: 15px; line-height: 1.5; padding: 12px 14px;
      border-radius: 12px; border: 1px solid rgba(255,255,255,.16); background: rgba(0,0,0,.25);
      color: #eef0f6; resize: vertical; outline: none;
    }
    textarea:focus { border-color: #e9c46a; }
    textarea::placeholder { color: #6f7895; }
    .hint { font-size: 12px; color: #8d96b3; margin-top: 8px; min-height: 1.2em; }
    .primary, .secondary {
      font: inherit; font-size: 15px; font-weight: 600; width: 100%; padding: 14px 18px;
      border-radius: 12px; cursor: pointer; transition: opacity .2s, transform .1s;
    }
    .primary { border: 0; background: #e9c46a; color: #1b1d27; }
    .secondary { border: 1px solid rgba(255,255,255,.2); background: transparent; color: #e3e7f3; }
    .primary:active, .secondary:active { transform: scale(.99); }
    .primary:disabled { opacity: .35; cursor: not-allowed; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; }
    .row > * { flex: 1 1 180px; }
    .link {
      display: inline-block; font: inherit; font-size: 13px; background: none; border: 0; color: #8d96b3;
      cursor: pointer; text-decoration: underline; text-underline-offset: 3px; padding: 8px; margin-top: 12px;
    }
    .screen-end .primary { background: #9fe0c9; }

    /* Compte à rebours */
    .ring { position: relative; width: 120px; height: 120px; margin: 4px auto 18px; }
    .ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .ring circle { fill: none; stroke-width: 6; }
    .ring-bg { stroke: rgba(255,255,255,.1); }
    .ring-fg { stroke: #e9c46a; stroke-linecap: round; stroke-dasharray: 327; stroke-dashoffset: 327; animation: fill linear forwards; }
    .ring span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 34px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .ring.done span { color: #e9c46a; }

    /* Écran de fin */
    .check { width: 104px; height: 104px; margin: 0 auto 18px; display: block; }
    .check-circle { fill: rgba(159,224,201,.08); stroke: #9fe0c9; stroke-width: 5; stroke-dasharray: 327; stroke-dashoffset: 327;
      transform-origin: center; transform: rotate(-90deg); animation: fill 1s cubic-bezier(.65,0,.35,1) .15s forwards, glow 3.5s ease-in-out 1.6s infinite; }
    .check-mark { fill: none; stroke: #9fe0c9; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round;
      stroke-dasharray: 80; stroke-dashoffset: 80; animation: fill .5s cubic-bezier(.65,0,.35,1) 1s forwards; }
    .fade { opacity: 0; animation: rise .7s cubic-bezier(.2,.8,.2,1) forwards; }
    .d1 { animation-delay: 1.2s; } .d2 { animation-delay: 1.45s; } .d3 { animation-delay: 1.7s; }
    .d4 { animation-delay: 1.95s; } .d5 { animation-delay: 2.3s; }
    .particles { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
    .p { position: absolute; bottom: -12px; border-radius: 50%; background: rgba(243,227,181,.55); filter: blur(.5px);
      animation: float linear infinite; opacity: 0; }

    @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @keyframes fill { to { stroke-dashoffset: 0; } }
    @keyframes glow { 0%, 100% { filter: drop-shadow(0 0 0 rgba(159,224,201,0)); } 50% { filter: drop-shadow(0 0 14px rgba(159,224,201,.45)); } }
    @keyframes float { 0% { transform: translateY(0); opacity: 0; } 15% { opacity: .9; } 100% { transform: translateY(-105vh); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; }
      .p { display: none; }
    }
  `;

  const PILL_CSS = `
    .pill {
      display: inline-flex; align-items: center; gap: 8px;
      font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #eef0f6; background: rgba(16,18,26,.82); border: 1px solid rgba(255,255,255,.12);
      padding: 8px 12px; border-radius: 999px; box-shadow: 0 6px 20px rgba(0,0,0,.25);
      font-variant-numeric: tabular-nums;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #9fe0c9; }
    .low .dot { background: #e9c46a; }
  `;
})();
