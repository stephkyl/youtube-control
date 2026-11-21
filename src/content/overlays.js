'use strict';

// Écrans plein page : démarrage (intention + durée + réflexion), fin de session, vidéo hors session,
// autre page alors que la vidéo d'une session « une vidéo » est déjà choisie.
// Chacun vit dans un Shadow DOM fermé : isolé du CSS de YouTube et illisible par ses scripts.
YSC.overlays = (() => {
  const { config, MSG, t, plural, modeLabel, esc, fmtSpent, fmtLeft, midnightOf, countsToShow, totalsSince } = YS;
  const { T, state, send } = YSC;
  const html = document.documentElement;

  const DURATION_PRESETS = [5, 10, 15, 30, 60];
  const MODE_DESCRIPTIONS = { all: 'modeAllDesc', long: 'modeLongDesc', one: 'modeOneDesc' };
  const needsDuration = (mode) => mode !== 'one';

  // --- Montage ----------------------------------------------------------------
  const builders = { start: buildStart, end: buildEnd, toolong: buildTooLong, chosen: buildChosen };

  // Affiche l'écran demandé (ou aucun si view est null). Ne reconstruit pas un écran déjà affiché.
  function show(view) {
    if (!view) return unmount();
    if (state.overlay?.view === view && state.overlay.host.isConnected) return;
    unmount();
    const host = document.createElement('div');
    host.setAttribute('data-ysess', 'overlay');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    // Empêche les raccourcis clavier et la molette de YouTube (navigation Shorts, etc.).
    for (const type of ['keydown', 'keyup', 'keypress', 'wheel', 'touchmove']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${YSC.styles.overlay}</style>`;
    const screen = document.createElement('div');
    screen.className = `screen screen-${view}`;
    root.appendChild(screen);
    html.appendChild(host);
    html.classList.add('ysess-locked');
    state.overlay = { host, view, cleanup: builders[view](screen) || null };
  }

  function unmount() {
    if (!state.overlay) return;
    state.overlay.cleanup?.();
    state.overlay.host.remove();
    state.overlay = null;
    html.classList.remove('ysess-locked');
  }

  // --- Démarrage --------------------------------------------------------------

  // Durée libre : entier dans les bornes, sinon null.
  function parseCustomDuration(text) {
    const n = Number(text);
    return text !== '' && Number.isInteger(n) && n >= config.MIN_DURATION && n <= config.MAX_DURATION ? n : null;
  }

  // Validation pure du formulaire : message d'aide et bouton actif ou non.
  function validateForm({ mode, duration, customDuration, intention }) {
    const missing = config.MIN_INTENTION - intention.trim().length;
    const canSubmit = Boolean(mode && (duration || !needsDuration(mode)) && missing <= 0);
    if (needsDuration(mode) && customDuration !== '' && duration === null) {
      return { canSubmit, hint: t('startCustomRange', config.MIN_DURATION, config.MAX_DURATION) };
    }
    if (missing > 0) return { canSubmit, hint: plural(missing, 'startHintOne', 'startHintMany') };
    return { canSubmit, hint: '' };
  }

  function confirmTitle({ mode, duration }) {
    if (!needsDuration(mode)) return t('confirmTitleOneVideo');
    return duration === 1 ? t('confirmTitleOne') : t('confirmTitle', duration);
  }

  function buildStart(screen) {
    const form = { mode: null, duration: null, customDuration: '', intention: '' }; // pas de valeur par défaut
    const $ = (sel) => screen.querySelector(sel);
    const $$ = (sel) => [...screen.querySelectorAll(sel)];
    let timer = null;
    let onVisibility = null;

    const stopTimer = () => {
      clearInterval(timer);
      timer = null;
      if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
      onVisibility = null;
    };

    const modeButton = (mode) => `
      <button type="button" class="mode" data-mode="${mode}" aria-pressed="${mode === form.mode}">
        <strong>${esc(modeLabel(mode))}</strong>
        <small>${esc(t(MODE_DESCRIPTIONS[mode]))}</small>
      </button>`;
    const presetChip = (d) => `
      <button type="button" class="chip" data-d="${d}" aria-pressed="${d === form.duration && !form.customDuration}">${esc(t('minutesShort', d))}</button>`;

    function renderForm() {
      stopTimer();
      screen.innerHTML = `
        <div class="card">
          <div class="eyebrow">${esc(t('startEyebrow'))}</div>
          <h1>${esc(t('startTitle'))}</h1>
          <p class="lead">${esc(t('startLead'))}</p>
          <div class="field">
            <div class="label">${esc(t('startModeLabel'))}</div>
            <div class="modes">${config.MODES.map(modeButton).join('')}</div>
          </div>
          <div class="field" id="duration-field">
            <div class="label">${esc(t('startDurationLabel'))}</div>
            <div class="chips">
              ${DURATION_PRESETS.map(presetChip).join('')}
              <label class="chip custom">
                <input type="number" id="custom" inputmode="numeric" min="${config.MIN_DURATION}" max="${config.MAX_DURATION}" step="1"
                  placeholder="${esc(t('startCustomPlaceholder'))}" aria-label="${esc(t('startCustomLabel'))}">
                <span>min</span>
              </label>
            </div>
          </div>
          <div class="field">
            <label class="label" for="intent">${esc(t('startIntentionLabel'))}</label>
            <textarea id="intent" rows="2" maxlength="${config.MAX_INTENTION}" placeholder="${esc(t('startIntentionPlaceholder'))}"></textarea>
            <div class="hint" id="hint"></div>
          </div>
          <button type="button" class="primary" id="go" disabled>${esc(t('startCommit'))}</button>
        </div>`;

      const intentInput = $('#intent');
      const customInput = $('#custom');
      const customChip = $('.chip.custom');
      intentInput.value = form.intention;
      customInput.value = form.customDuration;
      customChip.classList.toggle('active', !!form.customDuration);

      const update = () => {
        $('#duration-field').hidden = !needsDuration(form.mode);
        const { hint, canSubmit } = validateForm(form);
        $('#hint').textContent = hint;
        $('#go').disabled = !canSubmit;
      };
      const press = (buttons, pressed) => {
        for (const b of buttons) b.setAttribute('aria-pressed', String(b === pressed));
      };

      for (const btn of $$('.mode')) {
        btn.addEventListener('click', () => {
          form.mode = btn.dataset.mode;
          press($$('.mode'), btn);
          update();
        });
      }
      for (const chip of $$('.chip[data-d]')) {
        chip.addEventListener('click', () => {
          form.duration = Number(chip.dataset.d);
          form.customDuration = '';
          customInput.value = '';
          customChip.classList.remove('active');
          press($$('.chip[data-d]'), chip);
          update();
        });
      }
      // Durée libre : saisir une valeur désélectionne les durées proposées.
      customInput.addEventListener('input', () => {
        form.customDuration = customInput.value.trim();
        form.duration = parseCustomDuration(form.customDuration);
        customChip.classList.toggle('active', !!form.customDuration);
        press($$('.chip[data-d]'), null);
        update();
      });
      intentInput.addEventListener('input', () => {
        form.intention = intentInput.value;
        update();
      });
      $('#go').addEventListener('click', renderConfirm);
      update();
    }

    function renderConfirm() {
      stopTimer();
      screen.innerHTML = `
        <div class="card center">
          <div class="eyebrow">${esc(modeLabel(form.mode))}</div>
          <h1>${esc(confirmTitle(form))}</h1>
          <p class="quote">${esc(t('quote', form.intention.trim()))}</p>
          <div class="ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle class="ring-bg" cx="60" cy="60" r="52"/>
              <circle class="ring-fg" cx="60" cy="60" r="52" style="animation-duration:${T.COUNTDOWN_S}s"/>
            </svg>
            <span id="count">${T.COUNTDOWN_S}</span>
          </div>
          <p class="lead small" id="msg">${esc(t('confirmPrompt'))}</p>
          <button type="button" class="primary" id="start" disabled>${esc(t('confirmWait'))}</button>
          <button type="button" class="link" id="back">${esc(t('confirmBack'))}</button>
        </div>`;

      let left = T.COUNTDOWN_S;
      timer = setInterval(() => {
        left -= 1;
        $('#count').textContent = String(Math.max(0, left));
        if (left > 0) return;
        stopTimer();
        $('#start').disabled = false;
        $('#start').textContent = t('confirmStart');
        $('#msg').textContent = t('confirmReady');
        $('.ring').classList.add('done');
      }, 1000);
      // Quitter l'onglet pendant la réflexion remet le compteur à zéro.
      onVisibility = () => {
        if (document.hidden) renderConfirm();
      };
      document.addEventListener('visibilitychange', onVisibility);

      $('#back').addEventListener('click', renderForm);
      $('#start').addEventListener('click', () => {
        $('#start').disabled = true;
        const { mode, duration, intention } = form;
        send({ type: MSG.START_SESSION, durationMin: needsDuration(mode) ? duration : null, intention, mode });
      });
    }

    renderForm();
    return stopTimer;
  }

  // --- Fin de session ---------------------------------------------------------

  // Statistiques : durée réelle, bilan du jour (d'après l'historique, qui contient déjà
  // la session qui vient de finir), vidéos et/ou shorts.
  function endTiles(s, history) {
    const nVideos = s.videos.length;
    const nShorts = s.shorts.length;
    const today = totalsSince(history, midnightOf(s.endedAt));
    const tiles = [
      { value: fmtSpent(s.endedAt - s.startedAt), label: t('statSession') },
      { value: fmtSpent(today.ms), label: t('statToday'), sub: plural(today.sessions, 'statSessionsOne', 'statSessionsMany') },
    ];
    const show = countsToShow(nVideos, nShorts);
    if (show.videos) tiles.push({ value: String(nVideos), label: t(nVideos === 1 ? 'statVideo' : 'statVideos') });
    if (show.shorts) tiles.push({ value: String(nShorts), label: t(nShorts === 1 ? 'statShort' : 'statShorts') });
    return tiles
      .map(
        (tile) => `<div class="tile">
          <div class="tile-value">${esc(tile.value)}</div>
          <div class="tile-label">${esc(tile.label)}</div>
          ${tile.sub ? `<div class="tile-sub">${esc(tile.sub)}</div>` : ''}
        </div>`
      )
      .join('');
  }

  function particlesHtml(count = 18) {
    return Array.from({ length: count }, () => {
      const left = Math.round(Math.random() * 100);
      const delay = (Math.random() * 4).toFixed(2);
      const duration = (6 + Math.random() * 6).toFixed(2);
      const size = (3 + Math.random() * 5).toFixed(1);
      return `<span class="p" style="left:${left}%;animation-delay:${delay}s;animation-duration:${duration}s;width:${size}px;height:${size}px"></span>`;
    }).join('');
  }

  function buildEnd(screen) {
    const s = state.session;
    const title = t(s.endReason === 'manual' ? 'endEarly' : 'endTitle');

    screen.innerHTML = `
      <div class="particles" aria-hidden="true">${particlesHtml()}</div>
      <div class="card center end">
        <svg class="check" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="check-circle" cx="60" cy="60" r="52"/>
          <path class="check-mark" d="M38 62 L54 77 L84 45"/>
        </svg>
        <h1 class="fade d1">${esc(title)}</h1>
        <div class="tiles fade d2" id="tiles"></div>
        <p class="quote fade d3">${esc(t('endIntention', s.intention))}</p>
        <p class="lead fade d4">${esc(t('endNext'))}</p>
        <button type="button" class="primary fade d5" id="close">${esc(t('endClose'))}</button>
        <button type="button" class="link fade d5" id="again">${esc(t('endAgain'))}</button>
        <button type="button" class="link fade d5" id="all-history">${esc(t('endAllHistory'))}</button>
      </div>`;

    const $ = (sel) => screen.querySelector(sel);
    $('#close').addEventListener('click', () => send({ type: MSG.CLOSE_TAB }));
    // Mène au formulaire de démarrage (intention + temps de réflexion), pas directement à YouTube.
    $('#again').addEventListener('click', () => {
      state.dismissedEndFor = s.id;
      YSC.refresh();
    });
    $('#all-history').addEventListener('click', () => send({ type: MSG.OPEN_STATS }));

    // Les tuiles apparaissent après 1,45 s (animation) : la lecture du stockage a le temps de finir.
    browser.storage.local.get('history').then(({ history }) => {
      $('#tiles').innerHTML = endTiles(s, history ?? []);
    });
  }

  // --- Vidéo hors session -----------------------------------------------------
  function buildTooLong(screen) {
    const { tooLong } = state.video;
    const detail = YSC.isOvertime()
      ? t('tooLongOvertime')
      : t('tooLongDetail', fmtLeft(tooLong.videoMs), fmtLeft(tooLong.remainingMs));
    screen.innerHTML = `
      <div class="card center">
        <div class="eyebrow">${esc(t('tooLongEyebrow'))}</div>
        <h1>${esc(t('tooLongTitle'))}</h1>
        <p class="lead">${esc(detail)}</p>
      </div>`;
  }

  // --- Vidéo déjà choisie (session « une vidéo ») --------------------------------
  function buildChosen(screen) {
    const id = state.session.chosenVideo; // validé par l'arrière-plan (format d'identifiant YouTube)
    screen.innerHTML = `
      <div class="card center">
        <div class="eyebrow">${esc(modeLabel('one'))}</div>
        <h1>${esc(t('chosenTitle'))}</h1>
        <p class="lead">${esc(t('chosenLead'))}</p>
        <button type="button" class="primary" id="back">${esc(t('chosenBack'))}</button>
      </div>`;
    screen.querySelector('#back').addEventListener('click', () => location.assign(`/watch?v=${id}`));
  }

  return { show };
})();
