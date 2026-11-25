/**
 * Widget CSS. It goes into each widget's Shadow DOM, so it and the host page's CSS never affect each other.
 * Colors and fonts come from the theme's CSS variables (--kc-*).
 */
export const widgetCss = `
/*
 * Widget chrome. Colors and fonts come from the chart theme's CSS variables (--kc-*).
 *
 * Principles:
 *   - borders and rules are 1px hairlines; shadows only, and faintly, on floating surfaces (menus); no gradients
 *   - corners are 2px; selection is shown by inverting light and dark or by an underline, not by color
 *   - the accent color (vermilion) is used only for marks and underlines
 *   - body text in the OS sans-serif, digits monospaced
 */
:host { display: block; }
:host(kiseki-advanced-chart) { height: 560px; }
:host(kiseki-symbol-overview) { height: 440px; }
:host(kiseki-mini-chart) { height: 212px; }
:host(kiseki-ticker-tape) { height: 46px; }

*, *::before, *::after { box-sizing: border-box; }
.kw-root {
  height: 100%;
  background: var(--kc-bg);
  color: var(--kc-text);
  font: 13px/1.5 var(--kc-font);
  /* tighten kana and punctuation so Japanese labels and headings space naturally */
  font-feature-settings: 'palt';
  text-align: left;
  /* responsive rules follow the widget's own width, not the viewport */
  container-type: inline-size;
}
/* Light text on dark looks heavier, so render it thinner only there. */
.kw-root[data-theme='dark'] { -webkit-font-smoothing: antialiased; }
button { font: inherit; color: inherit; }

/* ───── Advanced chart ───── */
.kw-workspace { display: flex; flex-direction: column; overflow: hidden; }
.kw-workspace > .mast { flex: none; height: 56px; }
.kw-workspace > .strip { flex: none; height: 36px; }
.kw-workspace > .stage { flex: 1; }
.kw-workspace > .dock { flex: none; height: 34px; }
.kw-workspace.no-mast > .mast, .kw-workspace.no-strip > .strip, .kw-workspace.no-dock > .dock { display: none; }

.spacer { flex: 1; min-width: 8px; }
.sep { flex: none; width: 1px; height: 18px; background: var(--kc-border); margin: 0 8px; }
.muted { color: var(--kc-muted); }

/* ───── Header: symbol and quote ───── */
.mast {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px 0 14px;
  border-bottom: 1px solid var(--kc-border);
  overflow: hidden;
  white-space: nowrap;
}
.brand { margin-right: 12px; font-size: 13px; font-weight: 600; letter-spacing: .04em; color: var(--kc-muted); }

.symbol {
  display: flex; align-items: baseline; gap: 10px;
  height: 40px; padding: 0 8px;
  border: 0; border-radius: 2px; background: none;
  cursor: pointer;
  flex: 0 1 auto;
  min-width: 0;
}
.symbol:hover { background: var(--kc-surface); }
.symbol .sym { font-size: 19px; font-weight: 700; line-height: 40px; letter-spacing: .01em; }
.symbol .sym { flex: none; }
.symbol .desc { flex: 0 1 auto; min-width: 0; color: var(--kc-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.symbol svg { flex: none; }
.symbol svg { align-self: center; }

.quote { display: flex; align-items: baseline; gap: 10px; margin-left: 10px; flex: none; }
.quote .last { font: 500 20px/1 var(--kc-mono); letter-spacing: -.01em; }
.quote .chg { font: 12px/1 var(--kc-mono); }
.quote .chg.up { color: var(--kc-up); }
.quote .chg.down { color: var(--kc-down); }
.quote .note { color: var(--kc-faint); font-size: 11px; }

/* ───── Buttons ───── */
.btn {
  flex: none;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 28px; min-width: 28px; padding: 0 8px;
  border: 0; border-radius: 2px; background: none;
  white-space: nowrap; cursor: pointer;
}
.btn:hover { background: var(--kc-surface); }
.btn.on { background: var(--kc-text); color: var(--kc-bg); }
.btn.icon { padding: 0; width: 28px; }
.btn:disabled { opacity: .35; cursor: default; background: none; }
.btn:focus-visible, .tab:focus-visible, .symbol:focus-visible,
.field input:focus-visible, .field select:focus-visible { outline: 1px solid var(--kc-text); outline-offset: 1px; }
.btn svg, .item svg, .symbol svg {
  width: 17px; height: 17px; flex: none;
  fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
}
.btn .caret, .symbol .caret, .tab .caret { width: 9px; height: 9px; opacity: .55; stroke-width: 2.2; }
.btn.outline { border: 1px solid var(--kc-border); }
.btn.outline:hover { border-color: var(--kc-text); background: none; }
.btn.primary { background: var(--kc-text); color: var(--kc-bg); padding: 0 14px; }

/* Live: the dot stays still. No motion to grab attention. */
.btn.live { gap: 7px; }
.btn.live .dot { width: 6px; height: 6px; background: var(--kc-faint); }
.btn.live.on { background: none; color: var(--kc-text); }
.btn.live.on .dot { background: var(--kc-accent); }
.btn.live.on:hover { background: var(--kc-surface); }
.btn.num { font: 12px/1 var(--kc-mono); color: var(--kc-muted); padding: 0 6px; }

/* ───── Control strip: timeframes etc. ───── */
.strip {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 12px 0 14px;
  border-bottom: 1px solid var(--kc-border);
  overflow-x: auto;
  scrollbar-width: none;
  white-space: nowrap;
}
.strip::-webkit-scrollbar, .dock::-webkit-scrollbar { display: none; }
.tab {
  flex: none;
  display: inline-flex; align-items: center; gap: 4px;
  height: 35px; padding: 0 7px;
  border: 0; background: none;
  color: var(--kc-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
}
.tab:hover { color: var(--kc-text); }
.tab.on { color: var(--kc-text); font-weight: 600; border-bottom-color: var(--kc-accent); }
.tab:disabled { opacity: .3; cursor: default; }
.label { color: var(--kc-faint); font-size: 11px; margin-right: 6px; }
.seg { display: inline-flex; border: 1px solid var(--kc-border); border-radius: 2px; }
.seg .btn { height: 22px; min-width: 0; padding: 0 9px; border-radius: 0; font-size: 12px; color: var(--kc-muted); }
.seg .btn + .btn { border-left: 1px solid var(--kc-border); }
.seg .btn.on { color: var(--kc-bg); }

.stage { position: relative; min-width: 0; min-height: 0; }
.stage.drop::after {
  content: attr(data-drop);
  position: absolute; inset: 10px;
  display: grid; place-items: center;
  border: 1px dashed var(--kc-text);
  background: color-mix(in srgb, var(--kc-bg) 86%, transparent);
  font-size: 15px; font-weight: 600;
  pointer-events: none;
}

/* Small bar shown for the selected drawing. */
.floatbar {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  display: none; align-items: center; gap: 5px;
  padding: 4px 6px;
  background: var(--kc-bg); border: 1px solid var(--kc-faint); border-radius: 3px;
  z-index: 5;
}
.floatbar.show { display: flex; }
.swatch { width: 16px; height: 16px; border-radius: 2px; border: 0; padding: 0; cursor: pointer; outline: 1px solid transparent; outline-offset: 2px; }
.swatch:hover { outline-color: var(--kc-faint); }
.swatch.on { outline-color: var(--kc-text); }

/* ───── Bottom dock: drawing tools ───── */
.dock {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 0 12px 0 10px;
  border-top: 1px solid var(--kc-border);
  overflow-x: auto;
  scrollbar-width: none;
  white-space: nowrap;
}
.dock .btn { height: 26px; min-width: 26px; }
.dock .btn.icon { width: 30px; }
.dock .info { font: 11px/1 var(--kc-mono); color: var(--kc-faint); padding-left: 12px; }

/* ───── Menus / dialogs ───── */
.menu {
  position: fixed;
  z-index: 50;
  min-width: 220px;
  max-height: min(70vh, 560px);
  overflow-y: auto;
  padding: 5px;
  background: var(--kc-bg);
  border: 1px solid var(--kc-faint);
  border-radius: 3px;
  box-shadow: 0 6px 20px color-mix(in srgb, var(--kc-text) 10%, transparent);
}
.item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 6px 9px;
  border: 0; border-radius: 2px; background: none;
  text-align: left; white-space: nowrap;
  cursor: pointer;
}
.item:hover, .item:focus-visible { background: var(--kc-surface); outline: none; }
.item.on { font-weight: 600; }
.item:disabled { opacity: .35; cursor: default; background: none; }
.item .grow { flex: 1; min-width: 0; }
.item small { display: block; color: var(--kc-muted); font-size: 11.5px; font-weight: 400; }
.item kbd, .guide kbd {
  font: 11px/1 var(--kc-mono); color: var(--kc-muted);
  padding: 3px 5px; border: 1px solid var(--kc-border); border-radius: 2px;
}
.menu h6, .form h6, .dialog h6 {
  margin: 10px 9px 4px; font-size: 11px; font-weight: 400; color: var(--kc-faint); letter-spacing: .04em;
}
.menu h6:first-child { margin-top: 4px; }
.menu .row { display: flex; flex-wrap: wrap; gap: 2px; padding: 0 5px 2px; }
.menu hr { border: 0; border-top: 1px solid var(--kc-border); margin: 5px 4px; }

.backdrop {
  position: fixed; inset: 0; z-index: 60;
  display: grid; place-items: start center;
  padding-top: min(14vh, 120px);
  background: color-mix(in srgb, var(--kc-bg) 62%, transparent);
}
.dialog {
  width: min(460px, calc(100vw - 24px));
  max-height: 72vh;
  display: flex; flex-direction: column;
  background: var(--kc-bg);
  border: 1px solid var(--kc-faint);
  border-radius: 3px;
  box-shadow: 0 10px 32px color-mix(in srgb, var(--kc-text) 12%, transparent);
  overflow: hidden;
}
.dialog header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 10px 9px 16px;
  border-bottom: 1px solid var(--kc-border);
  font-size: 15px; font-weight: 600; line-height: 1.3;
}
.dialog header .grow { flex: 1; }
.dialog .body { padding: 6px 8px 10px; overflow-y: auto; }
.dialog .search {
  margin: 10px 8px 4px; padding: 0 10px; height: 34px; width: calc(100% - 16px);
  background: var(--kc-bg); color: var(--kc-text);
  border: 0; border-bottom: 1px solid var(--kc-text); border-radius: 0;
  font: inherit; outline: none;
}
.dialog .search::placeholder { color: var(--kc-faint); }
.badge { font: 11px/1 var(--kc-mono); color: var(--kc-muted); border: 1px solid var(--kc-border); border-radius: 2px; padding: 3px 6px; }

.form { display: grid; grid-template-columns: 1fr 150px; gap: 8px 12px; align-items: center; padding: 4px 8px 6px; }
.form h6 { grid-column: 1 / 3; margin: 8px 0 0; }
.field input, .field select {
  width: 100%; height: 28px; padding: 0 8px;
  background: var(--kc-bg); color: var(--kc-text);
  border: 1px solid var(--kc-border); border-radius: 2px;
  font: 12px var(--kc-mono);
}
.field select { font-family: var(--kc-font); }
.field input[type='color'] { padding: 2px; cursor: pointer; }
.dialog footer { display: flex; justify-content: flex-end; gap: 6px; padding: 9px 10px; border-top: 1px solid var(--kc-border); }

.guide { display: grid; grid-template-columns: auto 1fr; gap: 9px 14px; padding: 8px 10px; align-items: center; }
.guide span:nth-child(odd) { display: flex; gap: 4px; white-space: nowrap; }

.toast {
  position: fixed; left: 50%; bottom: 48px; transform: translateX(-50%);
  z-index: 70; padding: 7px 12px;
  background: var(--kc-text); color: var(--kc-bg);
  border-radius: 2px; font-size: 12.5px;
}

.show-narrow { display: none; }

@container (max-width: 1180px) {
  .quote .note { display: none; }
}

@container (max-width: 760px) {
  .hide-narrow { display: none !important; }
  .show-narrow { display: inline; }
  .kw-workspace > .mast { height: 48px; }
  .mast { padding: 0 6px 0 8px; }
  .symbol { flex: none; padding: 0 4px; gap: 5px; }
  .quote .chg { font-size: 11px; }
  .symbol .sym { font-size: 17px; }
  .quote { margin-left: 2px; gap: 7px; }
  .quote .last { font-size: 17px; }
  .strip, .dock { padding: 0 6px; }
}

/* ───── Shared by card widgets ───── */
.kw-card {
  display: flex; flex-direction: column;
  border: 1px solid var(--kc-border); border-radius: 4px;
  overflow: hidden;
}
.chg { font: 12px/1.2 var(--kc-mono); white-space: nowrap; }
.chg.up { color: var(--kc-up); }
.chg.down { color: var(--kc-down); }
.plot { position: relative; flex: 1; min-height: 40px; }
.kw-empty { display: grid; place-items: center; height: 100%; color: var(--kc-faint); font-size: 12px; }

/* ───── Mini chart ───── */
.kw-mini { padding: 12px 14px 10px; gap: 5px; }
.kw-mini .head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.kw-mini .sym { font-size: 14px; font-weight: 700; }
.kw-mini .desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--kc-muted); font-size: 11.5px; }
.kw-mini .when { color: var(--kc-faint); font-size: 11px; white-space: nowrap; }
.kw-mini .price { display: flex; align-items: baseline; gap: 10px; }
.kw-mini .last { font: 500 22px/1.15 var(--kc-mono); letter-spacing: -.01em; }
.kw-mini .plot { margin: 2px -14px 0; }
@container (max-width: 300px) { .kw-mini .abs { display: none; } }
.brand[hidden] { display: none; }
/* where the price sits between the period low and high */
.band { display: flex; align-items: center; gap: 8px; font: 10.5px/1 var(--kc-mono); color: var(--kc-muted); }
.band .track { position: relative; flex: 1; height: 3px; border-radius: 2px; background: var(--kc-border); }
.band .dot {
  position: absolute; top: 50%; width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px;
  border-radius: 50%; background: var(--kc-text); box-shadow: 0 0 0 2px var(--kc-bg);
}

/* ───── Symbol overview ───── */
.kw-overview .tabs { display: flex; flex: none; gap: 2px; padding: 0 10px; border-bottom: 1px solid var(--kc-border); overflow-x: auto; scrollbar-width: none; }
.kw-overview .head { display: flex; flex: none; flex-wrap: wrap; align-items: flex-end; gap: 6px 18px; padding: 12px 16px 10px; }
.kw-overview .id { min-width: 0; }
.kw-overview .sym { font-size: 17px; font-weight: 700; line-height: 1.2; }
.kw-overview .desc { color: var(--kc-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kw-overview .price { display: flex; align-items: baseline; gap: 10px; }
.kw-overview .last { font: 500 26px/1.1 var(--kc-mono); letter-spacing: -.01em; }
.kw-overview .when { color: var(--kc-faint); font-size: 11px; }
.kw-overview .tools { display: flex; align-items: center; gap: 6px; }
.kw-overview .stats { display: grid; flex: none; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; border-top: 1px solid var(--kc-border); }
.kw-overview .stats div { padding: 7px 16px 8px; min-width: 0; }
.kw-overview .stats div + div { border-left: 1px solid var(--kc-border); }
.kw-overview .stats dt { color: var(--kc-faint); font-size: 11px; white-space: nowrap; }
.kw-overview .stats dd { margin: 0; font: 13px/1.3 var(--kc-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@container (max-width: 520px) {
  .kw-overview .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kw-overview .stats div:nth-child(3) { border-left: 0; }
  .kw-overview .stats div:nth-child(n + 3) { border-top: 1px solid var(--kc-border); }
  .kw-overview .last { font-size: 22px; }
}

/* ───── Ticker tape ───── */
.kw-tape { display: flex; align-items: stretch; border-block: 1px solid var(--kc-border); overflow: hidden; }
.kw-tape .view { flex: 1; min-width: 0; overflow: hidden; }
.kw-tape .track { display: flex; width: max-content; height: 100%; animation: kw-tape var(--kw-duration, 60s) linear infinite; }
/* Make it pausable: hover, keyboard focus, or the button on the right. */
.kw-tape.paused .track, .kw-tape .view:hover .track, .kw-tape .view:focus-within .track { animation-play-state: paused; }
@keyframes kw-tape { to { transform: translateX(-50%); } }
.kw-tape .cell {
  display: flex; align-items: center; gap: 10px;
  padding: 0 18px; border: 0; border-right: 1px solid var(--kc-border); background: none;
  white-space: nowrap; cursor: pointer;
}
.kw-tape .cell:hover { background: var(--kc-surface); }
.kw-tape .cell:focus-visible { outline: 1px solid var(--kc-text); outline-offset: -3px; }
.kw-tape .sym { font-weight: 600; }
.kw-tape .last { font: 13px/1 var(--kc-mono); }
.kw-tape .spark { width: 56px; height: 18px; fill: none; stroke-width: 1.25; stroke-linejoin: round; stroke-linecap: round; }
.kw-tape .ctl { flex: none; width: 40px; height: auto; border-left: 1px solid var(--kc-border); border-radius: 0; color: var(--kc-muted); }
.kw-tape.still .view { overflow-x: auto; scrollbar-width: none; }
.kw-tape.still .track { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .kw-tape .view { overflow-x: auto; scrollbar-width: none; }
  .kw-tape .track { animation: none; }
  .kw-tape .ctl { display: none; }
}
`;
