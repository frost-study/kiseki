import { MinMaxIndex } from '../core/MinMaxIndex.js';
import { formatCompact, formatPrice } from '../core/format.js';
import { t } from '../core/i18n.js';
import { drawColumns, drawDots, fillBand, fillCloud, strokeLine } from '../core/plots.js';
import { resolveColor, withAlpha } from '../core/theme.js';

let uid = 0;
const COLUMNS = new Set(['open', 'high', 'low', 'close', 'volume']);
const VALUE_PLOTS = new Set(['line', 'histogram', 'dots']);

/**
 * Runtime instance of an indicator. A definition (def) is purely declarative; this class takes care of
 * holding results, LOD, drawing, the legend and value ranges.
 *
 * Shape of a definition:
 * {
 *   id, name, title, category,
 *   overlay: true,                 // overlay on the main pane (false gives it its own pane)
 *   precision: 2 | 'inherit' | 'volume',
 *   scale: { id, top, bottom },    // overlay, but with an independent price scale (e.g. volume)
 *   behind: true,                  // draw behind the main series
 *   inputs:  { length: { type: 'int', label, default, min, max }, ... },
 *            // type: int | float | source | select(options) | bool
 *   buffers: ['tmp'],              // scratch arrays that are not plotted
 *   plots: [
 *     { key, type: 'line', color, width, dash, offset, label },
 *     { key, type: 'histogram', colors, colorOf(i, ctx), base, column },
 *     { key, type: 'dots', color },
 *     { type: 'band',  a, b, color, opacity },                 // fill between two lines
 *     { type: 'cloud', a, b, above, below, opacity, offset },  // fill colored by which line is on top
 *     { type: 'custom', back, key, column, draw(view, ctx, self) },
 *       // Draw it yourself. For things whose shape depends on the visible range (e.g. a volume profile).
 *       // self: { state (per-instance storage), index (LOD of `key`), array, color(c), format(v), tickSize }
 *   ],
 *   legend(ctx, i, theme, self) { return [{ k, v, color }] },   // build the legend yourself
 *   guides: [70, 30],              // horizontal guide lines
 *   zone: [30, 70],                // faint fill between guides
 *   calc({ data, n, from, inputs, out, src, utcOffset, interval }) { ... }
 * }
 *
 * calc fills out[key][from..n-1]. Everything before `from` still holds the previous results.
 * A numeric color is an index into the theme's categorical palette; 'up' / 'down' / 'accent' / 'muted' are role colors.
 */
