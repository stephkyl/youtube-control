'use strict';

// Source de vérité de la session. Seul ce script écrit dans storage.local.
//
// session = {
//   id, intention, durationMin,
//   mode: 'all' | 'long',       // 'all' = shorts et vidéos ; 'long' = vidéos longues uniquement
//   startedAt, endsAt,          // timestamps (ms), temps "horloge"
//   status: 'active' | 'overtime' | 'ended',
//   videos: [videoId],          // vidéos lancées pendant la session
//   shorts: [videoId],          // shorts lancés pendant la session
//   endedAt, endReason,         // 'time' | 'last-video' | 'shorts' | 'manual' | 'overtime-cap'
//   todayMs, todaySessions      // bilan du jour figé à la fin de la session (écran de fin)
// }
//
// daily = { day: 'AAAA-MM-JJ', totalMs, sessions }  // remis à zéro à minuit (heure locale)
// history = [entrée, …]  // sessions terminées, la plus récente en premier (voir shared.js)

const LAST_VIDEO_THRESHOLD_MS = 3 * 60 * 1000; // vidéo terminée avec < 3 min restantes → fin
const OVERTIME_CAP_MS = 30 * 60 * 1000;        // garde-fou si une vidéo s'éternise après l'heure
const MIN_DURATION = 1;
const MAX_DURATION = 180;
const MODES = ['all', 'long'];
const MAX_VIDEOS = 500;
const MAX_HISTORY = 500; // sessions conservées dans l'historique
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_URLS = ['*://www.youtube.com/*', '*://m.youtube.com/*'];

let session = null;
const ready = browser.storage.local.get('session').then((r) => {
  session = r.session || null;
});

function save() {
  return browser.storage.local.set({ session });
}

// ---------------------------------------------------------------------------
// Bilan du jour et historique
// ---------------------------------------------------------------------------
const { dayKey, midnightOf } = YS;

// Ajoute une session terminée au bilan du jour. Seule la partie après minuit compte.
function addToDaily(prev, s) {
  const day = dayKey(s.endedAt);
  const base = prev && prev.day === day ? prev : { day, totalMs: 0, sessions: 0 };
  const from = Math.max(s.startedAt, midnightOf(s.endedAt));
  return {
    day,
    totalMs: base.totalMs + Math.max(0, s.endedAt - from),
    sessions: base.sessions + 1,
  };
}

function addToHistory(prev, s) {
  const entry = {
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMin: s.durationMin,
    intention: s.intention,
    mode: s.mode || 'all',
    videos: (s.videos || []).length,
    shorts: (s.shorts || []).length,
    endReason: s.endReason,
  };
  const others = (Array.isArray(prev) ? prev : []).filter((h) => h.id !== s.id);
  return [entry, ...others].slice(0, MAX_HISTORY);
}

// ---------------------------------------------------------------------------
// Cycle de vie de la session
// ---------------------------------------------------------------------------
async function startSession({ durationMin, intention, mode }) {
  const d = Math.round(Number(durationMin));
  if (!Number.isFinite(d) || d < MIN_DURATION || d > MAX_DURATION) throw new Error('Durée invalide');
  const text = String(intention || '').trim().slice(0, 200);
  if (text.length < 10) throw new Error('Intention trop courte');
  if (!MODES.includes(mode)) throw new Error('Type de session invalide');
  const now = Date.now();
  session = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    intention: text,
    durationMin: d,
    mode,
    startedAt: now,
    endsAt: now + d * 60 * 1000,
    status: 'active',
    videos: [],
    shorts: [],
    endedAt: null,
    endReason: null,
  };
  await save();
  return session;
}

async function endSession(reason, endedAt = Date.now()) {
  if (!session || session.status === 'ended') return session;
  const ended = { ...session, status: 'ended', endedAt, endReason: reason };
  const stored = await browser.storage.local.get(['daily', 'history']);
  const daily = addToDaily(stored.daily, ended);
  const history = addToHistory(stored.history, ended);
  session = { ...ended, todayMs: daily.totalMs, todaySessions: daily.sessions };
  await browser.storage.local.set({ session, daily, history });
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
      await endSession('overtime-cap', session.endsAt + OVERTIME_CAP_MS);
      return;
    }
    if (await anyTabPlaying()) {
      if (session.status !== 'overtime') {
        session = { ...session, status: 'overtime' };
        await save();
      }
    } else {
      // Rien ne jouait à l'heure prévue : la session s'est terminée à cette heure-là,
      // même si on ne s'en aperçoit que plus tard (navigateur fermé, mise en veille…).
      await endSession('time', session.status === 'active' ? session.endsAt : now);
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
    const key = msg.kind === 'short' ? 'shorts' : 'videos';
    const list = session[key] || [];
    if (list.length >= MAX_VIDEOS || list.includes(msg.videoId)) return;
    session = { ...session, [key]: [...list, msg.videoId] };
    await save();
  },
  async VIDEO_ENDED() {
    if (!session || session.status === 'ended') return;
    if (session.endsAt - Date.now() < LAST_VIDEO_THRESHOLD_MS) await endSession('last-video');
  },
  CLOSE_TAB: (_msg, sender) => {
    if (sender.tab) return browser.tabs.remove(sender.tab.id);
  },
  // Les pages web ne peuvent pas ouvrir une page de l'extension : le script de page passe par ici.
  OPEN_STATS: () => browser.tabs.create({ url: browser.runtime.getURL('src/stats.html') }).then(() => undefined),
  async CLEAR_HISTORY(_msg, sender) {
    // Réservé aux pages de l'extension (pas aux scripts injectés dans YouTube).
    if (!String(sender.url || '').startsWith(browser.runtime.getURL(''))) return;
    await browser.storage.local.remove(['history', 'daily']);
  },
};

browser.runtime.onMessage.addListener((msg, sender) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return undefined;
  return ready.then(() => handler(msg, sender));
});
