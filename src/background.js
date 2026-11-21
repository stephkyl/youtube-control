'use strict';

// Source of truth for the session. Only this script writes the session and the history
// to storage.local (settings are written by the popup; the history page may clear the
// history).
//
// session = {
//   id, intention, durationMin,
//   mode: 'all' | 'long' | 'one', // see YS.config.MODES
//   startedAt, endsAt,          // timestamps (ms), wall-clock time; mode 'one': durationMin and endsAt = null
//   status: 'active' | 'overtime' | 'ended',
//   videos: [videoId],          // videos started during the session
//   shorts: [videoId],          // shorts started during the session
//   chosenVideo, lastActiveAt,  // mode 'one': the session's video, last time playback was seen
//   endedAt, endReason,         // 'time' | 'last-video' | 'shorts' | 'manual' | 'overtime-cap'
//                               // | 'video-ended' | 'inactive'
// }
//
// history = [entry, …]  // finished sessions, most recent first (see shared.js)

const { config, MSG, isValidVideoId } = YS;

const LAST_VIDEO_THRESHOLD_MS = 3 * 60 * 1000; // video ends with < 3 min left → session ends
const OVERTIME_CAP_MS = 30 * 60 * 1000; // safety net if a video drags on past the end time
const MAX_IDS_PER_LIST = 500; // videos (or shorts) remembered per session
const MAX_HISTORY = 500; // sessions kept in the history
const INACTIVITY_MS = 30 * 60 * 1000; // mode 'one': nothing has played for 30 min → session ends
const ACTIVITY_SAVE_MS = 60 * 1000; // mode 'one': lastActiveAt saved at most once a minute
const TICK_MS = 1000;

let session = null;
const ready = browser.storage.local.get('session').then((r) => {
  session = r.session ?? null;
});

const save = () => browser.storage.local.set({ session });

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function addToHistory(prev, s) {
  const entry = {
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    intention: s.intention,
    mode: s.mode,
    videos: s.videos.length,
    shorts: s.shorts.length,
    endReason: s.endReason,
  };
  const others = (prev ?? []).filter((h) => h.id !== s.id);
  return [entry, ...others].slice(0, MAX_HISTORY);
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

function validDuration(value) {
  const d = Math.round(Number(value));
  if (!Number.isFinite(d) || d < config.MIN_DURATION || d > config.MAX_DURATION) throw new Error('Invalid duration');
  return d;
}

// Values come from a script injected into YouTube: validate them again here.
async function startSession(msg) {
  // A running session is never replaced (e.g. form submitted in two tabs):
  // it would be lost from the history.
  if (session && session.status !== 'ended') throw new Error('A session is already running');
  const { mode, intention } = msg;
  if (!config.MODES.includes(mode)) throw new Error('Invalid session type');
  const durationMin = mode === 'one' ? null : validDuration(msg.durationMin);
  const text = String(intention || '').trim().slice(0, config.MAX_INTENTION);
  if (text.length < config.MIN_INTENTION) throw new Error('Intention too short');

  const now = Date.now();
  session = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    intention: text,
    durationMin,
    mode,
    startedAt: now,
    endsAt: durationMin === null ? null : now + durationMin * 60 * 1000,
    status: 'active',
    videos: [],
    shorts: [],
    chosenVideo: null,
    lastActiveAt: now,
    endedAt: null,
    endReason: null,
  };
  await save();
  return session;
}

async function endSession(reason, endedAt = Date.now()) {
  if (!session || session.status === 'ended') return session;
  session = { ...session, status: 'ended', endedAt, endReason: reason };
  const stored = await browser.storage.local.get('history');
  // Session and history written together: the end screen receives both at once.
  await browser.storage.local.set({ session, history: addToHistory(stored.history, session) });
  return session;
}

async function anyTabPlaying() {
  // No "tabs" permission needed: host permissions are enough to filter by URL.
  const tabs = await browser.tabs.query({ url: config.YOUTUBE_URLS });
  const answers = await Promise.all(
    tabs.map((tab) => browser.tabs.sendMessage(tab.id, { type: MSG.IS_PLAYING }).catch(() => false))
  );
  return answers.some(Boolean);
}

// One-video session: no end time, but it stops after 30 min without playback
// (video not chosen yet, paused, tab closed…), at the time of the last playback.
async function tickOneVideo(now) {
  if (await anyTabPlaying()) {
    if (now - session.lastActiveAt < ACTIVITY_SAVE_MS) return;
    session = { ...session, lastActiveAt: now };
    await save();
  } else if (now - session.lastActiveAt > INACTIVITY_MS) {
    await endSession('inactive', session.lastActiveAt);
  }
}

// When time is up, the current video may finish ("overtime"),
// then the session closes as soon as nothing is playing.
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await ready;
    if (!session || session.status === 'ended') return;
    const now = Date.now();
    if (session.mode === 'one') {
      await tickOneVideo(now);
      return;
    }
    if (now < session.endsAt) return;
    if (now > session.endsAt + OVERTIME_CAP_MS) {
      await endSession('overtime-cap', session.endsAt + OVERTIME_CAP_MS);
    } else if (await anyTabPlaying()) {
      if (session.status !== 'overtime') {
        session = { ...session, status: 'overtime' };
        await save();
      }
    } else {
      // Nothing was playing at the planned time: the session ended at that time,
      // even if we only notice later (browser closed, computer asleep…).
      await endSession('time', session.status === 'active' ? session.endsAt : now);
    }
  } finally {
    ticking = false;
  }
}
setInterval(tick, TICK_MS);

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
const handlers = {
  [MSG.START_SESSION]: (msg) => startSession(msg),

  // Only these reasons may come from a message; the others are decided here.
  [MSG.END_SESSION]: (msg) => endSession(msg.reason === 'shorts' ? 'shorts' : 'manual'),

  async [MSG.VIDEO_STARTED](msg) {
    if (!session || session.status === 'ended' || !isValidVideoId(msg.videoId)) return;
    if (session.mode === 'one') {
      // The first video started becomes the session's video; others are ignored.
      if (session.chosenVideo && session.chosenVideo !== msg.videoId) return;
      session = { ...session, chosenVideo: msg.videoId, lastActiveAt: Date.now() };
    }
    const key = msg.kind === 'short' ? 'shorts' : 'videos';
    const list = session[key];
    if (list.length >= MAX_IDS_PER_LIST || list.includes(msg.videoId)) return;
    session = { ...session, [key]: [...list, msg.videoId] };
    await save();
  },

  async [MSG.VIDEO_ENDED](msg) {
    if (!session || session.status === 'ended') return;
    if (session.mode === 'one') {
      if (session.chosenVideo && msg.videoId === session.chosenVideo) await endSession('video-ended');
    } else if (session.endsAt - Date.now() < LAST_VIDEO_THRESHOLD_MS) {
      await endSession('last-video');
    }
  },

  [MSG.CLOSE_TAB]: (_msg, sender) => (sender.tab ? browser.tabs.remove(sender.tab.id) : undefined),

  // A web page cannot open an extension page: the injected script goes through here.
  [MSG.OPEN_STATS]: () => browser.tabs.create({ url: browser.runtime.getURL(config.STATS_PAGE) }).then(() => undefined),
};

browser.runtime.onMessage.addListener((msg, sender) => {
  // Object.hasOwn: a type such as 'toString' must not hit an inherited method.
  if (!Object.hasOwn(handlers, msg?.type)) return undefined;
  return ready.then(() => handlers[msg.type](msg, sender));
});
