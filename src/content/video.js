'use strict';

// Suivi de la vidéo affichée : est-elle lisible dans le temps restant ? quand se termine-t-elle ?
YSC.video = (() => {
  const { MSG } = YS;
  const { T, state, resetVideoState, isOvertime, isOneVideo, remainingMs, send } = YSC;
  const { pageType, urlVideoId, getMainVideo, isAdShowing, playerVideoId } = YSC;

  // Décision pure : la vidéo affichée peut-elle être lue, et comment la compter ?
  function judgeVideo(type, video) {
    // Session « une vidéo » : pas de limite de temps (directs compris). Le choix de la vidéo
    // et le blocage des autres sont gérés par l'arrière-plan et l'écran « déjà choisie ».
    if (isOneVideo()) return { allowed: true, kind: 'video' };
    const rem = remainingMs();
    if (type === 'shorts') {
      // Un short n'est jamais coupé ni refusé. S'il commence à moins de 2 min de la fin
      // (ou après), c'est le dernier : lu en entier, même au-delà de la session.
      return { allowed: true, kind: 'short', lastShort: isOvertime() || rem < T.LAST_SHORT_THRESHOLD_MS };
    }
    // Un short ouvert dans le lecteur classique (session « vidéos longues ») compte comme vidéo.
    const videoMs = Math.max(0, ((video.duration - video.currentTime) * 1000) / (video.playbackRate || 1));
    const allowed = !isOvertime() && videoMs <= rem + T.FIT_TOLERANCE_MS;
    return { allowed, kind: 'video', videoMs, remainingMs: rem };
  }

  function applyVerdict(id, video, verdict) {
    if (verdict.allowed) {
      if (verdict.lastShort) state.video.lastShort = true;
      send({ type: MSG.VIDEO_STARTED, videoId: id, kind: verdict.kind });
    } else {
      video.pause();
      state.video.tooLong = { videoMs: verdict.videoMs, remainingMs: verdict.remainingMs };
    }
  }

  // Après une navigation, <video> peut encore porter la vidéo précédente : on attend que le
  // lecteur annonce la bonne (ou, à défaut de son API, un court délai).
  // Session « une vidéo » : la vidéo n'est retenue qu'une fois sa lecture lancée (hors publicité),
  // et sa durée n'importe pas (un direct n'en a pas).
  function isPlayerReady(type, id, video) {
    if (isAdShowing(type)) return false;
    if (isOneVideo() ? video.paused : !(Number.isFinite(video.duration) && video.duration > 0)) return false;
    const playerId = playerVideoId(type);
    return playerId ? playerId === id : Date.now() - state.video.navAt > T.PLAYER_SETTLE_MS;
  }

  function track() {
    const type = pageType();
    const id = urlVideoId(type);

    if (id !== state.video.id) {
      // Évalué avant la réinitialisation : on quitte un short alors que le suivant est attendu
      // comme le dernier ('armed') → celui où l'on arrive l'est, sans attendre son chargement.
      const wasArmed = type === 'shorts' && !!state.video.id && YSC.shorts.maskState() === 'armed';
      resetVideoState(id, { lastShort: wasArmed });
    }
    const vs = state.video;
    const video = id && getMainVideo(type);
    if (!video) return;

    if (!vs.checked && isPlayerReady(type, id, video)) {
      vs.checked = true;
      applyVerdict(id, video, judgeVideo(type, video));
    }

    if (type === 'shorts' && vs.checked && !vs.finished) {
      // Temps écoulé alors qu'on n'a pas encore défilé : le short en cours devient le dernier.
      if (isOvertime()) vs.lastShort = true;
      // Filet de sécurité si 'timeupdate' a raté la fin : la boucle a redémarré.
      if (vs.lastShort && video.currentTime + T.LOOP_RESTART_S < vs.lastTime) YSC.shorts.finish(video);
    }
    if (vs.finished && !video.paused) video.pause();
    vs.lastTime = video.currentTime;
  }

  function disableAutoplay() {
    document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]')?.click();
  }

  function isMainVideoPlaying() {
    const type = pageType();
    if (type === 'other' || state.overlay || state.video.finished) return false;
    const video = getMainVideo(type);
    return !!video && !video.paused && !video.ended;
  }

  // Les événements média ne remontent pas, mais la phase de capture les voit.
  document.addEventListener(
    'ended',
    (e) => {
      if (!e.isTrusted || !YSC.isRunning() || pageType() !== 'watch') return;
      if (e.target !== getMainVideo('watch') || isAdShowing('watch')) return;
      send({ type: MSG.VIDEO_ENDED, videoId: urlVideoId('watch') });
    },
    true
  );

  return { track, disableAutoplay, isMainVideoPlaying };
})();
