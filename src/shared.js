'use strict';

// Constantes et utilitaires partagés par tous les scripts de l'extension :
// arrière-plan, scripts injectés dans YouTube, popup, historique, réglages.
// eslint-disable-next-line no-var
var YS = (() => {
  // --- Constantes -------------------------------------------------------------
  const config = Object.freeze({
    MIN_DURATION: 1, // minutes
    MAX_DURATION: 180,
    MIN_INTENTION: 10, // caractères
    MAX_INTENTION: 200,
    MODES: Object.freeze(['all', 'long']), // 'all' = shorts et vidéos ; 'long' = vidéos longues uniquement
    // watchSuggestions : 'fit' = suggestions qui tiennent dans la session (la liste raccourcit
    // sans être complétée) ; 'hide' = aucune suggestion pendant la lecture.
    DEFAULT_SETTINGS: Object.freeze({ watchSuggestions: 'fit' }),
    YOUTUBE_URLS: Object.freeze(['*://www.youtube.com/*', '*://m.youtube.com/*']),
    STATS_PAGE: 'src/stats.html',
  });

  // Types des messages échangés entre les scripts.
  const MSG = Object.freeze({
    START_SESSION: 'START_SESSION',
    END_SESSION: 'END_SESSION',
    VIDEO_STARTED: 'VIDEO_STARTED',
    VIDEO_ENDED: 'VIDEO_ENDED',
    CLOSE_TAB: 'CLOSE_TAB',
    OPEN_STATS: 'OPEN_STATS',
    CLEAR_HISTORY: 'CLEAR_HISTORY',
    IS_PLAYING: 'IS_PLAYING', // arrière-plan → onglets YouTube
  });

  // --- Données stockées -------------------------------------------------------
  // Les sessions enregistrées par une version précédente n'ont pas tous les champs :
  // on complète une fois à la lecture, pour que le reste du code puisse s'y fier.
  const normalizeSession = (s) => (s ? { mode: 'all', videos: [], shorts: [], ...s } : null);
  const normalizeHistory = (h) => (Array.isArray(h) ? h : []);
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
  // Entrée d'historique : { id, startedAt, endedAt, durationMin, intention, mode,
  //                         videos, shorts, endReason }  (videos/shorts = nombres)
  function sessionRowHtml(h, { current = false } = {}) {
    const meta = [fmtClock(h.startedAt), fmtSpent(h.endedAt - h.startedAt), ...fmtCounts(h.videos, h.shorts)];
    const tags = [];
    if (current) tags.push(t('histCurrent'));
    if (h.mode === 'long') tags.push(t('modeLong'));
    if (h.endReason === 'manual') tags.push(t('histEarly'));
    return `<li class="hist-row${current ? ' current' : ''}">
      <div class="hist-meta">${esc(meta.join(' · '))}${tags.map((x) => ` <span class="hist-tag">${esc(x)}</span>`).join('')}</div>
      <div class="hist-intent">${esc(t('quote', h.intention))}</div>
    </li>`;
  }

  return {
    config, MSG,
    normalizeSession, normalizeHistory, withDefaultSettings, isValidVideoId,
    t, plural, uiLang, esc,
    DAY_MS, dayKey, midnightOf, fmtClock, fmtDayLabel,
    fmtSpent, minutesLeft, fmtLeft, countsToShow, fmtCounts,
    sessionRowHtml,
  };
})();