export class Indicator {
  constructor(def, inputs = {}, styles = {}) {
    this.def = def;
    this.kind = 'indicator';
    this.id = `i${++uid}`;
    this.inputs = {};
    for (const [key, spec] of Object.entries(def.inputs ?? {})) this.inputs[key] = inputs[key] ?? spec.default;
    this.styles = JSON.parse(JSON.stringify(styles ?? {}));
    this.visible = true;
    this.scaleId = def.scale?.id ?? 'right';
    this.out = {};
    this.data = null;
    this.chart = null;
    this.pane = null;
    /** Per-instance storage for custom plots. */
    this.state = {};
    // Plots that hold values (including custom plots with a key) get an array and an LOD index.
    const valued = def.plots.filter((p) => VALUE_PLOTS.has(p.type) || (p.type === 'custom' && p.key));
    this.#keys = [...valued.filter((p) => !p.column).map((p) => p.key), ...(def.buffers ?? [])];
    for (const p of valued) this.#index.set(p.key, new MinMaxIndex());
    this.#ctx = {
      data: null,
      n: 0,
      from: 0,
      inputs: this.inputs,
      out: this.out,
      src: (name) => this.#source(name),
      utcOffset: 0,
      interval: 60_000,
    };
  }

  #keys;
  #index = new Map();
  #cap = 0;
  #sources = new Map();
  #ctx;

  get title() {
    const params = [];
    for (const [key, spec] of Object.entries(this.def.inputs ?? {})) {
      const val = this.inputs[key];
      if (spec.inTitle === false) continue;
      if (spec.type === 'int' || spec.type === 'float') params.push(val);
      else if (spec.type === 'source' && val !== 'close') params.push(val);
    }
    const name = t(this.def.name);
    return params.length ? `${name} ${params.join(' ')}` : name;
  }

  attach(chart, pane) {
    this.chart = chart;
    this.pane = pane;
  }

  setData(data) {
    this.data = data;
    this.update(0);
  }

  setInputs(inputs) {
    Object.assign(this.inputs, inputs);
    if (this.data) this.update(0);
  }

  /** The data changed in [from, n). */
  update(from) {
    const d = this.data;
    if (!d) return;
    const n = d.length;
    if (d.capacity > this.#cap) this.#grow(d.capacity);
    const ctx = this.#ctx;
    ctx.data = d;
    ctx.n = n;
    ctx.from = Math.max(0, Math.min(from, n));
    ctx.utcOffset = this.chart ? this.chart.utcOffset : 0;
    ctx.interval = d.interval;
    this.def.calc(ctx);
    for (const [key, idx] of this.#index) {
      const arr = this.#array(key);
      idx.update(arr, arr, n < idx.n ? 0 : Math.min(ctx.from, idx.n), n);
    }
  }

  #grow(cap) {
    for (const key of this.#keys) {
      const next = new Float64Array(cap).fill(NaN);
      if (this.out[key]) next.set(this.out[key]);
      this.out[key] = next;
    }
    this.#cap = cap;
  }

  /** The array a plot reads (supports `column`, which uses a data column directly). */
  #array(key) {
    const plot = this.def.plots.find((p) => p.key === key);
    return plot?.column ? this.data[plot.column] : this.out[key];
  }

  /** Input series for the calculation. Derived series such as hl2 are cached and updated incrementally. */
  #source(name) {
    const d = this.data;
    if (COLUMNS.has(name)) return d[name];
    let s = this.#sources.get(name);
    if (!s || s.buf.length < d.capacity) {
      s = { buf: new Float64Array(d.capacity), n: 0 };
      this.#sources.set(name, s);
    }
    const { open, high, low, close } = d;
    const buf = s.buf;
    const n = d.length;
    for (let i = Math.min(this.#ctx.from, s.n); i < n; i++) {
      buf[i] =
        name === 'hl2' ? (high[i] + low[i]) / 2 :
        name === 'hlc3' ? (high[i] + low[i] + close[i]) / 3 :
        name === 'ohlc4' ? (open[i] + high[i] + low[i] + close[i]) / 4 :
        close[i];
    }
    s.n = n;
    return buf;
  }

  #offset(plot) {
    return typeof plot.offset === 'function' ? plot.offset(this.inputs) : plot.offset ?? 0;
  }

  #color(plot, theme, field = 'color') {
    return resolveColor(theme, this.styles[plot.key ?? plot.type]?.[field] ?? plot[field]);
  }

  /** Value range over the visible range (takes the unclamped range for plots with an offset). */
  range(_a, _b, ra, rb) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const plot of this.def.plots) {
      const idx = this.#index.get(plot.key);
      if (!idx || plot.type === 'custom') continue;
      const off = this.#offset(plot);
      const arr = this.#array(plot.key);
      const r = idx.query(arr, arr, ra - off, rb - off);
      if (!r) continue;
      if (r.min < mn) mn = r.min;
      if (r.max > mx) mx = r.max;
      if (plot.type === 'histogram') {
        const base = plot.base ?? 0;
        if (base < mn) mn = base;
        if (base > mx) mx = base;
      }
    }
    for (const g of this.def.guides ?? []) {
      if (g < mn) mn = g;
      if (g > mx) mx = g;
    }
    return mn <= mx ? { min: mn, max: mx } : null;
  }

  drawBack(v) {
    const { ctx, theme } = v;
    const n = this.data.length;
    const zone = this.def.zone;
    if (zone) {
      const y1 = v.y(zone[1]);
      const y2 = v.y(zone[0]);
      ctx.fillStyle = withAlpha(resolveColor(theme, this.def.plots[0].color ?? 'accent'), 0.06);
      ctx.fillRect(0, y1, v.width, y2 - y1);
    }
    for (const plot of this.def.plots) {
      if (plot.type === 'band') {
        fillBand(v, this.out[plot.a], this.out[plot.b], n, withAlpha(this.#color(plot, theme), plot.opacity ?? 0.08), this.#offset(plot));
      } else if (plot.type === 'cloud') {
        const o = plot.opacity ?? 0.14;
        fillCloud(v, this.out[plot.a], this.out[plot.b], n, withAlpha(this.#color(plot, theme, 'above'), o), withAlpha(this.#color(plot, theme, 'below'), o), this.#offset(plot));
      }
    }
    this.#drawCustom(v, true);
    if (this.def.behind) this.#drawValues(v);
  }

  #self(plot) {
    return {
      state: this.state,
      index: plot.key ? this.#index.get(plot.key) : null,
      array: plot.key ? this.#array(plot.key) : null,
      color: (c) => resolveColor(this.chart ? this.chart.theme : {}, c),
      format: (val) => this.format(val),
      tickSize: 10 ** -(this.chart ? this.chart.main.precision : 2),
    };
  }

  #drawCustom(v, back) {
    for (const plot of this.def.plots) {
      if (plot.type !== 'custom' || !!plot.back !== back) continue;
      v.ctx.save();
      plot.draw(v, this.#ctx, this.#self(plot));
      v.ctx.restore();
    }
  }

  draw(v) {
    const { ctx, theme } = v;
    const guides = this.def.guides;
    if (guides) {
      ctx.beginPath();
      for (const g of guides) {
        const Y = Math.round(v.y(g)) + 0.5;
        ctx.moveTo(0, Y);
        ctx.lineTo(v.width, Y);
      }
      ctx.strokeStyle = theme.textFaint;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!this.def.behind) this.#drawValues(v);
    this.#drawCustom(v, false);
  }

  #drawValues(v) {
    const { theme } = v;
    const n = this.data.length;
    for (const plot of this.def.plots) {
      const idx = this.#index.get(plot.key);
      if (!idx || plot.type === 'custom') continue;
      const arr = this.#array(plot.key);
      const offset = this.#offset(plot);
      if (plot.type === 'line') {
        strokeLine(v, arr, n, {
          color: this.#color(plot, theme),
          width: this.styles[plot.key]?.width ?? plot.width ?? 1.5,
          dash: plot.dash,
          offset,
          index: idx,
        });
      } else if (plot.type === 'histogram') {
        const custom = this.styles[plot.key]?.colors;
        const colors = (plot.colors ?? [plot.color ?? 0]).map((c, k) => {
          if (custom?.[k]) return custom[k];
          return Array.isArray(c) ? withAlpha(resolveColor(theme, c[0]), c[1]) : resolveColor(theme, c);
        });
        const ctx = this.#ctx;
        drawColumns(v, arr, n, {
          base: plot.base ?? 0,
          colors,
          colorOf: plot.colorOf ? (i) => plot.colorOf(i, ctx) : null,
          index: idx,
          offset,
        });
      } else if (plot.type === 'dots') {
        drawDots(v, arr, n, this.#color(plot, theme), plot.radius ?? 1.8, offset);
      }
    }
  }

  format(v) {
    const p = this.def.precision;
    if (p === 'volume') return formatCompact(v);
    if (p === 'inherit') return this.chart ? this.chart.main.format(v) : formatPrice(v, 2);
    return formatPrice(v, p ?? 2);
  }

  /** Legend values. */
  legend(i, theme) {
    if (this.def.legend) return this.def.legend(this.#ctx, i, theme, this.#self({}));
    const items = [];
    const n = this.data ? this.data.length : 0;
    for (const plot of this.def.plots) {
      if (!this.#index.has(plot.key) || plot.legend === false) continue;
      if (plot.type === 'custom' && !plot.legend) continue;
      const j = i - this.#offset(plot);
      const val = j >= 0 && j < n ? this.#array(plot.key)[j] : NaN;
      let color;
      if (plot.type === 'histogram' && plot.colorOf && val === val) {
        const c = (plot.colors ?? [])[plot.colorOf(j, this.#ctx)];
        color = resolveColor(theme, Array.isArray(c) ? c[0] : c);
      } else {
        color = this.#color(plot, theme);
      }
      items.push({ k: plot.label ? t(plot.label) : undefined, v: val === val ? this.format(val) : '—', color });
    }
    return items;
  }

  /** Last-value labels for the price axis. */
  lastValues(theme) {
    const n = this.data ? this.data.length : 0;
    if (!n) return [];
    const res = [];
    for (const plot of this.def.plots) {
      if (plot.type !== 'line' || plot.axisLabel === false || this.#offset(plot) !== 0) continue;
      const val = this.out[plot.key][n - 1];
      if (val === val) res.push({ value: val, color: this.#color(plot, theme), line: false });
    }
    return res;
  }

  /** For the settings dialog: plots whose color can be changed. */
  colorSlots(theme) {
    return this.def.plots
      .filter((p) => p.type === 'line' || p.type === 'dots')
      .map((p) => ({ key: p.key, label: p.label ? t(p.label) : p.key, color: this.#color(p, theme) }));
  }

  setStyle(key, style) {
    this.styles[key] = { ...this.styles[key], ...style };
  }

  serialize() {
    return { id: this.def.id, inputs: { ...this.inputs }, styles: this.styles, visible: this.visible };
  }
}
