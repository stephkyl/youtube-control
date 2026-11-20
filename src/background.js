'use strict';

// Source de vérité de la session. Seul ce script écrit dans storage.local.
//
// session = {
//   id, intention, durationMin,
//   startedAt, endsAt,          // timestamps (ms), temps "horloge"
//   status: 'active' | 'overtime' | 'ended',
//   videos: [videoId],          // vidéos lancées pendant la session
//   endedAt, endReason          // 'time' | 'last-video' | 'shorts' | 'manual' | 'overtime-cap'
// }

const LAST_VIDEO_THRESHOLD_MS = 3 * 60 * 1000; // vidéo terminée avec < 3 min restantes → fin
const OVERTIME_CAP_MS = 30 * 60 * 1000;        // garde-fou si une vidéo s'éternise après l'heure
const MIN_DURATION = 1;
const MAX_DURATION = 180;
const MAX_VIDEOS = 500;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_URLS = ['*://www.youtube.com/*', '*://m.youtube.com/*'];

let session = null;
const ready = browser.storage.local.get('session').then((r) => {
  session = r.session || null;
});

function save() {
  return browser.storage.local.set({ session });
}

async function startSession({ durationMin, intention }) {
  const d = Math.round(Number(durationMin));
  if (!Number.isFinite(d) || d < MIN_DURATION || d > MAX_DURATION) throw new Error('Durée invalide');
  const text = String(intention || '').trim().slice(0, 200);
  if (text.length < 10) throw new Error('Intention trop courte');
  const now = Date.now();
  session = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    intention: text,
    durationMin: d,
    startedAt: now,
    endsAt: now + d * 60 * 1000,
    status: 'active',
    videos: [],
    endedAt: null,
    endReason: null,
  };
  await save();
  return session;
}

async function endSession(reason) {
  if (!session || session.status === 'ended') return session;
  session = { ...session, status: 'ended', endedAt: Date.now(), endReason: reason };
  await save();
  return session;
}

async function anyTabPlaying() {
  // Pas besoin de la permission "tabs" : les permissions d'hôte suffisent pour filtrer par URL.
  const tabs = await browser.tabs.query({ url: YOUTUBE_URLS });
  const answers = await Promise.all(
    tabs.map((t) => browser.tabs.sendMessage(t.id, { type: 'IS_PLAYING' }).catch(() => false))
  );
  return answers.some(Boolean);
}

// Quand le temps est écoulé, on laisse la vidéo en cours se terminer ("overtime"),
// puis on clôt la session dès que plus rien ne joue.
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await ready;
    if (!session || session.status === 'ended') return;
    const now = Date.now();
    if (now < session.endsAt) return;
    if (now > session.endsAt + OVERTIME_CAP_MS) {
      await endSession('overtime-cap');
      return;
    }
    if (await anyTabPlaying()) {
      if (session.status !== 'overtime') {
        session = { ...session, status: 'overtime' };
        await save();
      }
    } else {
      await endSession('time');
    }
  } finally {
    ticking = false;
  }
}
setInterval(tick, 1000);

const handlers = {
  GET_STATE: () => session,
  START_SESSION: (msg) => startSession(msg),
  END_SESSION: (msg) => endSession(msg.reason || 'manual'),
  async VIDEO_STARTED(msg) {
    if (!session || session.status === 'ended') return;
    if (typeof msg.videoId !== 'string' || !VIDEO_ID_RE.test(msg.videoId)) return;
    if (session.videos.length >= MAX_VIDEOS || session.videos.includes(msg.videoId)) return;
    session = { ...session, videos: [...session.videos, msg.videoId] };
    await save();
  },
  async VIDEO_ENDED() {
    if (!session || session.status === 'ended') return;
    if (session.endsAt - Date.now() < LAST_VIDEO_THRESHOLD_MS) await endSession('last-video');
  },
  CLOSE_TAB: (_msg, sender) => {
    if (sender.tab) return browser.tabs.remove(sender.tab.id);
  },
};

browser.runtime.onMessage.addListener((msg, sender) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return undefined;
  return ready.then(() => handler(msg, sender));
});
