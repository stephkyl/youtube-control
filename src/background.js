'use strict';

// Source de vérité de la session. Seul ce script écrit la session et l'historique dans
// storage.local (les réglages sont écrits par la popup ; la page Historique peut
// effacer l'historique).
//
// session = {
//   id, intention, durationMin,
//   mode: 'all' | 'long' | 'one', // voir YS.config.MODES
//   startedAt, endsAt,          // timestamps (ms), temps "horloge" ; mode 'one' : durationMin et endsAt = null
//   status: 'active' | 'overtime' | 'ended',
//   videos: [videoId],          // vidéos lancées pendant la session
//   shorts: [videoId],          // shorts lancés pendant la session
//   chosenVideo, lastActiveAt,  // mode 'one' : la vidéo de la session, dernière lecture constatée
//   endedAt, endReason,         // 'time' | 'last-video' | 'shorts' | 'manual' | 'overtime-cap'
//                               // | 'video-ended' | 'inactive'
// }
//
// history = [entrée, …]  // sessions terminées, la plus récente en premier (voir shared.js)

const { config, MSG, isValidVideoId } = YS;

const LAST_VIDEO_THRESHOLD_MS = 3 * 60 * 1000; // vidéo terminée avec < 3 min restantes → fin
const OVERTIME_CAP_MS = 30 * 60 * 1000; // garde-fou si une vidéo s'éternise après l'heure
const MAX_IDS_PER_LIST = 500; // vidéos (ou shorts) mémorisées par session
const MAX_HISTORY = 500; // sessions conservées dans l'historique
const INACTIVITY_MS = 30 * 60 * 1000; // mode 'one' : rien n'a joué depuis 30 min → fin
const ACTIVITY_SAVE_MS = 60 * 1000; // mode 'one' : lastActiveAt enregistré au plus une fois par minute
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
  // Une session en cours n'est jamais remplacée (ex. formulaire validé dans deux onglets) :
  // elle serait perdue pour l'historique.
  if (session && session.status !== 'ended') throw new Error('Session déjà en cours');
  if (!config.MODES.includes(mode)) throw new Error('Type de session invalide');
  const timed = mode !== 'one';
  const d = Math.round(Number(durationMin));
  if (timed && (!Number.isFinite(d) || d < config.MIN_DURATION || d > config.MAX_DURATION)) throw new Error('Durée invalide');
  const text = String(intention || '').trim().slice(0, config.MAX_INTENTION);
  if (text.length < config.MIN_INTENTION) throw new Error('Intention trop courte');

  const now = Date.now();
  session = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    intention: text,
    durationMin: timed ? d : null,
    mode,
    startedAt: now,
    endsAt: timed ? now + d * 60 * 1000 : null,
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

// Session « une vidéo » : pas d'heure de fin, mais elle s'arrête après 30 min sans lecture
// (vidéo pas encore choisie, en pause, onglet fermé…), à l'heure de la dernière lecture.
async function tickOneVideo(now) {
  if (await anyTabPlaying()) {
    if (now - session.lastActiveAt < ACTIVITY_SAVE_MS) return;
    session = { ...session, lastActiveAt: now };
    await save();
  } else if (now - session.lastActiveAt > INACTIVITY_MS) {
    await endSession('inactive', session.lastActiveAt);
  }
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
    if (session.mode === 'one') return await tickOneVideo(now);
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

  // Seules ces raisons peuvent venir d'un message ; les autres sont décidées ici.
  [MSG.END_SESSION]: (msg) => endSession(msg.reason === 'shorts' ? 'shorts' : 'manual'),

  async [MSG.VIDEO_STARTED](msg) {
    if (!session || session.status === 'ended' || !isValidVideoId(msg.videoId)) return;
    if (session.mode === 'one') {
      // La première vidéo lancée devient celle de la session ; les autres sont ignorées.
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

  // Une page web ne peut pas ouvrir une page de l'extension : le script injecté passe par ici.
  [MSG.OPEN_STATS]: () => browser.tabs.create({ url: browser.runtime.getURL(config.STATS_PAGE) }).then(() => undefined),
};

browser.runtime.onMessage.addListener((msg, sender) => {
  // Object.hasOwn : un type comme 'toString' ne doit pas tomber sur une méthode héritée.
  if (!Object.hasOwn(handlers, msg?.type)) return undefined;
  return ready.then(() => handlers[msg.type](msg, sender));
});
