import { MinMaxIndex } from '../core/MinMaxIndex.js';
import { formatDateTime, formatDuration, formatPercent } from '../core/format.js';
import { t } from '../core/i18n.js';

const DAY = 86_400_000;
/** Arrows on one side of the bars are never closer than this (px); fills nearer than that share one arrow. */
const MIN_GAP = 8;
const ARROW_W = 11;
const ARROW_H = 9;
/** Space between the bar and the tip of the arrow (px). */
const ARROW_GAP = 5;
/** The arrow moves outside the bar only this far from its price (px); on a taller bar it stays beside the price. */
const ARROW_REACH = 26;
/** A cluster with more fills than this shows its price span instead of one mark per fill. */
const MAX_MARKS = 24;
const TAU = 6.2832;
const DOT_R = 2.75;

let uid = 0;
/** Ids given to entries that came without one. They stay with the object, so they survive set() and add(). */
const ids = new WeakMap();
const qtyFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });

const BUY_SIDES = new Set(['buy', 'in', 'long']);
const SELL_SIDES = new Set(['sell', 'out', 'short']);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);
const text = (v) => (v === null || v === undefined || v === '' ? null : String(v));

function point(p) {
  if (!p || typeof p !== 'object') return null;
  const time = +p.time;
  const price = +p.price;
  return Number.isFinite(time) && Number.isFinite(price) ? { time, price } : null;
}

/**
 * Index of the bar that contains `time`: the last bar that starts at or before it.
 * A fill inside a bar therefore lands on that bar, never between two bars.
 * Outside the data the index is extrapolated by the bar interval (so it can be negative or past the end).
 * @param {import('../core/BarData.js').BarData} data
 * @returns {number} NaN when there is no data
 */
export function barIndexAt(data, time) {
  const n = data.length;
  if (!n) return NaN;
  const first = data.time[0];
  const last = data.time[n - 1];
  if (time < first) return Math.floor((time - first) / data.interval);
  if (time >= last) return n - 1 + Math.floor((time - last) / data.interval);
  const i = data.lowerBound(time);
  return data.time[i] === time ? i : i - 1;
}

/**
 * Turn what a host passes into fills (one buy or sell at an exact time and price) and round trips.
 *
 *   { time, price, side: 'buy' | 'sell', qty?, label?, tag?, note?, color?, id? }         a single fill
 *   { side: 'long' | 'short', qty?, entry: { time, price }, exit?: { time, price }, … }  a round trip (in and out)
 *
 * Entries without a finite time and price are skipped. Fills come back sorted by time.
 */
export function normalizeTrades(list) {
  const items = [];
  const fills = [];
  const trades = [];
  for (const src of Array.isArray(list) ? list : []) {
    if (!src || typeof src !== 'object') continue;
    const id = src.id ?? ids.get(src) ?? `t${++uid}`;
    if (src.id === undefined || src.id === null) ids.set(src, id);
    const qty = num(src.qty);
    const make = (p, buy, role, trade, leg) => ({
      id,
      time: p.time,
      price: p.price,
      buy,
      qty: num(leg.qty) ?? qty,
      label: text(leg.label) ?? (role === 'exit' ? null : text(src.label)),
      tag: text(leg.tag) ?? (role === 'exit' ? null : text(src.tag)),
      note: text(leg.note) ?? text(src.note),
      color: leg.color ?? src.color ?? null,
      role,
      trade,
      source: src,
      index: NaN,
    });
    if (src.entry) {
      const a = point(src.entry);
      if (!a) continue;
      const b = point(src.exit);
      const long = !SELL_SIDES.has(src.side);
      const trade = { id, long, qty, entry: null, exit: null, source: src };
      trade.entry = make(a, long, 'entry', trade, src.entry);
      fills.push(trade.entry);
      if (b) {
        trade.exit = make(b, !long, 'exit', trade, src.exit);
        fills.push(trade.exit);
      }
      trades.push(trade);
    } else {
      const p = point(src);
      if (!p) continue;
      fills.push(make(p, BUY_SIDES.has(src.side) || !SELL_SIDES.has(src.side), null, null, src));
    }
    items.push({ id, source: src });
  }
  fills.sort((p, q) => p.time - q.time);
  return { items, fills, trades };
}

/**
 * Result of a round trip. An open one is valued at `lastPrice`.
 * @returns {{open:boolean, diff:number, pct:number, amount:number|null} | null} diff is per unit, positive for a gain
 */
