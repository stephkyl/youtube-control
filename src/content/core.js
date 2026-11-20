'use strict';

// Socle des scripts injectés dans YouTube : délais et seuils, état partagé, accès au lecteur.
// Les autres fichiers de src/content/ ajoutent leur partie à YSC (YSC.filter, YSC.shorts…),
// et main.js orchestre le tout. Ordre de chargement : voir manifest.json.
// eslint-disable-next-line no-var
var YSC = (() => {
  // Évite d'apercevoir YouTube avant de savoir si une session est en cours (content.css).
  document.documentElement.classList.add('ysess-pending');

  // Délais et seuils (ms, sauf mention contraire).
  const T = Object.freeze({
    COUNTDOWN_S: 10, // réflexion avant de pouvoir démarrer (s)
    FIT_TOLERANCE_MS: 5000, // marge pour l'arrondi des durées affichées
    END_SCREEN_TTL_MS: 60 * 1000, // l'écran de fin reste affiché 1 min, puis formulaire
    SCARCE_MS: 2 * 60 * 1000, // en dessous : on arrête de charger des suggestions
    LAST_SHORT_THRESHOLD_MS: 2 * 60 * 1000, // short commencé à moins de 2 min de la fin → le dernier
    PLAYER_SETTLE_MS: 1200, // sans API du lecteur : délai avant de se fier à <video> après navigation
    SHORT_END_MARGIN_S: 0.35, // arrêt du dernier short juste avant sa fin (s)
    LOOP_RESTART_S: 0.5, // recul de lecture qui signale qu'un short a bouclé (s)
    SNAP_SETTLE_MS: 1200, // laisse le fil des Shorts se caler avant de verrouiller sa position
    STACK_TOLERANCE_PX: 2, // tolérance pour reconnaître deux shorts empilés
    PILL_LOW_MS: 5 * 60 * 1000, // pastille en couleur d'alerte en dessous
    PILL_CONFIRM_MS: 8000, // la confirmation de la pastille se replie toute seule
    BADGE_MAX_CHARS: 24, // au-delà, le texte d'un badge n'est pas une durée
    REFRESH_MS: 500, // rafraîchissement périodique
    URL_POLL_MS: 100, // détection rapide des changements d'URL (passage d'un short à l'autre)
    FILTER_EVERY_MS: 2000, // refiltrage périodique : les durées restantes baissent
    MUTATION_DEBOUNCE_MS: 200,
  });

  const newVideoState = (id, { lastShort = false } = {}) => ({
    id, // identifiant de la vidéo affichée (d'après l'URL), ou null
    navAt: Date.now(), // arrivée sur cette vidéo
    checked: false, // durée lue et vidéo évaluée
    lastTime: 0, // dernière position de lecture observée (détection de boucle)
    lastShort, // ce short est le dernier de la session
    finished: false, // dernier short terminé : plus rien ne doit jouer
    tooLong: null, // { videoMs, remainingMs } si la vidéo ne tient pas dans la session
  });

  const state = {
    session: null,
    settings: YS.withDefaultSettings(),
    loaded: false,
    dismissedEndFor: null, // id de session dont l'écran de fin a été quitté dans cet onglet
    redirecting: false, // redirection short → lecteur classique en cours
    overlay: null, // écran plein page affiché : { host, view, cleanup }
    video: newVideoState(null),
  };

  // Nouvelle vidéo ou nouvelle session : tout l'état lié à la vidéo repart de zéro, ici et nulle part ailleurs.
  function resetVideoState(id, options) {
    state.video = newVideoState(id, options);
  }

  // --- Session ----------------------------------------------------------------
  const isRunning = () => state.session?.status === 'active' || state.session?.status === 'overtime';
  const isOvertime = () => state.session?.status === 'overtime';
  const isLongMode = () => isRunning() && state.session.mode === 'long';
  const remainingMs = () => (state.session?.status === 'active' ? Math.max(0, state.session.endsAt - Date.now()) : 0);
  const send = (msg) => browser.runtime.sendMessage(msg).catch(() => undefined);

  // --- Page et lecteur --------------------------------------------------------
  function pageType() {
    const path = location.pathname;
    if (path === '/watch') return 'watch';
    if (path.startsWith('/shorts/')) return 'shorts';
    return 'other';
  }

  function urlVideoId(type) {
    let id = null;
    if (type === 'watch') id = new URLSearchParams(location.search).get('v');
    else if (type === 'shorts') id = location.pathname.split('/')[2];
    return YS.isValidVideoId(id) ? id : null;
  }

  const isOnLastShort = () => pageType() === 'shorts' && !!state.video.id && state.video.lastShort;

  const getPlayer = (type) => document.querySelector(type === 'shorts' ? '#shorts-player' : '#movie_player');

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
      const id = getPlayer(type)?.wrappedJSObject?.getVideoData?.()?.video_id;
      return YS.isValidVideoId(id) ? id : null; // valeur fournie par la page : non fiable
    } catch (_) {
      return null;
    }
  }

  function pauseAllVideos() {
    for (const v of document.querySelectorAll('video')) if (!v.paused) v.pause();
  }

  return {
    T, state, resetVideoState,
    isRunning, isOvertime, isLongMode, remainingMs, send,
    pageType, urlVideoId, isOnLastShort, getPlayer, getMainVideo, isAdShowing, playerVideoId, pauseAllVideos,
  };
})();
