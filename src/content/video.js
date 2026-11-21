'use strict';

// Tracks the displayed video: can it be watched in the remaining time? when does it end?
YSC.video = (() => {
  const { MSG } = YS;
  const { T, state, resetVideoState, isOvertime, isOneVideo, remainingMs, send } = YSC;
  const { pageType, urlVideoId, getMainVideo, isAdShowing, playerVideoId } = YSC;

  // Pure decision: can the displayed video be watched, and how is it counted?
  function judgeVideo(type, video) {
    // One-video session: no time limit (live streams included). Choosing the video and
    // blocking the others is handled by the background and the "already chosen" screen.
    if (isOneVideo()) return { allowed: true, kind: 'video' };
    const rem = remainingMs();
    if (type === 'shorts') {
      // A short is never cut off or refused. If it starts less than 2 min before the end
      // (or later), it is the last one: played in full, even past the session.
      return { allowed: true, kind: 'short', lastShort: isOvertime() || rem < T.LAST_SHORT_THRESHOLD_MS };
    }
    // A short opened in the classic player (long-videos session) counts as a video.
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

  // After a navigation, <video> may still hold the previous video: wait until the player
  // reports the right one (or, without its API, a short delay).
  // One-video session: the video is only taken once playback has started (ads excluded),
  // and its duration doesn't matter (a live stream has none).
  function isPlayerReady(type, id, video) {
    if (isAdShowing(type)) return false;
    const hasDuration = Number.isFinite(video.duration) && video.duration > 0;
    // One video: wait for playback to start; otherwise: wait for the duration to be known.
    if (isOneVideo() ? video.paused : !hasDuration) return false;
    const playerId = playerVideoId(type);
    return playerId ? playerId === id : Date.now() - state.video.navAt > T.PLAYER_SETTLE_MS;
  }

  function track() {
    const type = pageType();
    const id = urlVideoId(type);

    if (id !== state.video.id) {
      // Evaluated before the reset: leaving a short while the next one is expected to be
      // the last ('armed') → the one we land on is, without waiting for it to load.
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
      // Time is up before scrolling: the current short becomes the last one.
      if (isOvertime()) vs.lastShort = true;
      // Safety net if 'timeupdate' missed the end: the loop has restarted.
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

  // Media events don't bubble, but the capture phase sees them.
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