export function tradeResult(trade, lastPrice = NaN) {
  const out = trade.exit ? trade.exit.price : lastPrice;
  if (out !== out) return null;
  const diff = (out - trade.entry.price) * (trade.long ? 1 : -1);
  return {
    open: !trade.exit,
    diff,
    pct: trade.entry.price ? (diff / Math.abs(trade.entry.price)) * 100 : 0,
    amount: trade.qty === null ? null : diff * trade.qty,
  };
}

/**
 * Group fills (sorted by bar index) so that the arrows of one side sit at least `gap` bars apart.
 * A group starts at its first fill and takes every later fill of the same side closer than `gap` bars;
 * fills on the same bar always share a group. Grouping starts from the first fill, not from the visible
 * range, so panning never regroups anything.
 * @returns {{buy: object[], sell: object[]}} groups: { buy, first, last, fills, lo, hi }
 */
export function groupFills(fills, gap) {
  const out = { buy: [], sell: [] };
  let buy = null;
  let sell = null;
  for (const f of fills) {
    if (f.index !== f.index) continue;
    let g = f.buy ? buy : sell;
    if (!g || f.index - g.first >= gap) {
      g = { buy: f.buy, first: f.index, last: f.index, fills: [], lo: f.price, hi: f.price };
      out[f.buy ? 'buy' : 'sell'].push(g);
      if (f.buy) buy = g;
      else sell = g;
    }
    g.fills.push(f);
    g.last = f.index;
    if (f.price < g.lo) g.lo = f.price;
    if (f.price > g.hi) g.hi = f.price;
  }
  return out;
}

/**
 * Net position after a list of fills in time order, by the moving-average cost method:
 * adding to a position averages its price, reducing it realizes the difference to that average.
 * A fill without a quantity counts as one unit.
 * @param {{buy:boolean, price:number, qty:number|null}[]} fills
 * @returns {{qty:number, avgPrice:number, realized:number, bought:number, sold:number}}
 *   qty is negative for a short position; avgPrice is NaN when flat
 */
