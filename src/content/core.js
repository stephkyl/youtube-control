'use strict';

// Base of the scripts injected into YouTube: delays and thresholds, shared state, player access.
// The other files in src/content/ add their part to YSC (YSC.filter, YSC.shorts…),
// and main.js orchestrates everything. Load order: see manifest.json.
// eslint-disable-next-line no-var
var YSC = (() => {
  // Avoids showing YouTube before we know whether a session is running (content.css).
  document.documentElement.classList.add('ysess-pending');

  // Delays and thresholds (ms unless stated otherwise).
  const T = {
    COUNTDOWN_S: 10, // thinking time before starting is allowed (s)
    FIT_TOLERANCE_MS: 5000, // margin for rounding of displayed durations
    END_SCREEN_TTL_MS: 60 * 1000, // the end screen stays 1 min, then the start form
    LAST_SHORT_THRESHOLD_MS: 2 * 60 * 1000, // short started less than 2 min before the end → the last one
    PLAYER_SETTLE_MS: 1200, // without the player API: delay before trusting <video> after navigation
    SHORT_END_MARGIN_S: 0.35, // stop the last short just before its end (s)
    LOOP_RESTART_S: 0.5, // playback jump back that signals a short has looped (s)
    SNAP_SETTLE_MS: 1200, // let the Shorts feed snap into place before locking its position
    STACK_TOLERANCE_PX: 2, // tolerance for recognizing two stacked shorts
    PILL_LOW_MS: 5 * 60 * 1000, // pill in warning color below this
    PILL_CONFIRM_MS: 8000, // the pill's confirmation closes by itself
    BADGE_MAX_CHARS: 24, // beyond this, a badge's text is not a duration
    REFRESH_MS: 500, // periodic refresh
    URL_POLL_MS: 100, // fast detection of URL changes (moving from one short to the next)
    FILTER_EVERY_MS: 2000, // periodic refiltering: remaining time keeps decreasing
    MUTATION_DEBOUNCE_MS: 200,
  };

  const newVideoState = (id, { lastShort = false } = {}) => ({
    id, // ID of the displayed video (from the URL), or null
    navAt: Date.now(), // arrival on this video
    checked: false, // duration read and video judged
    lastTime: 0, // last observed playback position (loop detection)
    lastShort, // this short is the session's last one
    finished: false, // last short finished: nothing must play anymore
    tooLong: null, // { videoMs, remainingMs } if the video doesn't fit in the session
  });

  const state = {
    session: null,
    settings: YS.withDefaultSettings(),
    loaded: false,
    dismissedEndFor: null, // ID of the session whose end screen was dismissed in this tab
    redirecting: false, // short → classic player redirect in progress
    overlay: null, // full-page screen shown: { host, view, cleanup }
    video: newVideoState(null),
  };

  // New video or new session: all video-related state starts over, here and nowhere else.
  function resetVideoState(id, options) {
    state.video = newVideoState(id, options);
  }

  // --- Session ----------------------------------------------------------------
  const isRunning = () => state.session?.status === 'active' || state.session?.status === 'overtime';
  const isOvertime = () => state.session?.status === 'overtime';
  const isOneVideo = () => isRunning() && state.session.mode === 'one'; // a single video, no time limit
  const hidesShorts = () => isRunning() && state.session.mode !== 'all'; // 'long' and 'one'
  // Time left; 0 outside a session and in mode 'one' (no end time).
  const remainingMs = () =>
    state.session?.status === 'active' && state.session.endsAt ? Math.max(0, state.session.endsAt - Date.now()) : 0;

  // Mode 'one', video already chosen, and the displayed page is not that video.
  function isAwayFromChosenVideo() {
    const chosen = isOneVideo() && state.session.chosenVideo;
    return Boolean(chosen) && !(pageType() === 'watch' && urlVideoId('watch') === chosen);
  }
  const send = (msg) => browser.runtime.sendMessage(msg).catch(() => undefined);

  // --- Page and player --------------------------------------------------------
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

  // The YouTube player API lives in the page; Firefox gives access to it via wrappedJSObject.
  // Used to make sure <video> really holds the new video after a navigation.
  function playerVideoId(type) {
    try {
      const id = getPlayer(type)?.wrappedJSObject?.getVideoData?.()?.video_id;
      return YS.isValidVideoId(id) ? id : null; // value provided by the page: untrusted
    } catch (_) {
      return null;
    }
  }

  function pauseAllVideos() {
    for (const v of document.querySelectorAll('video')) if (!v.paused) v.pause();
  }

  return {
    T, state, resetVideoState,
    isRunning, isOvertime, isOneVideo, hidesShorts, isAwayFromChosenVideo, remainingMs, send,
    pageType, urlVideoId, isOnLastShort, getPlayer, getMainVideo, isAdShowing, playerVideoId, pauseAllVideos,
  };
})();
