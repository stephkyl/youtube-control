'use strict';

// Full-page screens: start (intention + duration + thinking time), end of session, video out of
// session, other page while the video of a one-video session has already been chosen.
// Each lives in a closed Shadow DOM: isolated from YouTube's CSS and unreadable by its scripts.
YSC.overlays = (() => {
  const { config, MSG, t, plural, modeLabel, h, svg, isValidVideoId, fmtSpent, fmtLeft, midnightOf, countsToShow, totalsSince } = YS;
  const { T, state, send } = YSC;
  const html = document.documentElement;

  const DURATION_PRESETS = [5, 10, 15, 30, 60];
  const MODE_DESCRIPTIONS = { all: 'modeAllDesc', long: 'modeLongDesc', one: 'modeOneDesc' };
  const needsDuration = (mode) => mode !== 'one';

  // --- Mounting ---------------------------------------------------------------
  const builders = { start: buildStart, end: buildEnd, toolong: buildTooLong, chosen: buildChosen };

  // Shows the requested screen (or none if view is null). Does not rebuild a screen already shown.
  function show(view) {
    if (!view) return unmount();
    if (state.overlay?.view === view && state.overlay.host.isConnected) return;
    unmount();
    const host = document.createElement('div');
    host.setAttribute('data-ysess', 'overlay');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    // Blocks YouTube's keyboard shortcuts and mouse wheel (Shorts navigation, etc.).
    for (const type of ['keydown', 'keyup', 'keypress', 'wheel', 'touchmove']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    const root = host.attachShadow({ mode: 'closed' });
    const screen = h('div', { class: `screen screen-${view}` });
    root.append(h('style', null, YSC.styles.overlay), screen);
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

  // --- Start ------------------------------------------------------------------

  // Custom duration: integer within bounds, otherwise null.
  function parseCustomDuration(text) {
    const n = Number(text);
    return text !== '' && Number.isInteger(n) && n >= config.MIN_DURATION && n <= config.MAX_DURATION ? n : null;
  }

  // Pure form validation: hint message and whether the button is enabled.
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
    const form = { mode: null, duration: null, customDuration: '', intention: '' }; // no default value
    let timer = null;
    let onVisibility = null;

    const stopTimer = () => {
      clearInterval(timer);
      timer = null;
      if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
      onVisibility = null;
    };
    const press = (buttons, pressed) => {
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === pressed));
    };

    function renderForm() {
      stopTimer();
      const hint = h('div', { class: 'hint' });
      const go = h('button', { type: 'button', class: 'primary', disabled: true, onclick: renderConfirm }, t('startCommit'));

      const modeButtons = config.MODES.map((mode) =>
        h(
          'button',
          {
            type: 'button',
            class: 'mode',
            'aria-pressed': String(mode === form.mode),
            onclick: (e) => {
              form.mode = mode;
              press(modeButtons, e.currentTarget);
              update();
            },
          },
          h('strong', null, modeLabel(mode)),
          h('small', null, t(MODE_DESCRIPTIONS[mode]))
        )
      );

      const presetChips = DURATION_PRESETS.map((d) =>
        h(
          'button',
          {
            type: 'button',
            class: 'chip',
            'aria-pressed': String(d === form.duration && !form.customDuration),
            onclick: (e) => {
              form.duration = d;
              form.customDuration = '';
              customInput.value = '';
              customChip.classList.remove('active');
              press(presetChips, e.currentTarget);
              update();
            },
          },
          t('minutesShort', d)
        )
      );

      // Custom duration: typing a value deselects the preset durations.
      const customInput = h('input', {
        type: 'number',
        inputmode: 'numeric',
        min: config.MIN_DURATION,
        max: config.MAX_DURATION,
        step: 1,
        placeholder: t('startCustomPlaceholder'),
        'aria-label': t('startCustomLabel'),
        oninput: () => {
          form.customDuration = customInput.value.trim();
          form.duration = parseCustomDuration(form.customDuration);
          customChip.classList.toggle('active', !!form.customDuration);
          press(presetChips, null);
          update();
        },
      });
      customInput.value = form.customDuration;
      const customChip = h('label', { class: 'chip custom' }, customInput, h('span', null, 'min'));
      customChip.classList.toggle('active', !!form.customDuration);

      const durationField = h(
        'div',
        { class: 'field' },
        h('div', { class: 'label' }, t('startDurationLabel')),
        h('div', { class: 'chips' }, presetChips, customChip)
      );

      const intentInput = h('textarea', {
        id: 'intent',
        rows: 2,
        maxlength: config.MAX_INTENTION,
        placeholder: t('startIntentionPlaceholder'),
        oninput: () => {
          form.intention = intentInput.value;
          update();
        },
      });
      intentInput.value = form.intention;

      function update() {
        durationField.hidden = !needsDuration(form.mode);
        const { hint: text, canSubmit } = validateForm(form);
        hint.textContent = text;
        go.disabled = !canSubmit;
      }

      screen.replaceChildren(
        h(
          'div',
          { class: 'card' },
          h('div', { class: 'eyebrow' }, t('startEyebrow')),
          h('h1', null, t('startTitle')),
          h('p', { class: 'lead' }, t('startLead')),
          h('div', { class: 'field' }, h('div', { class: 'label' }, t('startModeLabel')), h('div', { class: 'modes' }, modeButtons)),
          durationField,
          h('div', { class: 'field' }, h('label', { class: 'label', for: 'intent' }, t('startIntentionLabel')), intentInput, hint),
          go
        )
      );
      update();
    }

    function renderConfirm() {
      stopTimer();
      const count = h('span', null, T.COUNTDOWN_S);
      const ring = h(
        'div',
        { class: 'ring' },
        svg(
          'svg',
          { viewBox: '0 0 120 120', 'aria-hidden': 'true' },
          svg('circle', { class: 'ring-bg', cx: 60, cy: 60, r: 52 }),
          svg('circle', { class: 'ring-fg', cx: 60, cy: 60, r: 52, style: `animation-duration:${T.COUNTDOWN_S}s` })
        ),
        count
      );
      const msg = h('p', { class: 'lead small' }, t('confirmPrompt'));
      const start = h(
        'button',
        {
          type: 'button',
          class: 'primary',
          disabled: true,
          onclick: () => {
            start.disabled = true;
            const { mode, duration, intention } = form;
            send({ type: MSG.START_SESSION, durationMin: needsDuration(mode) ? duration : null, intention, mode });
          },
        },
        t('confirmWait')
      );

      screen.replaceChildren(
        h(
          'div',
          { class: 'card center' },
          h('div', { class: 'eyebrow' }, modeLabel(form.mode)),
          h('h1', null, confirmTitle(form)),
          h('p', { class: 'quote' }, t('quote', form.intention.trim())),
          ring,
          msg,
          start,
          h('button', { type: 'button', class: 'link', onclick: renderForm }, t('confirmBack'))
        )
      );

      let left = T.COUNTDOWN_S;
      timer = setInterval(() => {
        left -= 1;
        count.textContent = String(Math.max(0, left));
        if (left > 0) return;
        stopTimer();
        start.disabled = false;
        start.textContent = t('confirmStart');
        msg.textContent = t('confirmReady');
        ring.classList.add('done');
      }, 1000);
      // Leaving the tab during the thinking time resets the countdown.
      onVisibility = () => {
        if (document.hidden) renderConfirm();
      };
      document.addEventListener('visibilitychange', onVisibility);
    }

    renderForm();
    return stopTimer;
  }

  // --- End of session ---------------------------------------------------------

  // Stats: actual duration, today's total (from the history, which already contains
  // the session that just ended), videos and/or shorts.
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
    return tiles.map((tile) =>
      h(
        'div',
        { class: 'tile' },
        h('div', { class: 'tile-value' }, tile.value),
        h('div', { class: 'tile-label' }, tile.label),
        tile.sub && h('div', { class: 'tile-sub' }, tile.sub)
      )
    );
  }

  function particles(count = 18) {
    return Array.from({ length: count }, () => {
      const left = Math.round(Math.random() * 100);
      const delay = (Math.random() * 4).toFixed(2);
      const duration = (6 + Math.random() * 6).toFixed(2);
      const size = (3 + Math.random() * 5).toFixed(1);
      const style = `left:${left}%;animation-delay:${delay}s;animation-duration:${duration}s;width:${size}px;height:${size}px`;
      return h('span', { class: 'p', style });
    });
  }

  function buildEnd(screen) {
    const s = state.session;
    const title = t(s.endReason === 'manual' ? 'endEarly' : 'endTitle');
    const tiles = h('div', { class: 'tiles fade d2' });
    const button = (cls, label, onclick) => h('button', { type: 'button', class: `${cls} fade d5`, onclick }, label);

    screen.replaceChildren(
      h('div', { class: 'particles', 'aria-hidden': 'true' }, particles()),
      h(
        'div',
        { class: 'card center end' },
        svg(
          'svg',
          { class: 'check', viewBox: '0 0 120 120', 'aria-hidden': 'true' },
          svg('circle', { class: 'check-circle', cx: 60, cy: 60, r: 52 }),
          svg('path', { class: 'check-mark', d: 'M38 62 L54 77 L84 45' })
        ),
        h('h1', { class: 'fade d1' }, title),
        tiles,
        h('p', { class: 'quote fade d3' }, t('endIntention', s.intention)),
        h('p', { class: 'lead fade d4' }, t('endNext')),
        button('primary', t('endClose'), () => send({ type: MSG.CLOSE_TAB })),
        // Leads to the start form (intention + thinking time), not straight to YouTube.
        button('link', t('endAgain'), () => {
          state.dismissedEndFor = s.id;
          YSC.refresh();
        }),
        button('link', t('endAllHistory'), () => send({ type: MSG.OPEN_STATS }))
      )
    );

    // Tiles appear after 1.45 s (animation): reading storage has time to finish.
    browser.storage.local.get('history').then(({ history }) => {
      tiles.replaceChildren(...endTiles(s, history ?? []));
    });
  }

  // Simple centered card: out-of-session and already-chosen screens.
  const simpleCard = (eyebrow, title, lead, ...extra) =>
    h('div', { class: 'card center' }, h('div', { class: 'eyebrow' }, eyebrow), h('h1', null, title), h('p', { class: 'lead' }, lead), extra);

  // --- Video out of session ---------------------------------------------------
  function buildTooLong(screen) {
    const { tooLong } = state.video;
    const detail = YSC.isOvertime()
      ? t('tooLongOvertime')
      : t('tooLongDetail', fmtLeft(tooLong.videoMs), fmtLeft(tooLong.remainingMs));
    screen.replaceChildren(simpleCard(t('tooLongEyebrow'), t('tooLongTitle'), detail));
  }

  // --- Video already chosen (one-video session) ---------------------------------
  function buildChosen(screen) {
    // Value read from storage: checked again before building the URL.
    const id = state.session.chosenVideo;
    const url = isValidVideoId(id) ? `/watch?v=${id}` : '/';
    const back = h('button', { type: 'button', class: 'primary', onclick: () => location.assign(url) }, t('chosenBack'));
    screen.replaceChildren(simpleCard(modeLabel('one'), t('chosenTitle'), t('chosenLead'), back));
  }

  return { show };
})();
