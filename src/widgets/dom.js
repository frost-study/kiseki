import { t } from '../core/i18n.js';

/**
 * Small DOM helpers for the widgets (element builder, menus, dialogs, toasts).
 * Menus and dialogs are mounted inside the root of the widget that opened them.
 * Widgets live in a Shadow DOM, so their look never mixes with the host page.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    // aria-* states are spelled out ("true" / "false"); for other attributes false or null means absent
    if (k.startsWith('aria-') && typeof v === 'boolean') el.setAttribute(k, String(v));
    else if (v === false || v == null) continue;
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export const svg = (d, cls = '') => `<svg viewBox="0 0 24 24"${cls ? ` class="${cls}"` : ''}><path d="${d}"/></svg>`;

export const ICON = {
  caret: 'M6 9l6 6 6-6',
  cursor: 'M5 3l14 8-6 1.6L10.5 19z',
  wave: 'M3 17c3 0 3-10 6-10s3 10 6 10 3-6 6-6',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M6.3 6.3L4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v5M14 11v5',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  help: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  reset: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4.5v15l12-7.5z',
  candles: 'M8 3v3M8 16v5M5.5 6h5v10h-5zM16 5v4M16 15v4M13.5 9h5v6h-5z',
  area: 'M3 17l5-6 4 3 4-7 5 4v8H3zM3 17l5-6 4 3 4-7 5 4',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  trades: 'M7.5 4.5l4 6.5h-8zM16.5 19.5l-4-6.5h8zM3 14h7M14 10h7',
};

export function toast(mount, text) {
  mount.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, text);
  mount.append(el);
  setTimeout(() => el.remove(), 2200);
}

let closeCurrent = null;
let currentAnchor = null;

/** Close the open menu, if any. */
export function closeMenus() {
  closeCurrent?.();
}

/** Open a menu below `anchor`. Pressing the same anchor again closes it. */
export function openMenu(mount, anchor, build) {
  const same = currentAnchor === anchor;
  closeMenus();
  if (same) return;
  const menu = h('div', { class: 'menu', role: 'menu' });
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    closeCurrent = currentAnchor = null;
  };
  // From `document`, elements inside a Shadow DOM look like their host, so decide by the event path (composedPath).
  const onDown = (e) => {
    const path = e.composedPath();
    if (!path.includes(menu) && !path.includes(anchor)) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  build(menu, close);
  mount.append(menu);
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8));
  let top = r.bottom + 6;
  if (top + menu.offsetHeight > innerHeight - 8) top = Math.max(8, innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  closeCurrent = close;
  currentAnchor = anchor;
}

export function menuItem({ label, sub, icon, on, kbd, disabled, onclick }) {
  return h(
    'button',
    { class: 'item' + (on ? ' on' : ''), role: 'menuitem', disabled, onclick },
    icon ? h('span', { html: svg(icon), style: 'display:contents' }) : null,
    h('span', { class: 'grow' }, label, sub ? h('small', null, sub) : null),
    kbd ? h('kbd', null, kbd) : null,
    on ? h('span', { html: svg(ICON.check), style: 'display:contents' }) : null,
  );
}

export function openDialog(mount, title, { body, footer, extra } = {}) {
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const dialog = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-label': title },
    h('header', null, h('span', { class: 'grow' }, title), extra, h('button', { class: 'btn icon', title: t('Close'), html: svg(ICON.close), onclick: () => close() })),
    body,
    footer ? h('footer', null, footer) : null,
  );
  const backdrop = h('div', { class: 'backdrop', onpointerdown: (e) => e.target === backdrop && close() }, dialog);
  mount.append(backdrop);
  document.addEventListener('keydown', onKey, true);
  return { close, dialog };
}
