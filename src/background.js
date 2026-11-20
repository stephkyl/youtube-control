'use strict';

// Source de vérité de la session. Seul ce script écrit la session et l'historique dans
// storage.local (les réglages sont écrits par la popup ; la page Historique peut
// effacer l'historique).
//
// session = {
//   id, intention, durationMin,
//   mode: 'all' | 'long',       // voir YS.config.MODES
//   startedAt, endsAt,          // timestamps (ms), temps "horloge"
//   status: 'active' | 'overtime' | 'ended',
//   videos: [videoId],          // vidéos lancées pendant la session
//   shorts: [videoId],          // shorts lancés pendant la session
//   endedAt, endReason,         // 'time' | 'last-video' | 'shorts' | 'manual' | 'overtime-cap'
// }
//
// history = [entrée, …]  // sessions terminées, la plus récente en premier (voir shared.js)

const { config, MSG, isValidVideoId } = YS;

const LAST_VIDEO_THRESHOLD_MS = 3 * 60 * 1000; // vidéo terminée avec < 3 min restantes → fin
const OVERTIME_CAP_MS = 30 * 60 * 1000; // garde-fou si une vidéo s'éternise après l'heure
const MAX_IDS_PER_LIST = 500; // vidéos (ou shorts) mémorisées par session
const MAX_HISTORY = 500; // sessions conservées dans l'historique
const TICK_MS = 1000;

let session = null;
const ready = browser.storage.local.get('session').then((r) => {
  session = r.session ?? null;
});

const save = () => browser.storage.local.set({ session });

// ---------------------------------------------------------------------------
// Historique
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
// Cycle de vie de la session
// ---------------------------------------------------------------------------

// Les valeurs viennent d'un script injecté dans YouTube : on les revalide ici.
async function startSession({ durationMin, intention, mode }) {
  const d = Math.round(Number(durationMin));
  if (!Number.isFinite(d) || d < config.MIN_DURATION || d > config.MAX_DURATION) throw new Error('Durée invalide');
  const text = String(intention || '').trim().slice(0, config.MAX_INTENTION);
  if (text.length < config.MIN_INTENTION) throw new Error('Intention trop courte');
  if (!config.MODES.includes(mode)) throw new Error('Type de session invalide');

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
  session = { ...session, status: 'ended', endedAt, endReason: reason };
  const stored = await browser.storage.local.get('history');
  // Session et historique écrits ensemble : l'écran de fin reçoit les deux en même temps.
  await browser.storage.local.set({ session, history: addToHistory(stored.history, session) });
  return session;
}

async function anyTabPlaying() {
  // Pas besoin de la permission "tabs" : les permissions d'hôte suffisent pour filtrer par URL.
  const tabs = await browser.tabs.query({ url: [...config.YOUTUBE_URLS] });
  const answers = await Promise.all(
    tabs.map((tab) => browser.tabs.sendMessage(tab.id, { type: MSG.IS_PLAYING }).catch(() => false))
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
    } else if (await anyTabPlaying()) {
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
setInterval(tick, TICK_MS);

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
const handlers = {
  [MSG.START_SESSION]: (msg) => startSession(msg),

  [MSG.END_SESSION]: (msg) => endSession(msg.reason || 'manual'),

  async [MSG.VIDEO_STARTED](msg) {
    if (!session || session.status === 'ended' || !isValidVideoId(msg.videoId)) return;
    const key = msg.kind === 'short' ? 'shorts' : 'videos';
    const list = session[key];
    if (list.length >= MAX_IDS_PER_LIST || list.includes(msg.videoId)) return;
    session = { ...session, [key]: [...list, msg.videoId] };
    await save();
  },

  async [MSG.VIDEO_ENDED]() {
    if (!session || session.status === 'ended') return;
    if (session.endsAt - Date.now() < LAST_VIDEO_THRESHOLD_MS) await endSession('last-video');
  },

  [MSG.CLOSE_TAB]: (_msg, sender) => (sender.tab ? browser.tabs.remove(sender.tab.id) : undefined),

  // Une page web ne peut pas ouvrir une page de l'extension : le script injecté passe par ici.
  [MSG.OPEN_STATS]: () => browser.tabs.create({ url: browser.runtime.getURL(config.STATS_PAGE) }).then(() => undefined),
};

browser.runtime.onMessage.addListener((msg, sender) => {
  const handler = handlers[msg?.type];
  return handler ? ready.then(() => handler(msg, sender)) : undefined;
});
