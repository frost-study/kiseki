/** The minimal CSS the chart itself needs (DOM parts such as the legend). Injected once. */
const css = `
.kc-root{position:relative;width:100%;height:100%;overflow:hidden;outline:none;user-select:none;-webkit-user-select:none;touch-action:none;
  background:var(--kc-bg);color:var(--kc-text);font:12px/1.4 var(--kc-font);-webkit-tap-highlight-color:transparent}
.kc-root canvas{position:absolute;inset:0;display:block}
.kc-layer{position:absolute;inset:0;pointer-events:none}
.kc-legend{position:absolute;left:6px;display:flex;flex-direction:column;align-items:flex-start;max-width:calc(100% - 90px)}
.kc-row{display:flex;align-items:baseline;gap:7px;height:19px;line-height:19px;padding:0 5px;white-space:nowrap;pointer-events:auto;max-width:100%;
  background:color-mix(in srgb,var(--kc-bg) 78%,transparent)}
.kc-row:hover{background:var(--kc-surface)}
.kc-row.kc-off .kc-name,.kc-row.kc-off .kc-vals{opacity:.4}
.kc-title{font-weight:600}
.kc-sub{color:var(--kc-muted)}
.kc-name{color:var(--kc-muted)}
.kc-vals{display:flex;gap:9px;overflow:hidden;font:11px/19px var(--kc-mono)}
.kc-vals i{font:11px/19px var(--kc-font);font-style:normal;color:var(--kc-faint);margin-right:3px}
.kc-actions{display:none;align-self:center;gap:0;margin-left:2px}
.kc-row:hover .kc-actions{display:flex}
.kc-actions button{all:unset;display:grid;place-items:center;width:20px;height:17px;border-radius:2px;color:var(--kc-muted);cursor:pointer}
.kc-actions button:hover{background:var(--kc-text);color:var(--kc-bg)}
.kc-actions svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.kc-live{position:absolute;display:none;place-items:center;width:26px;height:26px;border-radius:2px;pointer-events:auto;cursor:pointer;padding:0;
  background:var(--kc-bg);border:1px solid var(--kc-border);color:var(--kc-muted)}
.kc-live:hover{color:var(--kc-bg);background:var(--kc-text);border-color:var(--kc-text)}
.kc-live svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
`;

/**
 * Inject the chart CSS once into the document (or Shadow DOM) that `container` belongs to.
 */
export function ensureStyles(container = null) {
  const scope = container?.getRootNode?.();
  const target = typeof ShadowRoot !== 'undefined' && scope instanceof ShadowRoot ? scope : document.head;
  if (target.querySelector('#kc-styles')) return;
  const el = document.createElement('style');
  el.id = 'kc-styles';
  el.textContent = css;
  target.append(el);
}

/** Apply a theme to an element as CSS variables. */
export function applyThemeVars(el, theme) {
  const s = el.style;
  s.setProperty('--kc-bg', theme.bg);
  s.setProperty('--kc-surface', theme.surface);
  s.setProperty('--kc-hover', theme.surfaceHover);
  s.setProperty('--kc-border', theme.border);
  s.setProperty('--kc-text', theme.text);
  s.setProperty('--kc-muted', theme.textMuted);
  s.setProperty('--kc-faint', theme.textFaint);
  s.setProperty('--kc-accent', theme.accent);
  s.setProperty('--kc-up', theme.up);
  s.setProperty('--kc-down', theme.down);
  s.setProperty('--kc-font', theme.font);
  s.setProperty('--kc-mono', theme.mono);
  s.setProperty('--kc-ink', theme.series);
}
