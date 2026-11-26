import { barIndexAt } from '../trades/TradeMarkers.js';
import { resolveColor } from '../core/theme.js';

/** Shape size, px. */
const SIZE = 9;
/** Between the bar's wick and the shape. */
const GAP = 5;
/** Between markers stacked on one side of a bar. */
const STEP = 27;
/** A press this close to a marker's centre hits it. */
const HIT = 14;
const TEXT_ROOM = 14;
const SHAPES = new Set(['circle', 'square', 'arrowUp', 'arrowDown']);

/** Smallest i with key(list[i]) >= value. */
function lowerBound(list, value, key) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(list[mid]) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Turn what a host passes into markers: { time, position?, shape?, color?, text?, id? }.
 * Entries without a finite time are skipped. Markers come back sorted by time (the order given is kept for equal times).
 */
export function normalizeMarkers(list) {
  const out = [];
  for (const src of Array.isArray(list) ? list : []) {
    if (!src || typeof src !== 'object' || !Number.isFinite(+src.time) || src.time === null || src.time === '') continue;
    out.push({
      time: +src.time,
      above: src.position !== 'below',
      shape: SHAPES.has(src.shape) ? src.shape : 'circle',
      color: src.color ?? 'accent',
      text: src.text === undefined || src.text === null ? '' : String(src.text),
      id: src.id ?? null,
      source: src,
      index: NaN,
    });
  }
  return out.map((m, order) => ({ m, order })).sort((p, q) => p.m.time - q.m.time || p.order - q.order).map((e) => e.m);
}

/**
 * Markers on bars: small shapes above or below a bar, with a short text (journal pins, dividends, notes, events).
 * Unlike chart.trades they carry no price: they sit just outside the bar's high or low, and several on one side of a bar stack.
 * Where chart.trades drew something on the same side of the bar (an arrow, its text, a tick past the bar), they stack beyond it.
 *
 *   chart.markers.set([
 *     { time, position: 'above', shape: 'circle', color: 'accent', text: 'J', id: 'entry-12' },
 *   ]);
 *   chart.on('marker:click', ({ items }) => open(items[0]));
 *
 * A marker lands on the bar that contains its time, like a trade. Chart events: 'markers' (the list changed),
 * 'marker:hover' and 'marker:click' ({ items, x, y } with the objects that were passed in, x / y in chart pixels; hover also
 * reports null when the pointer leaves). The chart draws no tooltip: the host decides what to show.
 */
export class BarMarkers {
  constructor(chart) {
    this.chart = chart;
    /** The marker under the pointer, or null. */
    this.hover = null;
  }

  #list = [];
  #visible = true;
  #data = null;
  #n = 0;
  #interval = 0;
  #stale = true;
  #layout = [];
  #pointer = null;

  /** The entries as they were passed in. */
  get items() {
    return this.#list.map((m) => m.source);
  }

  get count() {
    return this.#list.length;
  }

  get visible() {
    return this.#visible;
  }

