const ICONS = {
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M4 4l16 16M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.1 3.8M6.3 7.6A16.5 16.5 0 0 0 2 12s3.6 6.5 10 6.5c1.5 0 2.8-.3 4-.9"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

import { t } from './i18n.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Legend in the top-left of each pane. Text is DOM (crisper than canvas, and buttons can live in it).
 * Values come from the bar under the crosshair, or the latest bar otherwise.
 */
export class Legend {
  constructor(chart) {
    this.chart = chart;
    /** @type {Map<object, {el: HTMLElement, rows: Map<object, {row: HTMLElement, vals: HTMLElement}>}>} */
    this.#panes = new Map();
    this.#key = '';
    chart.layer.addEventListener('click', (e) => this.#onClick(e));
  }

  #panes;
  #key;

  /** Rebuild when the pane / series layout changes. */
  rebuild() {
    const chart = this.chart;
    for (const { el } of this.#panes.values()) el.remove();
    this.#panes.clear();
    if (chart.options.legend === false) return;
    for (const pane of chart.panes) {
      const el = document.createElement('div');
      el.className = 'kc-legend';
      const rows = new Map();
      for (const item of pane.items) {
        const row = document.createElement('div');
        row.className = 'kc-row' + (item.visible ? '' : ' kc-off');
        row.dataset.id = item.id ?? 'main';
        if (item.kind === 'series') {
          const sub = [t(chart.timeframeLabel), item.title].filter(Boolean).join(' · ');
          row.innerHTML = `<span class="kc-title">${esc(chart.symbol.name)}</span><span class="kc-sub">${esc(sub)}</span><span class="kc-vals"></span>`;
        } else {
          row.innerHTML =
            `<span class="kc-name">${esc(item.title)}</span><span class="kc-vals"></span>` +
            `<span class="kc-actions">` +
            `<button data-act="toggle" title="${esc(t('Show / hide'))}">${item.visible ? ICONS.eye : ICONS.eyeOff}</button>` +
            `<button data-act="settings" title="${esc(t('Settings'))}">${ICONS.gear}</button>` +
            `<button data-act="remove" title="${esc(t('Remove'))}">${ICONS.close}</button></span>`;
        }
        el.append(row);
        rows.set(item, { row, vals: row.querySelector('.kc-vals') });
      }
      chart.layer.append(el);
      this.#panes.set(pane, { el, rows });
    }
    this.#key = '';
    this.position();
  }

  position() {
    for (const [pane, { el }] of this.#panes) el.style.top = `${pane.rect.y + 6}px`;
  }

  /** Update the values (the DOM is touched only when the bar or the data changed). */
  update() {
    const chart = this.chart;
    const index = chart.legendIndex();
    // Some indicators depend on the visible range (e.g. the POC of a volume profile), so the range is part of the key.
    const [a, b] = chart.visibleBars();
    const key = `${index}:${chart.revision}:${a}:${b}`;
    if (key === this.#key) return;
    this.#key = key;
    const theme = chart.theme;
    for (const { rows } of this.#panes.values()) {
      for (const [item, { vals }] of rows) {
        if (!item.visible) {
          vals.textContent = '';
          continue;
        }
        let html = '';
        for (const it of item.legend(index, theme)) {
          html += `<span${it.color ? ` style="color:${esc(it.color)}"` : ''}>${it.k ? `<i>${esc(it.k)}</i>` : ''}${esc(it.v)}</span>`;
        }
        vals.innerHTML = html;
      }
    }
  }

  #onClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.kc-row').dataset.id;
    const ind = this.chart.indicators.find((i) => i.id === id);
    if (!ind) return;
    const act = btn.dataset.act;
    if (act === 'toggle') this.chart.setIndicatorVisible(ind, !ind.visible);
    else if (act === 'remove') this.chart.removeIndicator(ind);
    else if (act === 'settings') this.chart.emit('indicator:settings', ind);
  }
}
