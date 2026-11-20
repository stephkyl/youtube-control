'use strict';

// Constantes et utilitaires partagés par tous les scripts de l'extension :
// arrière-plan, scripts injectés dans YouTube, popup, historique.
// eslint-disable-next-line no-var
var YS = (() => {
  // --- Constantes -------------------------------------------------------------
  const config = {
    MIN_DURATION: 1, // minutes
    MAX_DURATION: 1440, // minutes, 1 jour max
    MIN_INTENTION: 10, // caractères
    MAX_INTENTION: 200,
    MODES: ['all', 'long'], // 'all' = shorts et vidéos ; 'long' = vidéos longues uniquement
    // watchSuggestions : 'fit' = suggestions qui tiennent dans la session (la liste raccourcit
    // sans être complétée) ; 'hide' = aucune suggestion pendant la lecture.
    DEFAULT_SETTINGS: { watchSuggestions: 'fit' },
    YOUTUBE_URLS: ['*://www.youtube.com/*', '*://m.youtube.com/*'],
    STATS_PAGE: 'src/stats.html',
  };

  // Types des messages échangés entre les scripts.
  const MSG = {
    START_SESSION: 'START_SESSION',
    END_SESSION: 'END_SESSION',
    VIDEO_STARTED: 'VIDEO_STARTED',
    VIDEO_ENDED: 'VIDEO_ENDED',
    CLOSE_TAB: 'CLOSE_TAB',
    OPEN_STATS: 'OPEN_STATS',
    IS_PLAYING: 'IS_PLAYING', // arrière-plan → onglets YouTube
  };

  // --- Données stockées -------------------------------------------------------
  const withDefaultSettings = (s) => ({ ...config.DEFAULT_SETTINGS, ...s });

  // Les identifiants viennent de la page (URL, lecteur) : on n'accepte que le format YouTube.
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const isValidVideoId = (id) => typeof id === 'string' && VIDEO_ID_RE.test(id);

  // --- Textes -----------------------------------------------------------------
  // Traductions : _locales/en (par défaut) et _locales/fr, selon la langue de Firefox.
  const t = (key, ...subs) => browser.i18n.getMessage(key, subs.map(String));
  const plural = (n, oneKey, manyKey) => (n === 1 ? t(oneKey) : t(manyKey, n));
  const uiLang = browser.i18n.getUILanguage();

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // --- Dates (heure locale) ---------------------------------------------------
  const DAY_MS = 24 * 60 * 60 * 1000;
  const pad = (n) => String(n).padStart(2, '0');

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function midnightOf(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  const fmtClock = (ts) => new Intl.DateTimeFormat(uiLang, { hour: '2-digit', minute: '2-digit' }).format(ts);

  function fmtDayLabel(ts) {
    const today = midnightOf(Date.now());
    const day = midnightOf(ts);
    if (day === today) return t('dayToday');
    if (day === midnightOf(today - DAY_MS / 2)) return t('dayYesterday'); // DAY_MS / 2 : robuste aux changements d'heure
    return new Intl.DateTimeFormat(uiLang, { weekday: 'long', day: 'numeric', month: 'long' }).format(ts);
  }

  // --- Durées et compteurs ----------------------------------------------------
  // "0 min" uniquement pour une durée nulle ; toute durée positive affiche au moins 1 min.
  function fmtSpent(ms) {
    let m = Math.round(Math.max(0, ms) / 60000);
    if (ms > 0 && m === 0) m = 1;
    if (m < 60) return t('minutesShort', m);
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? t('hoursMinutesShort', h, pad(r)) : t('hoursShort', h);
  }

  // Temps restant : toujours en minutes, arrondi au-dessus (jamais de compte à rebours en secondes).
  const minutesLeft = (ms) => Math.max(1, Math.ceil(ms / 60000));
  const fmtLeft = (ms) => t('minutesShort', minutesLeft(ms));

  // Vidéos et/ou shorts : seulement les compteurs non nuls (les vidéos si les deux sont nuls).
  const countsToShow = (nVideos, nShorts) => ({ videos: nVideos > 0 || nShorts === 0, shorts: nShorts > 0 });

  function fmtCounts(nVideos, nShorts) {
    const show = countsToShow(nVideos, nShorts);
    const out = [];
    if (show.videos) out.push(nVideos === 0 ? t('videosNone') : plural(nVideos, 'videosOne', 'videosMany'));
    if (show.shorts) out.push(plural(nShorts, 'shortsOne', 'shortsMany'));
    return out;
  }

  // --- Historique -------------------------------------------------------------
  // Entrée d'historique : { id, startedAt, endedAt, intention, mode, videos, shorts, endReason }
  // (videos/shorts = nombres), la plus récente en premier.

  // Temps passé et nombre de sessions depuis `from` (ex. minuit) : seule la partie de
  // chaque session après cet instant compte (session à cheval sur minuit).
  function totalsSince(history, from) {
    const rows = history.filter((h) => h.endedAt > from);
    const ms = rows.reduce((acc, h) => acc + h.endedAt - Math.max(h.startedAt, from), 0);
    return { ms, sessions: rows.length };
  }

  return {
    config, MSG,
    withDefaultSettings, isValidVideoId,
    t, plural, uiLang, esc,
    DAY_MS, dayKey, midnightOf, fmtClock, fmtDayLabel,
    fmtSpent, minutesLeft, fmtLeft, countsToShow, fmtCounts,
    totalsSince,
  };
})();