  set visible(on) {
    on = !!on;
    if (on === this.#visible) return;
    this.#visible = on;
    this.#changed();
  }

  /** Replace every marker. */
  set(list) {
    this.#list = normalizeMarkers(list);
    this.#stale = true;
    this.#changed();
  }

  add(item) {
    this.set([...this.items, item]);
  }

  /** Remove by `id`, or by the object that was passed in. */
  remove(target) {
    const keep = this.#list.filter((m) => m.id !== target && m.source !== target);
    if (keep.length !== this.#list.length) this.set(keep.map((m) => m.source));
  }

  clear() {
    if (this.#list.length) this.set([]);
  }

  /** The chart's data was replaced. */
  dataChanged() {
    this.#stale = true;
  }

  #changed() {
    this.#setHover(null);
    this.chart.emit('markers', this.items);
    this.chart.invalidate();
  }

  #sync() {
    const data = this.chart.data;
    const n = data.length;
    const interval = n ? data.interval : 0;
    if (!this.#stale && data === this.#data && n === this.#n && interval === this.#interval) return;
    for (const m of this.#list) m.index = barIndexAt(data, m.time);
    this.#data = data;
    this.#n = n;
    this.#interval = interval;
    this.#stale = false;
  }

  /**
   * Draw the markers. `ctx` has its origin at the main pane's top-left and is clipped to the pane.
   * Also records where everything went, for hit testing.
   */
  draw(ctx) {
    const layout = (this.#layout = []);
    const chart = this.chart;
    const n = chart.data.length;
    if (!this.#visible || !this.#list.length || !n) {
      this.#setHover(null);
      return;
    }
    this.#sync();
    const ts = chart.timeScale;
    const pane = chart.panes[0];
    const { h: H } = pane.rect;
    const theme = chart.theme;
    const data = chart.data;
    const [from, to] = ts.visibleRange();
    const list = this.#list;
    const half = SIZE / 2;
    const stacked = new Map();
    const edges = new Map();
    ctx.save();
    ctx.font = `11px ${theme.mono}`;
    ctx.textAlign = 'center';
    for (let k = lowerBound(list, from - 1, (m) => m.index); k < list.length && list[k].index <= to + 1; k++) {
      const m = list[k];
      if (m.index !== m.index || m.index < 0 || m.index >= n) continue;
      const key = `${m.index}|${m.above}`;
      const level = stacked.get(key) ?? 0;
      stacked.set(key, level + 1);
      const x = Math.round(ts.x(m.index));
      const dir = m.above ? -1 : 1;
      // The bar's high or low, or further out where chart.trades drew an arrow, its text or a tick on this side.
      let anchor = edges.get(key);
      if (anchor === undefined) {
        anchor = m.above ? pane.scale.y(data.high[m.index]) : pane.scale.y(data.low[m.index]);
        anchor = chart.trades?.extentBeyond(x, m.above, anchor, half) ?? anchor;
        edges.set(key, anchor);
      }
      // keep the shape and its text inside the pane even when the bar touches the edge
      const cy = Math.max(half + TEXT_ROOM, Math.min(H - half - TEXT_ROOM, anchor + dir * (GAP + half + level * STEP)));
      ctx.fillStyle = resolveColor(theme, m.color);
      ctx.beginPath();
      if (m.shape === 'circle') ctx.arc(x, cy, half, 0, Math.PI * 2);
      else if (m.shape === 'square') ctx.rect(x - half, cy - half, SIZE, SIZE);
      else {
        const tip = m.shape === 'arrowUp' ? -1 : 1;
        ctx.moveTo(x, cy + tip * half);
        ctx.lineTo(x - half, cy - tip * half);
        ctx.lineTo(x + half, cy - tip * half);
        ctx.closePath();
      }
      ctx.fill();
      if (m.text) {
        ctx.textBaseline = m.above ? 'bottom' : 'top';
        ctx.fillText(m.text, x, cy + dir * (half + 3));
      }
      layout.push({ x, y: cy, marker: m });
    }
    ctx.restore();
    // The view may have moved under a resting pointer.
    if (this.#pointer) this.#setHover(this.#hit(this.#pointer.x, this.#pointer.y));
  }

  /** Report where the pointer is (main-pane coordinates), or null when it left. */
  pointer(x, y = 0) {
    this.#pointer = x === null || x === undefined ? null : { x, y };
    this.#setHover(this.#pointer ? this.#hit(x, y) : null);
  }

  /** The pointer was clicked or tapped on the hovered marker. */
  click() {
    if (this.hover) this.chart.emit('marker:click', this.#payload(this.hover));
  }

  #hit(x, y) {
    let best = null;
    let bestD = HIT;
    for (const spot of this.#layout) {
      const d = Math.hypot(spot.x - x, spot.y - y);
      if (d <= bestD) {
        bestD = d;
        best = spot;
      }
    }
    return best;
  }

  #setHover(next) {
    const prev = this.hover;
    if (prev === next || (prev && next && prev.marker === next.marker)) return;
    this.hover = next;
    this.chart.emit('marker:hover', next ? this.#payload(next) : null);
  }

  #payload(spot) {
    return { items: [spot.marker.source], x: spot.x, y: spot.y + this.chart.panes[0].rect.y };
  }
}
