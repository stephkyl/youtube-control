'use strict';

// The session's last short.
// Less than 2 min before the end, scrolling still works: the next short you land on is
// the last one. While it plays, nothing appears below it, scrolling is blocked, and the
// session ends as soon as it is over.
YSC.shorts = (() => {
  const { MSG } = YS;
  const { T, state, isRunning, isOvertime, remainingMs, isOnLastShort, pageType, getMainVideo, send } = YSC;
  const html = document.documentElement;
  const AFTER_LAST = 'data-ysess-after-last';

  // 'off'   : nothing to hide.
  // 'armed' : less than 2 min, the next short will be the last → hide everything after it
  //           right now, so there is no preview when landing on it.
  // 'last'  : on the last short → everything after it is hidden, scrolling is blocked.
  function maskState() {
    if (!isRunning() || pageType() !== 'shorts') return 'off';
    if (isOnLastShort()) return 'last';
    if (isOvertime() || remainingMs() < T.LAST_SHORT_THRESHOLD_MS) return 'armed';
    return 'off';
  }

  function finish(video) {
    if (state.video.finished) return;
    state.video.finished = true;
    video.pause();
    send({ type: MSG.END_SESSION, reason: 'shorts' });
  }

  // --- Finding the current item in the feed -----------------------------------

  // Feed item holding the current short, found without relying on YouTube's element names:
  // walk up from the video to an element at least half a screen tall that has a sibling
  // of the same type stacked right below it (the next short). Player layers (controls,
  // etc.) overlap instead of stacking: they are ignored.
  function findCurrentReelItem() {
    const minHeight = window.innerHeight * 0.5;
    for (let node = getMainVideo('shorts'); node?.parentElement && node !== document.body; node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (rect.height < minHeight) continue;
      for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
        if (sib.tagName !== node.tagName) continue;
        const r = sib.getBoundingClientRect();
        if (r.height >= minHeight && r.top >= rect.bottom - T.STACK_TOLERANCE_PX) return node;
      }
    }
    return null;
  }

  function findFeedScroller() {
    let node = document.querySelector('ytd-reel-video-renderer[is-active]') || getMainVideo('shorts');
    for (; node && node !== html; node = node.parentElement) {
      const overflowY = getComputedStyle(node).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    }
    return document.scrollingElement;
  }

  // --- Hiding the rest of the feed --------------------------------------------

  // Hides the feed items after the current short, leaving `keep` of them visible
  // (1 in 'armed' state: the next short, the one we are about to land on).
  function hideReelsAfter(keep) {
    const item = findCurrentReelItem();
    if (!item) return;
    item.removeAttribute(AFTER_LAST);
    let sib = item.nextElementSibling;
    for (let i = 0; i < keep && sib; i += 1, sib = sib.nextElementSibling) sib.removeAttribute(AFTER_LAST);
    for (; sib; sib = sib.nextElementSibling) sib.setAttribute(AFTER_LAST, '');
  }

  function showAllReels() {
    for (const el of document.querySelectorAll(`[${AFTER_LAST}]`)) el.removeAttribute(AFTER_LAST);
  }

  // Called on every refresh: the feed can grow between two passes.
  function applyMask() {
    const mask = maskState();
    if (mask === 'off') showAllReels();
    else hideReelsAfter(mask === 'armed' ? 1 : 0);
    setLastShortMode(mask === 'last');
  }

  // --- Scroll blocking --------------------------------------------------------

  // Position lock: if the feed scrolls anyway (scrollbar, YouTube script…), put it back
  // where it was. At first, follow the position to let scroll-snap finish settling
  // the short.
  let scrollLock = null; // { el, top, since }
  const inLastShortMode = () => html.classList.contains('ysess-last-short');

  function setLastShortMode(on) {
    if (on === inLastShortMode()) return;
    html.classList.toggle('ysess-last-short', on);
    const el = on ? findFeedScroller() : null;
    scrollLock = el ? { el, top: el.scrollTop, since: Date.now() } : null;
  }

  document.addEventListener(
    'scroll',
    (e) => {
      if (!scrollLock || !inLastShortMode()) return;
      const { el } = scrollLock;
      if ((e.target === document ? document.scrollingElement : e.target) !== el) return;
      if (Date.now() - scrollLock.since < T.SNAP_SETTLE_MS) scrollLock.top = el.scrollTop;
      else if (Math.abs(el.scrollTop - scrollLock.top) > 1) el.scrollTop = scrollLock.top;
    },
    true
  );

  // Wheel, touch, keyboard: no moving to the next short (except in the comments panel).
  const blockFeedScroll = (e) => {
    if (!inLastShortMode()) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('ytd-engagement-panel-section-list-renderer, [data-ysess]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const NAV_KEYS = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'];
  const EDITABLE_SEL = 'input, textarea, [contenteditable=""], [contenteditable="true"]';

  window.addEventListener('wheel', blockFeedScroll, { capture: true, passive: false });
  window.addEventListener('touchmove', blockFeedScroll, { capture: true, passive: false });
  window.addEventListener(
    'keydown',
    (e) => {
      if (!NAV_KEYS.includes(e.key)) return;
      if (e.target instanceof Element && e.target.closest(EDITABLE_SEL)) return;
      blockFeedScroll(e);
    },
    true
  );

  // End of the last short: stop it just before it loops.
  document.addEventListener(
    'timeupdate',
    (e) => {
      const vs = state.video;
      // Until the video is confirmed (checked), <video> may still hold the previous short.
      if (!e.isTrusted || !vs.lastShort || !vs.checked || vs.finished || pageType() !== 'shorts') return;
      const video = getMainVideo('shorts');
      if (e.target !== video || !Number.isFinite(video.duration)) return;
      if (video.duration - video.currentTime < T.SHORT_END_MARGIN_S) finish(video);
    },
    true
  );

  return { maskState, applyMask, finish };
})();
