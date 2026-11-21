'use strict';

// Entry point of the scripts injected into YouTube: loads the state, follows its changes
// and refreshes the page. Everything goes through refresh().
(() => {
  const { MSG } = YS;
  const { T, state, resetVideoState, isRunning, isOneVideo, hidesShorts, isAwayFromChosenVideo, pauseAllVideos } = YSC;
  const html = document.documentElement;

  // Full-page screen to show, or null.
  function desiredView() {
    const { session } = state;
    if (!session) return 'start';
    if (session.status === 'ended') {
      const recent = Date.now() - session.endedAt < T.END_SCREEN_TTL_MS;
      return recent && state.dismissedEndFor !== session.id ? 'end' : 'start';
    }
    if (state.video.tooLong) return 'toolong';
    if (isAwayFromChosenVideo()) return 'chosen';
    return null;
  }

  // Classes set on <html>: they drive the rules in content.css.
  function applyPageClasses() {
    const running = isRunning();
    // Mode 'one': no suggestions around the video, whatever the setting.
    const hideRelated = isOneVideo() || state.settings.watchSuggestions === 'hide';
    html.classList.toggle('ysess-hide-related', running && hideRelated);
    html.classList.toggle('ysess-freeze-related', running && !hideRelated);
    html.classList.toggle('ysess-no-shorts', hidesShorts());
  }

  // 1. Update the state (displayed video, verdict), 2. apply it to the page.
  // `filters` forces suggestions to be filtered again (otherwise periodic, see filter.js).
  function refresh({ filters = false } = {}) {
    if (!state.loaded || YSC.filter.redirectShortsToWatch()) return;

    if (isRunning()) YSC.video.track();
    const view = desiredView();

    applyPageClasses();
    if (isRunning()) YSC.video.disableAutoplay();
    if (filters) YSC.filter.run();
    else YSC.filter.runIfDue();
    YSC.shorts.applyMask();
    YSC.overlays.show(view);
    if (view) pauseAllVideos();
    YSC.pill.update();
  }
  YSC.refresh = refresh;

  // --- State --------------------------------------------------------------------
  browser.storage.local.get(['session', 'settings']).then((r) => {
    state.session = r.session ?? null;
    state.settings = YS.withDefaultSettings(r.settings);
    state.loaded = true;
    refresh({ filters: true });
    // During a short → classic player redirect, the page stays hidden.
    if (!state.redirecting) html.classList.remove('ysess-pending');
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.session || changes.settings)) return;
    if (changes.settings) state.settings = YS.withDefaultSettings(changes.settings.newValue);
    if (changes.session) {
      const previousId = state.session?.id;
      state.session = changes.session.newValue ?? null;
      // New session: the displayed video is judged again from scratch.
      if (state.session?.id !== previousId) resetVideoState(state.video.id);
    }
    refresh({ filters: true });
  });

  browser.runtime.onMessage.addListener((msg) =>
    msg?.type === MSG.IS_PLAYING ? Promise.resolve(YSC.video.isMainVideoPlaying()) : undefined
  );

  // --- Refresh ------------------------------------------------------------------
  setInterval(() => refresh(), T.REFRESH_MS);

  // URL change (moving from one short to the next): react in 100 ms instead of 500.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    refresh();
  }, T.URL_POLL_MS);
})();
