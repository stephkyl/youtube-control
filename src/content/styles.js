'use strict';

// Styles des écrans plein page et de la pastille, injectés dans leur Shadow DOM.
// Les couleurs viennent de src/theme.css (variables --ys-*, héritées à travers le Shadow DOM).
// `mix(couleur, %)` : version translucide d'une couleur de la palette.
YSC.styles = (() => {
  const mix = (color, pct) => `color-mix(in srgb, var(--ys-${color}) ${pct}%, transparent)`;

  const overlay = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .screen {
      position: fixed; inset: 0; overflow: auto;
      display: grid; place-items: center; padding: 24px 16px;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--ys-text); -webkit-font-smoothing: antialiased;
      background:
        radial-gradient(1100px 800px at 15% 10%, var(--ys-glow-1) 0%, transparent 60%),
        radial-gradient(900px 700px at 90% 95%, var(--ys-glow-2) 0%, transparent 55%),
        var(--ys-bg);
    }
    .screen-end {
      background:
        radial-gradient(1000px 800px at 20% 0%, var(--ys-end-glow-1) 0%, transparent 60%),
        radial-gradient(900px 700px at 90% 100%, var(--ys-end-glow-2) 0%, transparent 55%),
        var(--ys-end-bg);
    }
    .card {
      position: relative; z-index: 1;
      width: min(560px, 100%);
      background: rgba(255,255,255,.045);
      border: 1px solid rgba(255,255,255,.09);
      border-radius: 22px; padding: 36px 32px;
      box-shadow: 0 30px 80px rgba(0,0,0,.35);
      animation: rise .55s cubic-bezier(.2,.8,.2,1) both;
    }
    .center { text-align: center; }
    .eyebrow { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--ys-muted); margin-bottom: 12px; }
    h1 { font-size: 27px; line-height: 1.25; margin: 0 0 12px; font-weight: 650; letter-spacing: -.01em; }
    .lead { color: var(--ys-text-soft); font-size: 15px; line-height: 1.55; margin: 0 0 26px; }
    .lead.small { font-size: 14px; margin-bottom: 20px; }
    .quote { font-size: 16px; line-height: 1.5; color: var(--ys-quote); margin: 0 0 22px; font-style: italic; overflow-wrap: anywhere; }

    /* Formulaire de démarrage */
    .field { margin-bottom: 22px; }
    .label { display: block; font-size: 13px; font-weight: 600; color: var(--ys-label); margin-bottom: 10px; }
    .modes { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
    .mode {
      font: inherit; text-align: left; padding: 12px 14px; border-radius: 14px; cursor: pointer;
      border: 1px solid rgba(255,255,255,.16); background: transparent; color: var(--ys-text);
      transition: background .15s, border-color .15s;
    }
    .mode:hover { border-color: rgba(255,255,255,.4); }
    .mode strong { display: block; font-size: 14px; margin-bottom: 3px; }
    .mode small { display: block; font-size: 12px; line-height: 1.4; color: var(--ys-muted); }
    .mode[aria-pressed="true"] { border-color: var(--ys-accent); background: ${mix('accent', 12)}; }
    .mode[aria-pressed="true"] strong { color: var(--ys-quote); }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      font: inherit; font-size: 14px; padding: 9px 15px; border-radius: 999px;
      border: 1px solid rgba(255,255,255,.16); background: transparent; color: var(--ys-text);
      cursor: pointer; transition: background .15s, border-color .15s, color .15s;
    }
    .chip:hover { border-color: rgba(255,255,255,.4); }
    .chip[aria-pressed="true"] { background: var(--ys-accent); border-color: var(--ys-accent); color: var(--ys-accent-ink); font-weight: 600; }
    .chip.custom { display: inline-flex; align-items: center; gap: 4px; padding: 5px 14px 5px 10px; cursor: text; }
    .chip.custom:focus-within, .chip.custom.active { border-color: var(--ys-accent); }
    .chip.custom input {
      width: 5.5em; font: inherit; font-size: 14px; padding: 4px 6px; border: 0; border-radius: 6px;
      background: rgba(0,0,0,.25); color: var(--ys-text); outline: none; -moz-appearance: textfield; text-align: right;
    }
    .chip.custom input::placeholder { color: var(--ys-placeholder); text-align: left; }
    .chip.custom span { color: var(--ys-text-soft); }
    textarea {
      width: 100%; font: inherit; font-size: 15px; line-height: 1.5; padding: 12px 14px;
      border-radius: 12px; border: 1px solid rgba(255,255,255,.16); background: rgba(0,0,0,.25);
      color: var(--ys-text); resize: vertical; outline: none;
    }
    textarea:focus { border-color: var(--ys-accent); }
    textarea::placeholder { color: var(--ys-placeholder); }
    .hint { font-size: 12px; color: var(--ys-faint); margin-top: 8px; min-height: 1.2em; }

    /* Boutons */
    .primary {
      font: inherit; font-size: 15px; font-weight: 600; width: 100%; padding: 14px 18px;
      border: 0; border-radius: 12px; cursor: pointer; transition: opacity .2s, transform .1s;
      background: var(--ys-accent); color: var(--ys-accent-ink);
    }
    .primary:active { transform: scale(.99); }
    .primary:disabled { opacity: .35; cursor: not-allowed; }
    .link {
      display: inline-block; font: inherit; font-size: 13px; background: none; border: 0; color: var(--ys-faint);
      cursor: pointer; text-decoration: underline; text-underline-offset: 3px; padding: 8px; margin-top: 12px;
    }
    .screen-end .primary { background: var(--ys-mint); }

    /* Compte à rebours */
    .ring { position: relative; width: 120px; height: 120px; margin: 4px auto 18px; }
    .ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .ring circle { fill: none; stroke-width: 6; }
    .ring-bg { stroke: rgba(255,255,255,.1); }
    .ring-fg { stroke: var(--ys-accent); stroke-linecap: round; stroke-dasharray: 327; stroke-dashoffset: 327; animation: fill linear forwards; }
    .ring span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 34px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .ring.done span { color: var(--ys-accent); }

    /* Écran de fin : coche, statistiques */
    .check { width: 104px; height: 104px; margin: 0 auto 18px; display: block; }
    .check-circle { fill: ${mix('mint', 8)}; stroke: var(--ys-mint); stroke-width: 5; stroke-dasharray: 327; stroke-dashoffset: 327;
      transform-origin: center; transform: rotate(-90deg); animation: fill 1s cubic-bezier(.65,0,.35,1) .15s forwards, glow 3.5s ease-in-out 1.6s infinite; }
    .check-mark { fill: none; stroke: var(--ys-mint); stroke-width: 7; stroke-linecap: round; stroke-linejoin: round;
      stroke-dasharray: 80; stroke-dashoffset: 80; animation: fill .5s cubic-bezier(.65,0,.35,1) 1s forwards; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin: 6px 0 22px; }
    .tile { padding: 12px 10px; border-radius: 14px; background: ${mix('mint', 6)}; border: 1px solid ${mix('mint', 16)}; }
    .tile-value { font-size: 22px; font-weight: 650; color: var(--ys-text); font-variant-numeric: tabular-nums; line-height: 1.2; }
    .tile-label { font-size: 12px; color: var(--ys-mint-soft); margin-top: 4px; letter-spacing: .02em; }
    .tile-sub { font-size: 11px; color: var(--ys-mint-faint); margin-top: 2px; }

    /* Animations */
    .fade { opacity: 0; animation: rise .7s cubic-bezier(.2,.8,.2,1) forwards; }
    .d1 { animation-delay: 1.2s; } .d2 { animation-delay: 1.45s; } .d3 { animation-delay: 1.7s; }
    .d4 { animation-delay: 1.95s; } .d5 { animation-delay: 2.3s; }
    .particles { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
    .p { position: absolute; bottom: -12px; border-radius: 50%; background: ${mix('quote', 55)}; filter: blur(.5px);
      animation: float linear infinite; opacity: 0; }
    @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @keyframes fill { to { stroke-dashoffset: 0; } }
    @keyframes glow { 0%, 100% { filter: drop-shadow(0 0 0 transparent); } 50% { filter: drop-shadow(0 0 14px ${mix('mint', 45)}); } }
    @keyframes float { 0% { transform: translateY(0); opacity: 0; } 15% { opacity: .9; } 100% { transform: translateY(-105vh); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; }
      .p { display: none; }
    }
  `;

  const pill = `
    .pill {
      display: inline-flex; align-items: center; gap: 8px;
      font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--ys-text); background: ${mix('bg', 82)}; border: 1px solid rgba(255,255,255,.12);
      padding: 8px 12px; border-radius: 999px; box-shadow: 0 6px 20px rgba(0,0,0,.25);
      font-variant-numeric: tabular-nums;
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ys-mint); flex: none; }
    .low .dot { background: var(--ys-accent); }
    button {
      font: inherit; font-size: 12px; border-radius: 999px; padding: 4px 10px; cursor: pointer;
      border: 1px solid rgba(255,255,255,.2); background: transparent; color: var(--ys-text);
    }
    button:hover { border-color: rgba(255,255,255,.45); }
    button:focus-visible { outline: 2px solid var(--ys-accent); outline-offset: 1px; }
    .yes { background: var(--ys-accent); border-color: var(--ys-accent); color: var(--ys-accent-ink); }
    /* Bouton « Terminer » : visible au survol ou au clavier seulement. */
    .end { display: none; }
    .pill:hover .end, .pill:focus-within .end { display: inline-block; }
    /* Confirmation : remplace le contenu de la pastille. */
    .confirm { display: none; align-items: center; gap: 6px; }
    .confirming .confirm { display: inline-flex; }
    .confirming .txt, .confirming .end, .confirming .dot { display: none !important; }
  `;

  return { overlay, pill };
})();
