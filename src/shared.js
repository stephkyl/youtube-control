'use strict';

// Constants and helpers shared by all of the extension's scripts:
// background, scripts injected into YouTube, popup, history page.
// eslint-disable-next-line no-var
var YS = (() => {
  // --- Constants --------------------------------------------------------------
  const config = {
    MIN_DURATION: 1, // minutes
    MAX_DURATION: 1440, // minutes, 1 day max
    MIN_INTENTION: 10, // characters
    MAX_INTENTION: 200,
    // 'all' = shorts and videos; 'long' = long videos only;
    // 'one' = a single video, no time limit (no duration, endsAt = null).
    MODES: ['all', 'long', 'one'],
    // watchSuggestions: 'fit' = suggestions that fit in the session (the list shrinks
    // without being refilled); 'hide' = no suggestions while watching.
    DEFAULT_SETTINGS: { watchSuggestions: 'fit' },
    YOUTUBE_URLS: ['*://www.youtube.com/*', '*://m.youtube.com/*'],
    STATS_PAGE: 'src/stats.html',
  };

  // Types of the messages exchanged between scripts.
  const MSG = {
    START_SESSION: 'START_SESSION',
    END_SESSION: 'END_SESSION',
    VIDEO_STARTED: 'VIDEO_STARTED',
    VIDEO_ENDED: 'VIDEO_ENDED',
    CLOSE_TAB: 'CLOSE_TAB',
    OPEN_STATS: 'OPEN_STATS',
    IS_PLAYING: 'IS_PLAYING', // background → YouTube tabs
  };

  // --- Stored data ------------------------------------------------------------
  const withDefaultSettings = (s) => ({ ...config.DEFAULT_SETTINGS, ...s });

  // IDs come from the page (URL, player): only the YouTube format is accepted.
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const isValidVideoId = (id) => typeof id === 'string' && VIDEO_ID_RE.test(id);

  // --- Text -------------------------------------------------------------------
  // Translations: _locales/en (default) and _locales/fr, depending on Firefox's language.
  const t = (key, ...subs) => browser.i18n.getMessage(key, subs.map(String));
  const plural = (n, oneKey, manyKey) => (n === 1 ? t(oneKey) : t(manyKey, n));
  const MODE_LABELS = { all: 'modeAll', long: 'modeLong', one: 'modeOne' };
  const modeLabel = (mode) => t(MODE_LABELS[mode]);
  const uiLang = browser.i18n.getUILanguage();

  // --- DOM --------------------------------------------------------------------
  // Builds elements without ever parsing HTML (no innerHTML): strings are always inserted
  // as text, so data from the page or the user (intention…) can never become markup.
  // Attributes: `on<event>` adds a listener; null/undefined/false skip the attribute, true sets
  // it empty (pass String(bool) for aria-* values). Children: strings, numbers, nodes or
  // (nested) arrays; null/undefined/false are skipped.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function fill(el, attrs, children) {
    for (const [name, value] of Object.entries(attrs ?? {})) {
      if (value === null || value === undefined || value === false) continue;
      if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
      else el.setAttribute(name, value === true ? '' : String(value));
    }
    el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
    return el;
  }
  const h = (tag, attrs, ...children) => fill(document.createElement(tag), attrs, children);
  const svg = (tag, attrs, ...children) => fill(document.createElementNS(SVG_NS, tag), attrs, children);

  // --- Dates (local time) -----------------------------------------------------
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
    if (day === midnightOf(today - DAY_MS / 2)) return t('dayYesterday'); // DAY_MS / 2: robust to DST changes
    return new Intl.DateTimeFormat(uiLang, { weekday: 'long', day: 'numeric', month: 'long' }).format(ts);
  }

  // --- Durations and counts ---------------------------------------------------
  // "0 min" only for a zero duration; any positive duration shows at least 1 min.
  function fmtSpent(ms) {
    let m = Math.round(Math.max(0, ms) / 60000);
    if (ms > 0 && m === 0) m = 1;
    if (m < 60) return t('minutesShort', m);
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? t('hoursMinutesShort', h, pad(r)) : t('hoursShort', h);
  }

  // Time left: always in minutes, rounded up (never a countdown in seconds).
  const minutesLeft = (ms) => Math.max(1, Math.ceil(ms / 60000));
  const fmtLeft = (ms) => t('minutesShort', minutesLeft(ms));

  // Videos and/or shorts: only non-zero counts (videos if both are zero).
  const countsToShow = (nVideos, nShorts) => ({ videos: nVideos > 0 || nShorts === 0, shorts: nShorts > 0 });

  function fmtCounts(nVideos, nShorts) {
    const show = countsToShow(nVideos, nShorts);
    const out = [];
    if (show.videos) out.push(nVideos === 0 ? t('videosNone') : plural(nVideos, 'videosOne', 'videosMany'));
    if (show.shorts) out.push(plural(nShorts, 'shortsOne', 'shortsMany'));
    return out;
  }

  // --- History ----------------------------------------------------------------
  // History entry: { id, startedAt, endedAt, intention, mode, videos, shorts, endReason }
  // (videos/shorts = counts), most recent first.

  // Time spent and number of sessions since `from` (e.g. midnight): only the part of
  // each session after that moment counts (sessions spanning midnight).
  function totalsSince(history, from) {
    const rows = history.filter((h) => h.endedAt > from);
    const ms = rows.reduce((acc, h) => acc + h.endedAt - Math.max(h.startedAt, from), 0);
    return { ms, sessions: rows.length };
  }

  return {
    config, MSG,
    withDefaultSettings, isValidVideoId,
    t, plural, modeLabel, uiLang, h, svg,
    DAY_MS, dayKey, midnightOf, fmtClock, fmtDayLabel,
    fmtSpent, minutesLeft, fmtLeft, countsToShow, fmtCounts,
    totalsSince,
  };
})();
