'use strict';

// Pill at the bottom left: time left; on hover, an "End" button;
// on click, inline confirmation.
YSC.pill = (() => {
  const { MSG, t, plural, minutesLeft, h } = YS;
  const { T, state, isRunning, isOvertime, isOneVideo, isOnLastShort, remainingMs, send } = YSC;

  let pill = null; // { host, box, txt }

  function create() {
    const host = h('div', { 'data-ysess': 'pill' });
    host.style.cssText = 'all:initial;position:fixed;left:16px;bottom:16px;z-index:2147483646;';
    // Enter or Space on the buttons must not trigger YouTube's shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (e) => e.stopPropagation());
    let timer = null;
    const closeConfirm = () => {
      clearTimeout(timer);
      box.classList.remove('confirming');
    };
    const openConfirm = () => {
      box.classList.add('confirming');
      no.focus();
      clearTimeout(timer);
      timer = setTimeout(closeConfirm, T.PILL_CONFIRM_MS);
    };
    const confirmEnd = () => {
      closeConfirm();
      send({ type: MSG.END_SESSION, reason: 'manual' });
    };

    const txt = h('span', { class: 'txt' });
    const no = h('button', { type: 'button', class: 'no', onclick: closeConfirm }, t('pillNo'));
    const box = h(
      'div',
      { class: 'pill' },
      h('span', { class: 'dot' }),
      txt,
      h('button', { type: 'button', class: 'end', onclick: openConfirm }, t('pillEnd')),
      h(
        'span',
        { class: 'confirm' },
        h('span', null, t('pillConfirm')),
        h('button', { type: 'button', class: 'yes', onclick: confirmEnd }, t('pillYes')),
        no
      )
    );
    host.attachShadow({ mode: 'closed' }).append(h('style', null, YSC.styles.pill), box);
    document.documentElement.appendChild(host);
    return { host, box, txt };
  }

  function text() {
    if (isOneVideo()) return t(state.session.chosenVideo ? 'oneVideoChosen' : 'oneVideoChoose');
    if (isOnLastShort()) return t('lastShort');
    if (isOvertime()) return t('lastVideo');
    return plural(minutesLeft(remainingMs()), 'pillLeftOne', 'pillLeftMany');
  }

  function update() {
    if (!isRunning() || state.overlay) {
      pill?.host.remove();
      pill = null;
      return;
    }
    if (!pill?.host.isConnected) pill = create();
    const label = text();
    if (pill.txt.textContent !== label) pill.txt.textContent = label;
    pill.box.classList.toggle('low', !isOneVideo() && (isOvertime() || remainingMs() < T.PILL_LOW_MS));
  }

  return { update };
})();