export function positionOf(fills) {
  let qty = 0;
  let avg = 0;
  let realized = 0;
  let bought = 0;
  let sold = 0;
  for (const f of fills) {
    const size = f.qty ?? 1;
    if (!(size > 0)) continue;
    const dir = f.buy ? 1 : -1;
    if (f.buy) bought += size;
    else sold += size;
    if (qty === 0 || Math.sign(qty) === dir) {
      avg = (avg * Math.abs(qty) + f.price * size) / (Math.abs(qty) + size);
      qty += dir * size;
      continue;
    }
    const closing = Math.min(size, Math.abs(qty));
    realized += (f.price - avg) * closing * Math.sign(qty);
    qty += dir * closing;
    if (size > closing) {
      // The rest of the fill opens a position the other way.
      qty = dir * (size - closing);
      avg = f.price;
    }
  }
  return { qty, avgPrice: qty ? avg : NaN, realized, bought, sold };
}

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
 * Trade markers: where a position was entered and left ("in" and "out"), drawn at the exact time and price.
 *
 * Each fill gets
 *   - a tick across its bar at the exact price (the bar is the one that contains the fill's time), and
 *   - an arrow outside the bar, so nothing covers the candle: buys point up from below, sells point down from above.
 * Round trips also get a line from entry to exit in the color of the result, and open ones a line at the entry price.
 * Zoomed out, nearby fills share an arrow (×n) while their ticks stay where they belong.
 * Pointing at a marker shows the details and the exact price on the axis.
 *
 *   chart.trades.set([
 *     { time, price, side: 'buy', qty: 100 },
 *     { side: 'long', qty: 50, entry: { time, price }, exit: { time, price } },
 *   ]);
 *
 * Chart events: 'trades' (the list changed), 'trade:hover' and 'trade:click' ({ items, side, x, y } or null).
 */
export class TradeMarkers {
  constructor(chart) {
    this.chart = chart;
    /**
     * labels      text next to the arrows (a fill's `label`, ×n for clusters, the result at an exit)
     * connectors  line from entry to exit
     * openLine    line at the entry price of a round trip that has no exit yet
     * autoscale   keep the visible fills inside the price range
     * colors      { buy, sell, profit, loss }; the theme's up / down colors by default
     * formatQty   (qty) => string
     */
    this.options = { labels: true, connectors: true, openLine: true, autoscale: true, colors: {}, formatQty: null };
    /** What the pointer is on: { fills, buy, x, y } (pane coordinates) or null. */
    this.hover = null;
  }

  #items = [];
  #fills = [];
  #trades = [];
  #visible = true;
  #prices = new Float64Array(0);
  #minmax = new MinMaxIndex();
  // Bar indices are cached per data set; `#stale` forces a full recalculation.
  #data = null;
  #n = 0;
  #interval = 0;
  #stale = true;
  #groups = null;
  #groupGap = NaN;
  #layout = { arrows: [], marks: [] };
  #pointer = null;

  /* ───────────── List ───────────── */

  /** The entries as they were passed in. */
  get items() {
    return this.#items.map((it) => it.source);
  }

  /** Number of fills (a round trip counts its entry and its exit). */
  get count() {
    return this.#fills.length;
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

  /** Replace every marker. See normalizeTrades() for the accepted shapes. */
  set(list) {
    const { items, fills, trades } = normalizeTrades(list);
    this.#items = items;
    this.#fills = fills;
    this.#trades = trades;
    this.#prices = Float64Array.from(fills, (f) => f.price);
    this.#minmax = new MinMaxIndex();
    this.#minmax.update(this.#prices, this.#prices, 0, fills.length);
    this.#stale = true;
    this.#changed();
  }

  /** Add one entry. Returns its id (the entry's own `id` when it has one). */
  add(item) {
    this.set([...this.items, item]);
    return this.#items.findLast((it) => it.source === item)?.id ?? null;
  }

  /** Remove an entry by id, or by the object that was passed in. */
  remove(target) {
    const keep = this.#items.filter((it) => it.id !== target && it.source !== target);
    if (keep.length !== this.#items.length) this.set(keep.map((it) => it.source));
  }

  clear() {
    if (this.#items.length) this.set([]);
  }

  setOptions(options) {
    Object.assign(this.options, options);
    this.#groupGap = NaN;
    this.chart.invalidate();
  }

  /** The chart's data was replaced. */
  dataChanged() {
    this.#stale = true;
  }

  #changed() {
    this.#groupGap = NaN;
    this.#setHover(null);
    this.chart.emit('trades', this.items);
    this.chart.invalidate();
  }

  /**
   * The net position all fills add up to (see positionOf), valued at the latest close.
   * @returns {{qty:number, avgPrice:number, realized:number, unrealized:number, bought:number, sold:number}}
   */
  position() {
    const p = positionOf(this.#fills);
    const data = this.chart.data;
    const last = data.length ? data.close[data.length - 1] : NaN;
    return { ...p, unrealized: p.qty ? (last - p.avgPrice) * p.qty : 0 };
  }

  /** Bring an entry into view (by id or by the object that was passed in), zooming out if a round trip does not fit. */
  reveal(target, animate = true) {
    const fills = this.#fills.filter((f) => f.id === target || f.source === target);
    this.#sync();
    if (!fills.length || fills[0].index !== fills[0].index) return;
    const lo = fills[0].index;
    const hi = fills[fills.length - 1].index;
    const chart = this.chart;
    const ts = chart.timeScale;
    const barSpacing = Math.max(ts.minSpacing, Math.min(ts.barSpacing, ts.width / ((hi - lo + 1) * 1.5)));
    const view = { barSpacing, rightIndex: (lo + hi) / 2 + ts.width / barSpacing / 2 - 0.5 };
    if (animate) chart.animateView(view);
    else {
      chart.releaseFit();
      Object.assign(ts, view);
      chart.invalidate();
    }
  }

  /* ───────────── Positions ───────────── */

  /** Bring the cached bar indices up to date. Appending bars only touches the fills at or after the last bar. */
  #sync() {
    const data = this.chart.data;
    const n = data.length;
    const interval = n ? data.interval : 0;
    if (!this.#stale && data === this.#data && n === this.#n && interval === this.#interval) return;
    const fills = this.#fills;
    let moved = this.#stale;
    const place = (i) => {
      const index = barIndexAt(data, fills[i].time);
      if (index === fills[i].index || (index !== index && fills[i].index !== fills[i].index)) return;
      fills[i].index = index;
      moved = true;
    };
    if (!this.#stale && data === this.#data && this.#n > 0 && n >= this.#n) {
      // Bars were appended: fills inside the old data stay put. Only those on or after the last bar can move,
      // and those before the first bar when the interval used to extrapolate them changed.
      if (interval !== this.#interval) for (let i = 0; i < fills.length && fills[i].time < data.time[0]; i++) place(i);
      for (let i = lowerBound(fills, data.time[this.#n - 1], (f) => f.time); i < fills.length; i++) place(i);
    } else {
      for (let i = 0; i < fills.length; i++) place(i);
    }
    this.#data = data;
    this.#n = n;
    this.#interval = interval;
    this.#stale = false;
    if (moved) this.#groupGap = NaN;
  }

  #grouped(gap) {
    if (gap !== this.#groupGap) {
      this.#groups = groupFills(this.#fills, gap);
      this.#groupGap = gap;
    }
    return this.#groups;
  }

  /** Price range of the fills on bars [from, to], for autoscaling. */
  range(from, to) {
    if (!this.#visible || !this.options.autoscale || !this.#fills.length || !this.chart.data.length) return null;
    this.#sync();
    const fills = this.#fills;
    const a = lowerBound(fills, from, (f) => f.index);
    const b = lowerBound(fills, to + 1, (f) => f.index) - 1;
    return this.#minmax.query(this.#prices, this.#prices, a, b);
  }

  #colors() {
    const theme = this.chart.theme;
    const c = this.options.colors ?? {};
    return { buy: c.buy ?? theme.up, sell: c.sell ?? theme.down, profit: c.profit ?? theme.up, loss: c.loss ?? theme.down };
  }

  #colorOf(fill, colors) {
    return fill.color ?? (fill.buy ? colors.buy : colors.sell);
  }

  /* ───────────── Drawing ───────────── */

  /**
   * Draw the markers. `ctx` has its origin at the main pane's top-left and is clipped to the pane.
   * Also records where everything went, for hit testing.
   */
  draw(ctx) {
    const layout = (this.#layout = { arrows: [], marks: [] });
    const chart = this.chart;
    const n = chart.data.length;
    if (!this.#visible || !this.#fills.length || !n) {
      this.#setHover(null);
      return;
    }
    this.#sync();
    const ts = chart.timeScale;
    const pane = chart.panes[0];
    const scale = pane.scale;
    const theme = chart.theme;
    const dpr = chart.dpr;
    const { w: W, h: H } = pane.rect;
    const bs = ts.barSpacing;
    const colors = this.#colors();
    const snap = (v) => Math.round(v * dpr) / dpr;
    const [from, to] = ts.visibleRange();
    const pad = 16 / bs;
    const ia = from - pad;
    const ib = to + pad;
    // The tick reaches a little past the candle body on both sides.
    const half = Math.max(4.5, bs * 0.36 + 3);
    const reach = Math.ceil(ARROW_W / 2 / bs + 0.36) - 1;

    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';

    // Round trips: a line from entry to exit in the color of the result; open ones run on at the entry price.
    const lines = new Map();
    const addLine = (color, x1, y1, x2, y2) => {
      let list = lines.get(color);
      if (!list) lines.set(color, (list = []));
      list.push(x1, y1, x2, y2);
    };
    const strokeLines = (dash, alpha, width) => {
      ctx.setLineDash(dash);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      for (const [color, list] of lines) {
        ctx.beginPath();
        for (let k = 0; k < list.length; k += 4) {
          ctx.moveTo(list[k], list[k + 1]);
          ctx.lineTo(list[k + 2], list[k + 3]);
        }
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      lines.clear();
    };
    if (this.options.connectors) {
      for (const tr of this.#trades) {
        const a = tr.entry;
        const b = tr.exit;
        if (!b || Math.max(a.index, b.index) < ia || Math.min(a.index, b.index) > ib) continue;
        const x1 = ts.x(a.index);
        const x2 = ts.x(b.index);
        const y1 = scale.y(a.price);
        const y2 = scale.y(b.price);
        if (Math.abs(x2 - x1) + Math.abs(y2 - y1) < 4) continue;
        addLine(tradeResult(tr).diff >= 0 ? colors.profit : colors.loss, x1, y1, x2, y2);
      }
      strokeLines([4, 3], 0.75, 1.25);
    }
    if (this.options.openLine) {
      for (const tr of this.#trades) {
        if (tr.exit || tr.entry.index > ib) continue;
        const y = snap(scale.y(tr.entry.price)) + 0.5 / dpr;
        if (y < 0 || y > H) continue;
        addLine(this.#colorOf(tr.entry, colors), Math.max(0, ts.x(tr.entry.index)), y, W, y);
      }
      strokeLines([2, 3], 0.7, 1);
    }

    // Visible groups, oldest first.
    const groups = this.#grouped(MIN_GAP / bs);
    const visible = [];
    for (const side of [groups.buy, groups.sell]) {
      for (let k = lowerBound(side, ia, (g) => g.last); k < side.length && side[k].first <= ib; k++) visible.push(side[k]);
    }

    const halo = [];
    const dots = new Map();
    const marks = new Map();
    const stems = new Map();
    const arrows = new Map();
    const push = (map, color, ...values) => {
      let list = map.get(color);
      if (!list) map.set(color, (list = []));
      list.push(...values);
    };
    const main = chart.main;
    for (const g of visible) {
      const color = g.fills.length === 1 ? this.#colorOf(g.fills[0], colors) : g.buy ? colors.buy : colors.sell;
      const x = ts.x(g.first);
      const yLo = scale.y(g.lo);
      const yHi = scale.y(g.hi);
      if (!Number.isFinite(yLo) || !Number.isFinite(yHi)) continue;

      // The exact prices: one tick per fill, or the span when there are too many to tell apart.
      if (g.fills.length <= MAX_MARKS) {
        for (const f of g.fills) {
          const fx = ts.x(f.index);
          const fy = snap(scale.y(f.price));
          halo.push(fx - half, fy, fx + half, fy);
          push(marks, this.#colorOf(f, colors), fx - half, fy, fx + half, fy);
          push(dots, this.#colorOf(f, colors), fx, fy);
          layout.marks.push({ x: fx, y: fy, half, fill: f });
        }
      } else {
        const sx = snap(x);
        halo.push(sx - half, snap(yHi), sx + half, snap(yHi), sx - half, snap(yLo), sx + half, snap(yLo));
        push(marks, color, sx - half, snap(yHi), sx + half, snap(yHi), sx - half, snap(yLo), sx + half, snap(yLo));
        push(stems, color, sx, yHi, sx, yLo);
      }

      // The arrow sits just outside whatever the series draws there, so it does not cover the candle,
      // unless that would take it far from the price it belongs to.
      const r = main.range(Math.max(0, g.first - reach), Math.min(n - 1, g.first + reach));
      let tip;
      if (g.buy) {
        tip = Math.min(yLo + ARROW_REACH, Math.max(yLo, r ? scale.y(r.min) : -Infinity)) + ARROW_GAP;
        tip = Math.max(2, Math.min(H - ARROW_H - 2, tip));
        push(stems, color, x, yLo + 1, x, tip);
      } else {
        tip = Math.max(yHi - ARROW_REACH, Math.min(yHi, r ? scale.y(r.max) : Infinity)) - ARROW_GAP;
        tip = Math.min(H - 2, Math.max(ARROW_H + 2, tip));
        push(stems, color, x, yHi - 1, x, tip);
      }
      const base = tip + (g.buy ? ARROW_H : -ARROW_H);
      push(arrows, color, x, tip, base);
      layout.arrows.push({ x, tip, base, group: g, color });
    }

    // Stems first (faint), then a halo in the background color under every tick and arrow, then the shapes.
    const segments = (list) => {
      ctx.beginPath();
      for (let k = 0; k < list.length; k += 4) {
        ctx.moveTo(list[k], list[k + 1]);
        ctx.lineTo(list[k + 2], list[k + 3]);
      }
    };
    const triangles = (list) => {
      ctx.beginPath();
      for (let k = 0; k < list.length; k += 3) {
        ctx.moveTo(list[k], list[k + 1]);
        ctx.lineTo(list[k] - ARROW_W / 2, list[k + 2]);
        ctx.lineTo(list[k] + ARROW_W / 2, list[k + 2]);
        ctx.closePath();
      }
    };
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    for (const [color, list] of stems) {
      segments(list);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.bg;
    ctx.lineCap = 'square';
    ctx.lineWidth = 4;
    segments(halo);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.lineWidth = 2.5;
    for (const list of arrows.values()) {
      triangles(list);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    for (const [color, list] of marks) {
      segments(list);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    // A ring where the tick crosses the bar: the exact point, readable on a candle of either color.
    ctx.lineWidth = 1.5;
    ctx.fillStyle = theme.bg;
    for (const [color, list] of dots) {
      ctx.beginPath();
      for (let k = 0; k < list.length; k += 2) {
        ctx.moveTo(list[k] + DOT_R, list[k + 1]);
        ctx.arc(list[k], list[k + 1], DOT_R, 0, TAU);
      }
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    for (const [color, list] of arrows) {
      triangles(list);
      ctx.fillStyle = color;
      ctx.fill();
    }

    if (this.options.labels) this.#drawLabels(ctx, layout.arrows, colors, W, H);
    ctx.restore();
    // The view may have moved under a resting pointer.
    if (this.#pointer) this.#setHover(this.#hit(this.#pointer.x, this.#pointer.y));
  }

  #labelOf(group, colors) {
    const own = (f) => {
      // `tag` is the text beside the arrow; without one the label is (the label always stays in the details)
      const text = f.tag ?? f.label;
      if (text !== null) return { text, color: this.#colorOf(f, colors) };
      if (f.role !== 'exit') return null;
      const r = tradeResult(f.trade);
      return { text: formatPercent(r.pct), color: r.diff >= 0 ? colors.profit : colors.loss };
    };
    const fills = group.fills;
    if (fills.length === 1) return own(fills[0]);
    // Two fills at one spot are usually an exit and the next entry: the one label there is worth more than a count.
    if (fills.length === 2) {
      const labels = fills.map(own).filter(Boolean);
      if (labels.length === 1) return labels[0];
    }
    return { text: `×${fills.length}`, color: group.buy ? colors.buy : colors.sell };
  }

  /** Labels beyond the arrows. The newest wins where two would overlap. */
  #drawLabels(ctx, arrows, colors, W, H) {
    const theme = this.chart.theme;
    ctx.font = `600 10px ${theme.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const placed = [];
    const order = [...arrows].sort((p, q) => q.group.last - p.group.last);
    for (const a of order) {
      const label = this.#labelOf(a.group, colors);
      if (!label) continue;
      const w = Math.ceil(ctx.measureText(label.text).width) + 8;
      const h = 14;
      const x = Math.max(2, Math.min(W - w - 2, a.x - w / 2));
      const y = a.group.buy ? a.base + 3 : a.base - 3 - h;
      if (y < 0 || y + h > H || x + w < 0 || x > W) continue;
      if (placed.some((p) => x < p.x + p.w + 2 && p.x < x + w + 2 && y < p.y + p.h + 1 && p.y < y + h + 1)) continue;
      placed.push({ x, y, w, h });
      ctx.globalAlpha = 0.86;
      ctx.fillStyle = theme.bg;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, x + w / 2, y + h / 2 + 0.5);
    }
  }

  /* ───────────── Pointer ───────────── */

  /** Report where the pointer is (main-pane coordinates), or null when it left. */
  pointer(x, y = 0) {
    this.#pointer = x === null || x === undefined ? null : { x, y };
    this.#setHover(this.#pointer ? this.#hit(x, y) : null);
  }

  /** The pointer was clicked or tapped on the hovered marker. */
  click() {
    if (this.hover) this.chart.emit('trade:click', this.#payload(this.hover));
  }

  #hit(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const m of this.#layout.marks) {
      const dx = Math.abs(x - m.x);
      const dy = Math.abs(y - m.y);
      if (dx > m.half + 2 || dy > 5) continue;
      const d = dy + dx * 0.2;
      if (d < bestD) {
        bestD = d;
        best = { fills: [m.fill], buy: m.fill.buy, x: m.x, y: m.y };
      }
    }
    for (const a of this.#layout.arrows) {
      const cy = (a.tip + a.base) / 2;
      const dx = Math.abs(x - a.x);
      const dy = Math.abs(y - cy);
      if (dx > ARROW_W / 2 + 3 || dy > ARROW_H / 2 + 4) continue;
      const d = dy + dx * 0.2 + 3;
      if (d < bestD) {
        bestD = d;
        best = { fills: a.group.fills, buy: a.group.buy, x: a.x, y: cy };
      }
    }
    return best;
  }

  #setHover(next) {
    const prev = this.hover;
    this.hover = next;
    const same = prev === next || (prev && next && prev.fills.length === next.fills.length && prev.fills[0] === next.fills[0]);
    if (same) return;
    this.chart.emit('trade:hover', next ? this.#payload(next) : null);
    this.chart.invalidate('overlay');
  }

  #payload(hv) {
    const pane = this.chart.panes[0];
    return { items: [...new Set(hv.fills.map((f) => f.source))], side: hv.buy ? 'buy' : 'sell', x: hv.x, y: hv.y + pane.rect.y };
  }

  /** Average price of some fills, weighted by quantity when every fill has one. */
  #average(fills) {
    const weighted = fills.every((f) => f.qty !== null && f.qty > 0);
    let sum = 0;
    let weight = 0;
    for (const f of fills) {
      const w = weighted ? f.qty : 1;
      sum += f.price * w;
      weight += w;
    }
    return sum / weight;
  }

  /** Exact price of the hovered marker for the price axis: { y, label, color } (y relative to the main pane) or null. */
  hoverTag() {
    const hv = this.hover;
    if (!hv || !this.#visible) return null;
    const scale = this.chart.panes[0].scale;
    const colors = this.#colors();
    const price = hv.fills.length === 1 ? hv.fills[0].price : this.#average(hv.fills);
    const color = hv.fills.length === 1 ? this.#colorOf(hv.fills[0], colors) : hv.buy ? colors.buy : colors.sell;
    return { y: scale.y(price), label: scale.label(price), color };
  }

  /** Emphasize the hovered marker: its exact price across the pane, its ticks, and the other leg of a round trip. */
  drawHover(ctx) {
    const hv = this.hover;
    if (!hv || !this.#visible) return;
    const chart = this.chart;
    const ts = chart.timeScale;
    const pane = chart.panes[0];
    const scale = pane.scale;
    const theme = chart.theme;
    const colors = this.#colors();
    const tag = this.hoverTag();
    const W = pane.rect.w;
    const half = Math.max(4.5, ts.barSpacing * 0.36 + 3) + 1.5;
    ctx.save();

    const Y = Math.round(tag.y) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, Y);
    ctx.lineTo(W, Y);
    ctx.strokeStyle = tag.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // The other leg of a round trip, and the line between the two.
    const emphasized = hv.fills.slice(0, MAX_MARKS);
    const trade = hv.fills.length === 1 ? hv.fills[0].trade : null;
    if (trade?.exit) {
      const other = hv.fills[0] === trade.entry ? trade.exit : trade.entry;
      ctx.beginPath();
      ctx.moveTo(ts.x(trade.entry.index), scale.y(trade.entry.price));
      ctx.lineTo(ts.x(trade.exit.index), scale.y(trade.exit.price));
      ctx.strokeStyle = tradeResult(trade).diff >= 0 ? colors.profit : colors.loss;
      ctx.lineWidth = 2;
      ctx.stroke();
      emphasized.push(other);
    }
    for (const pass of [0, 1]) {
      for (const f of emphasized) {
        const x = ts.x(f.index);
        const y = Math.round(scale.y(f.price));
        ctx.beginPath();
        ctx.moveTo(x - half, y);
        ctx.lineTo(x + half, y);
        ctx.lineCap = pass ? 'butt' : 'square';
        ctx.lineWidth = pass ? 3 : 6;
        ctx.strokeStyle = pass ? this.#colorOf(f, colors) : theme.bg;
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
    // A ring where the price meets the bar.
    for (const f of emphasized) {
      const x = ts.x(f.index);
      const y = Math.round(scale.y(f.price));
      ctx.beginPath();
      ctx.arc(x, y, DOT_R + 1.25, 0, TAU);
      ctx.fillStyle = theme.bg;
      ctx.fill();
      ctx.strokeStyle = this.#colorOf(f, colors);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  #timeText(time) {
    const chart = this.chart;
    const offset = chart.utcOffset;
    // As fine as the time itself: a date for midnight, seconds when it has them, milliseconds only on sub-second data.
    const fine = chart.data.interval < 1000 ? 1 : 1000;
    const interval = time % 1000 ? fine : time % 60_000 ? 1000 : (time + offset) % DAY ? 60_000 : DAY;
    return chart.options.formatTime?.(time, { kind: 'crosshair', interval }) ?? formatDateTime(time, offset, interval);
  }

  /** Text of the tooltip: { title, color, rows: [key, value, color?][], note }. */
  describe(hv = this.hover) {
    if (!hv) return null;
    const chart = this.chart;
    const colors = this.#colors();
    const price = (v) => chart.main.format(v);
    const qty = (v) => (this.options.formatQty ? this.options.formatQty(v) : qtyFormat.format(v));
    const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + price(Math.abs(v));
    const side = hv.buy ? t('Buy') : t('Sell');
    const rows = [];
    if (hv.fills.length > 1) {
      const fills = hv.fills;
      const total = fills.reduce((s, f) => s + (f.qty ?? 0), 0);
      let lo = Infinity;
      let hi = -Infinity;
      for (const f of fills) {
        if (f.price < lo) lo = f.price;
        if (f.price > hi) hi = f.price;
      }
      rows.push([t('Avg price'), price(this.#average(fills))]);
      if (lo !== hi) rows.push([t('Range'), `${price(lo)} – ${price(hi)}`]);
      if (total) rows.push([t('Qty'), qty(total)]);
      rows.push([t('First'), this.#timeText(fills[0].time)], [t('Last'), this.#timeText(fills[fills.length - 1].time)]);
      return { title: `${side} ×${fills.length}`, color: hv.buy ? colors.buy : colors.sell, rows, note: null };
    }
    const f = hv.fills[0];
    const role = f.role === 'entry' ? t('entry') : f.role === 'exit' ? t('exit') : null;
    rows.push([t('Price'), price(f.price)]);
    if (f.qty !== null) rows.push([t('Qty'), qty(f.qty)]);
    rows.push([t('Time'), this.#timeText(f.time)]);
    if (f.trade) {
      const data = chart.data;
      const r = tradeResult(f.trade, data.length ? data.close[data.length - 1] : NaN);
      if (r) {
        const value = formatPercent(r.pct) + (r.amount === null ? '' : ` (${signed(r.amount)})`);
        rows.push([r.open ? t('Unrealized') : t('P&L'), value, r.diff >= 0 ? colors.profit : colors.loss]);
      }
      const end = f.trade.exit ? f.trade.exit.time : data.lastTime;
      if (end > f.trade.entry.time) rows.push([t('Held'), formatDuration(end - f.trade.entry.time)]);
    }
    return { title: [side, role, f.label].filter(Boolean).join(' · '), color: this.#colorOf(f, colors), rows, note: f.note };
  }

  /** Details of the hovered marker in a small box beside it (same origin and clip as draw()). */
  drawTooltip(ctx) {
    const hv = this.hover;
    const info = this.#visible ? this.describe(hv) : null;
    if (!info) return;
    const theme = this.chart.theme;
    const { w: W, h: H } = this.chart.panes[0].rect;
    const keyFont = `11px ${theme.font}`;
    const valueFont = `11px ${theme.mono}`;
    const titleFont = `600 11px ${theme.font}`;
    const clip = (s, max) => {
      if (ctx.measureText(s).width <= max) return s;
      while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
      return s + '…';
    };
    ctx.save();
    ctx.font = keyFont;
    const keyW = Math.max(0, ...info.rows.map((r) => ctx.measureText(r[0]).width));
    ctx.font = valueFont;
    const valueW = Math.max(0, ...info.rows.map((r) => ctx.measureText(r[1]).width));
    ctx.font = titleFont;
    const title = clip(info.title, 240);
    const inner = Math.min(280, Math.max(ctx.measureText(title).width + 14, keyW + 14 + valueW));
    ctx.font = keyFont;
    const note = info.note ? clip(info.note, inner) : null;
    const row = 16;
    const w = inner + 20;
    const h = 12 + 18 + info.rows.length * row + (note ? row + 2 : 0) + 6;
    let x = hv.x + 16;
    if (x + w > W - 4) x = hv.x - 16 - w;
    x = Math.max(4, Math.min(W - w - 4, x));
    const y = Math.max(4, Math.min(H - h - 4, hv.y - h / 2));

    ctx.shadowColor = 'rgba(0,0,0,0.16)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = theme.surface;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 3);
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let ty = y + 6 + 9;
    // A small arrow in the side's color, then the title.
    ctx.fillStyle = info.color;
    ctx.beginPath();
    const ax = x + 10 + 4;
    if (hv.buy) {
      ctx.moveTo(ax, ty - 4);
      ctx.lineTo(ax - 4, ty + 3);
      ctx.lineTo(ax + 4, ty + 3);
    } else {
      ctx.moveTo(ax, ty + 4);
      ctx.lineTo(ax - 4, ty - 3);
      ctx.lineTo(ax + 4, ty - 3);
    }
    ctx.fill();
    ctx.font = titleFont;
    ctx.fillStyle = theme.text;
    ctx.fillText(title, x + 10 + 14, ty + 0.5);
    ty += 18;
    for (const [key, value, color] of info.rows) {
      ctx.font = keyFont;
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.textMuted;
      ctx.fillText(key, x + 10, ty + 0.5);
      ctx.font = valueFont;
      ctx.textAlign = 'right';
      ctx.fillStyle = color ?? theme.text;
      ctx.fillText(value, x + w - 10, ty + 0.5);
      ty += row;
    }
    if (note) {
      ctx.font = keyFont;
      ctx.textAlign = 'left';
      ctx.fillStyle = theme.textMuted;
      ctx.fillText(note, x + 10, ty + 2.5);
    }
    ctx.restore();
  }
}
