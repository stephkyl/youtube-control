'use strict';

// Point d'entrée des scripts injectés dans YouTube : charge l'état, suit ses changements
// et rafraîchit la page. Tout passe par refresh().
(() => {
  const { MSG } = YS;
  const { T, state, resetVideoState, isRunning, isLongMode, pauseAllVideos } = YSC;
  const html = document.documentElement;

  // Écran plein page à afficher, ou null.
  function desiredView() {
    const { session } = state;
    if (!session) return 'start';
    if (session.status === 'ended') {
      const recent = Date.now() - session.endedAt < T.END_SCREEN_TTL_MS;
      return recent && state.dismissedEndFor !== session.id ? 'end' : 'start';
    }
    if (state.video.tooLong) return 'toolong';
    return null;
  }

  // Classes posées sur <html> : elles pilotent les règles de content.css.
  function applyPageClasses() {
    const running = isRunning();
    html.classList.toggle('ysess-hide-related', running && state.settings.watchSuggestions === 'hide');
    html.classList.toggle('ysess-freeze-related', running && state.settings.watchSuggestions === 'fit');
    html.classList.toggle('ysess-no-shorts', isLongMode());
  }

  // 1. Mettre l'état à jour (vidéo affichée, verdict), 2. l'appliquer à la page.
  // `filters` force le refiltrage des suggestions (sinon : périodique, voir filter.js).
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

  // --- État ---------------------------------------------------------------------
  browser.storage.local.get(['session', 'settings']).then((r) => {
    state.session = r.session ?? null;
    state.settings = YS.withDefaultSettings(r.settings);
    state.loaded = true;
    refresh({ filters: true });
    // Pendant une redirection short → lecteur classique, la page reste masquée.
    if (!state.redirecting) html.classList.remove('ysess-pending');
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.session || changes.settings)) return;
    if (changes.settings) state.settings = YS.withDefaultSettings(changes.settings.newValue);
    if (changes.session) {
      const previousId = state.session?.id;
      state.session = changes.session.newValue ?? null;
      // Nouvelle session : la vidéo affichée est réévaluée depuis zéro.
      if (state.session?.id !== previousId) resetVideoState(state.video.id);
    }
    refresh({ filters: true });
  });

  browser.runtime.onMessage.addListener((msg) =>
    msg?.type === MSG.IS_PLAYING ? Promise.resolve(YSC.video.isMainVideoPlaying()) : undefined
  );

  // --- Rafraîchissement ---------------------------------------------------------
  setInterval(() => refresh(), T.REFRESH_MS);

  // Changement d'URL (passage d'un short à l'autre) : réaction en 100 ms au lieu de 500.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    refresh();
  }, T.URL_POLL_MS);
})();
