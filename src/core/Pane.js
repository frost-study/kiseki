import { PriceScale } from './PriceScale.js';

/**
 * A pane (one row: the main chart, RSI, …).
 * Besides the 'right' price scale (the one shown on the axis), a pane can hold hidden scales
 * for things that overlay the pane but keep their own scale, such as volume.
 */
export class Pane {
  constructor(id, weight = 1) {
    this.id = id;
    this.weight = weight;
    /** Things to draw (Series / Indicator). Later entries are drawn on top. */
    this.items = [];
    this.scales = new Map([['right', new PriceScale()]]);
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.ticks = [];
  }

  get scale() {
    return this.scales.get('right');
  }

  scaleOf(item) {
    return this.scales.get(item.scaleId) ?? this.scale;
  }

  add(item) {
    if (!this.scales.has(item.scaleId)) {
      const s = item.def?.scale ?? {};
      const scale = new PriceScale({ top: s.top ?? 0.1, bottom: s.bottom ?? 0.1, visible: false });
      scale.setHeight(this.rect.h);
      this.scales.set(item.scaleId, scale);
    }
    this.items.push(item);
  }

  remove(item) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    for (const id of [...this.scales.keys()]) {
      if (id !== 'right' && !this.items.some((it) => it.scaleId === id)) this.scales.delete(id);
    }
  }

  replace(oldItem, newItem) {
    const i = this.items.indexOf(oldItem);
    if (i >= 0) this.items[i] = newItem;
    else this.items.unshift(newItem);
  }

  layout(rect) {
    this.rect = rect;
    for (const scale of this.scales.values()) scale.setHeight(rect.h);
  }

  /**
   * Fit each scale's value range to the visible range.
   * @param {number} a,b   visible indices clamped to the data range
   * @param {number} ra,rb visible indices before clamping
   */
  autoscale(a, b, ra, rb) {
    for (const [id, scale] of this.scales) {
      const primary = this.items.find((it) => it.scaleId === id);
      if (!primary) continue;
      scale.format = (v) => primary.format(v);
      scale.minStep = primary.kind === 'series' ? 10 ** -primary.precision : 0;
      if (scale.mode === 'percent' && a <= b && primary.baseValue) {
        const base = primary.baseValue(a);
        if (base > 0) scale.base = base;
      }
      if (!scale.auto) {
        scale.refresh();
        continue;
      }
      let mn = Infinity;
      let mx = -Infinity;
      for (const item of this.items) {
        if (item.scaleId !== id || !item.visible) continue;
        const r = item.range(a, b, ra, rb);
        if (!r) continue;
        if (r.min < mn) mn = r.min;
        if (r.max > mx) mx = r.max;
      }
      if (mn <= mx) scale.fit(mn, mx);
      else scale.refresh();
    }
  }
}
