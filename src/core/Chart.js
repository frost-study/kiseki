import { DrawingManager } from '../drawings/DrawingManager.js';
import { Indicator } from '../indicators/Indicator.js';
import { TradeMarkers } from '../trades/TradeMarkers.js';
import { BarData } from './BarData.js';
import { EventEmitter } from './EventEmitter.js';
import { Interaction } from './Interaction.js';
import { Legend } from './Legend.js';
import { Pane } from './Pane.js';
import { indicators as indicatorDefs, seriesTypes } from './Registry.js';
import { TimeScale } from './TimeScale.js';
import { formatDateTime } from './format.js';
import { t } from './i18n.js';
import { applyThemeVars, ensureStyles } from './styles.js';
import { contrastText, resolveColor, resolveTheme, withAlpha } from './theme.js';

const OVERLAY = 1;
const BASE = 2;
const LAYOUT = 4;
const SUB_PANE_WEIGHT = 0.3;
let lineUid = 0;

/**
 * The chart.
 *
 * The view is two stacked canvases:
 *   base    … grid, series, axes. Redrawn only when data or the visible range changes
 *   overlay … crosshair and drawings. Redrawn on every mouse move (cheap)
 * Text such as the legend is rendered as DOM (layer).
 *
 * Besides the series and indicators, the main pane can show what the host knows about:
 *   chart.trades          where a position was entered and left, at the exact time and price (see TradeMarkers)
 *   chart.addPriceLine()  horizontal lines such as an average cost, a target or a stop
 *
 * Events: 'crosshair' 'range' 'data' 'indicators' 'type' 'tool' 'drawings'
 *           'drawing:select' 'indicator:settings' 'theme' 'frame'
 *           'trades' 'trade:hover' 'trade:click'
 */
export class Chart extends EventEmitter {
  /**
   * @param {HTMLElement} container
   * @param {object} [options]
   * @param {string} [options.type='candlestick'] main series type (an id in seriesTypes)
   * @param {string|object} [options.theme='light'] 'light' (paper) | 'dark' (ink)
   * @param {string|{up:string, down:string}} [options.scheme='wa'] candle colors ('wa' | 'intl' | 'sumi'), or your own pair of colors
   * @param {number} [options.utcOffset] display time zone offset in ms. Defaults to the local time zone
   * @param {boolean} [options.overlayLabels=false] also show last-value labels for indicators overlaid on the main pane
   *
   * Formatting hooks, for hosts that have their own number and date formats (all optional):
   * @param {(value:number)=>string} [options.formatPrice] prices of the main series: axis, crosshair, last-value label, legend
   * @param {(values:number[])=>string[]|null|undefined} [options.formatTicks] the main pane's axis tick labels, formatted
   *   together (so they can share a precision). Return nothing to keep the built-in labels. Not used on the percent scale
   * @param {(time:number, info:{kind:'mark', level:number} | {kind:'crosshair', interval:number})=>string|null|undefined} [options.formatTime]
   *   time-axis tick labels ('mark'; level is the TimeMarks weight: 70 year, 60 month, 50 day, below that a time of day)
   *   and the crosshair's time label. Return null or undefined to keep the built-in text
   *
   * Options for small, embedded views (all optional):
   * @param {boolean} [options.legend=true]      legend in the top-left corner
   * @param {boolean} [options.priceAxis=true]   price axis
   * @param {boolean} [options.timeAxis=true]    time axis
   * @param {boolean|'horizontal'} [options.grid=true] grid lines
   * @param {boolean} [options.interactive=true] pan and zoom by drag / wheel. When false, page scrolling is never intercepted
   * @param {boolean|'vertical'} [options.crosshair=true] 'vertical' draws only the vertical line and a marker on the series
   * @param {boolean|'label'} [options.priceLine=true] horizontal line and label for the last value ('label': the label without the line)
   * @param {number}  [options.rightOffset=6]    empty bars to the right of the latest bar
   * @param {object}  [options.series]           options for the main series (color, etc.)
   */
  constructor(container, options = {}) {
    super();
    ensureStyles(container);
    this.options = {
      type: 'candlestick',
      theme: 'light',
      scheme: 'wa',
      utcOffset: -new Date().getTimezoneOffset() * 60_000,
      ...options,
    };
    this.utcOffset = this.options.utcOffset;
    this.theme = resolveTheme(this.options.theme, this.options.scheme);
    this.symbol = { name: '', description: '', precision: 2 };
    this.timeframeLabel = '';
    this.data = new BarData();
    this.timeScale = new TimeScale();
    this.timeScale.marks.format = (time, level) => this.options.formatTime?.(time, { kind: 'mark', level });
    this.panes = [new Pane('main', 1)];
    this.panes[0].scale.formatTicks = (values) => this.options.formatTicks?.(values);
    /** @type {Indicator[]} */
    this.indicators = [];
    this.crosshair = { active: false, x: 0, y: 0, pane: null, index: -1 };
    this.stats = { frameMs: 0, drawMs: 0 };
    this.revision = 0;
    this.width = 0;
    this.height = 0;
    this.timeAxisHeight = this.options.timeAxis === false ? 0 : 28;
    this.axisWidth = this.options.priceAxis === false ? 0 : 60;
    this.dpr = 1;

    this.root = document.createElement('div');
    this.root.className = 'kc-root';
    this.root.tabIndex = this.options.interactive === false ? -1 : 0;
    // A non-interactive view lets touch scrolling pass through to the page.
    if (this.options.interactive === false) this.root.style.touchAction = 'auto';
    this.#base = document.createElement('canvas');
    this.#over = document.createElement('canvas');
    this.layer = document.createElement('div');
    this.layer.className = 'kc-layer';
    this.#liveBtn = document.createElement('button');
    this.#liveBtn.className = 'kc-live';
    this.#liveBtn.title = t('Jump to the latest bar');
    this.#liveBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l6 6-6 6M13 6l6 6-6 6"/></svg>';
    this.#liveBtn.addEventListener('click', () => this.scrollToRealtime());
    this.layer.append(this.#liveBtn);
    this.root.append(this.#base, this.#over, this.layer);
    container.append(this.root);
    applyThemeVars(this.root, this.theme);

    this.main = this.#createSeries(this.options.type);
    this.panes[0].add(this.main);
    this.main.attach(this, this.panes[0]);
    this.main.setData(this.data);
    this.timeScale.setData(this.data, this.utcOffset);
    if (this.options.rightOffset !== undefined) this.timeScale.rightOffset = this.options.rightOffset;

    this.drawings = new DrawingManager(this);
    /** @type {{id:string, price:number, title:string, color:string|number|null, dash:number[]|null, width:number, axisLabel:boolean, autoscale:boolean}[]} */
    this.priceLines = [];
    this.trades = new TradeMarkers(this);
    this.legend = new Legend(this);
    this.interaction = new Interaction(this);
    this.legend.rebuild();

    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(this.root);
    this.#resize();
    this.#watchPixelRatio();
  }

  /** Redraw when the device pixel ratio changes (moved to another display, browser zoom). The size is unchanged, so ResizeObserver does not catch it. */
  #watchPixelRatio() {
    const query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = () => {
      this.#resize();
      this.#watchPixelRatio();
    };
    query.addEventListener('change', onChange, { once: true });
    this.#unwatchPixelRatio = () => query.removeEventListener('change', onChange);
  }

  #base;
  #over;
  #liveBtn;
  #resizeObserver;
  #unwatchPixelRatio = null;
  #raf = 0;
  #dirty = 0;
  #dirtyFrom = Infinity;
  #range = { a: 0, b: -1, ra: 0, rb: -1 };
  #marks = [];
  #anim = null;
  #fit = null;
  #destroyed = false;

  /* ───────────── Data ───────────── */

  /** Set symbol info (name and price precision). */
  setSymbol(info, timeframeLabel = this.timeframeLabel) {
    this.symbol = { ...this.symbol, ...info };
    this.timeframeLabel = timeframeLabel;
    this.main.precision = this.symbol.precision ?? 2;
    this.legend.rebuild();
    this.invalidate();
  }

  /**
   * Replace all data.
   * @param {BarData} data
   * @param {{ keepView?: boolean }} [opts] keepView: keep the time at the right edge (for timeframe switches)
   */
  setData(data, { keepView = false } = {}) {
    const ts = this.timeScale;
    const anchor = keepView && this.data.length && !ts.atRealtime ? ts.indexToTime(ts.rightIndex) : null;
    this.data = data;
    this.#dirtyFrom = Infinity;
    this.#anim = null;
    ts.setData(data, this.utcOffset);
    for (const pane of this.panes) for (const item of pane.items) item.setData(data);
    this.trades.dataChanged();
    this.panes[0].scale.auto = true;
    ts.maxSpacing = 80;
    ts.barSpacing = 8;
    ts.rightIndex = anchor === null ? ts.realtimeIndex : ts.timeToIndex(anchor);
    this.revision++;
    this.emit('data', data);
    this.invalidate();
  }

  /**
   * Update one bar. Overwrites the latest bar when `time` matches, appends when newer, ignores when older.
   * Recalculation and drawing are batched into the next frame, so calling this on every tick is fine.
   */
  update(bar) {
    const d = this.data;
    const n = d.length;
    if (n && bar.time < d.time[n - 1]) return; // Ignore bars older than the latest one (an out-of-order feed must not corrupt the latest bar).
    if (n && bar.time === d.time[n - 1]) {
      d.setLast(bar.open, bar.high, bar.low, bar.close, bar.volume);
      this.#touch(n - 1);
    } else {
      this.append(bar);
    }
  }

  /** Always append as a new bar (e.g. several ticks with the same timestamp). */
  append(bar) {
    this.#touch(this.data.push(bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume ?? 0));
  }

  #touch(i) {
    if (i < this.#dirtyFrom) this.#dirtyFrom = i;
    this.invalidate();
  }

  /** Apply the accumulated updates to the scale, series and indicators. */
  #flushData() {
    const from = this.#dirtyFrom;
    if (from === Infinity) return;
    this.#dirtyFrom = Infinity;
    this.timeScale.sync();
    for (const pane of this.panes) for (const item of pane.items) item.update(from);
    this.revision++;
    this.emit('data', this.data);
  }

  /* ───────────── Series / indicators ───────────── */

  #createSeries(type) {
    const Type = seriesTypes.get(seriesTypes.has(type) ? type : 'candlestick');
    return new Type(this.options.series);
  }

  get type() {
    return this.main.constructor.id;
  }

  /** Switch the main series type. */
  setType(type) {
    if (type === this.type || !seriesTypes.has(type)) return;
    const next = this.#createSeries(type);
    next.precision = this.main.precision;
    this.panes[0].replace(this.main, next);
    this.main = next;
    next.attach(this, this.panes[0]);
    next.setData(this.data);
    this.revision++;
    this.legend.rebuild();
    this.emit('type', type);
    this.invalidate();
  }

  /**
   * Add an indicator.
   * @param {string} id      an id registered in `indicators`
   * @param {object} [inputs] parameters (omitted ones use the definition's defaults)
   * @param {object} [styles] per-plot appearance { [plotKey]: { color, width } }
   */
  addIndicator(id, inputs = {}, styles = null) {
    const def = indicatorDefs.get(id);
    const ind = new Indicator(def, inputs, styles ?? this.#autoStyle(def));
    let pane = this.panes[0];
    if (!def.overlay) {
      pane = new Pane(ind.id, SUB_PANE_WEIGHT);
      this.panes.push(pane);
    }
    pane.add(ind);
    ind.attach(this, pane);
    ind.setData(this.data);
    this.indicators.push(ind);
    this.#structureChanged();
    return ind;
  }

  /** Give single-line overlays an unused categorical color so lines of the same color do not pile up. */
  #autoStyle(def) {
    const lines = def.plots.filter((p) => p.type === 'line');
    if (!def.overlay || lines.length !== 1 || def.plots.length !== 1 || typeof lines[0].color !== 'number') return {};
    const used = new Set();
    for (const ind of this.indicators) {
      const p = ind.def.plots;
      if (ind.def.overlay && p.length === 1 && p[0].type === 'line') used.add(ind.styles[p[0].key]?.color ?? p[0].color);
    }
    const count = this.theme.palette.length;
    for (let k = 0; k < count; k++) {
      const c = (lines[0].color + k) % count;
      if (!used.has(c)) return c === lines[0].color ? {} : { [lines[0].key]: { color: c } };
    }
    return {};
  }

  removeIndicator(ind) {
    const i = this.indicators.indexOf(ind);
    if (i < 0) return;
    this.indicators.splice(i, 1);
    ind.pane.remove(ind);
    if (ind.pane !== this.panes[0] && !ind.pane.items.length) {
      this.panes.splice(this.panes.indexOf(ind.pane), 1);
      // Do not leave the crosshair pointing at a pane that no longer exists.
      if (this.crosshair.pane === ind.pane) this.clearCrosshair();
    }
    this.#structureChanged();
  }

  setIndicatorVisible(ind, visible) {
    ind.visible = visible;
    this.#structureChanged();
  }

  /** Call after changing parameters or colors. */
  updateIndicator(ind, inputs = null, styles = null) {
    if (styles) for (const [key, style] of Object.entries(styles)) ind.setStyle(key, style);
    if (inputs) ind.setInputs(inputs);
    this.#structureChanged();
  }

  #structureChanged() {
    this.revision++;
    this.legend.rebuild();
    this.emit('indicators', this.indicators);
    this.invalidate('layout');
  }

  /* ───────────── View ───────────── */

  setTheme(theme, scheme = this.theme.scheme) {
    this.theme = resolveTheme(theme, scheme);
    applyThemeVars(this.root, this.theme);
    this.revision++;
    this.emit('theme', this.theme);
    this.invalidate();
  }

  /** Call after changing the UI language (setLocale in i18n). Rebuilds the legend and axis labels. */
  refreshLocale() {
    this.#liveBtn.title = t('Jump to the latest bar');
    this.revision++;
    this.legend.rebuild();
    this.invalidate();
  }

  /** Price scale mode: 'linear' | 'log' | 'percent' */
  setScaleMode(mode) {
    this.panes[0].scale.setMode(mode);
    this.invalidate();
  }

  get scaleMode() {
    return this.panes[0].scale.mode;
  }

  /** Visible bars [first, last], clamped to the data range. */
  visibleBars() {
    const [f, t] = this.timeScale.visibleRange();
    return [Math.max(0, Math.floor(f)), Math.min(this.data.length - 1, Math.ceil(t))];
  }

  visibleTimeRange() {
    const ts = this.timeScale;
    const [f, t] = ts.visibleRange();
    return { from: ts.indexToTime(f), to: ts.indexToTime(t) };
  }

  /** Show a time range. */
  setVisibleTimeRange(from, to, animate = true) {
    const ts = this.timeScale;
    const a = ts.timeToIndex(from);
    const b = ts.timeToIndex(to);
    const target = {
      barSpacing: Math.min(ts.maxSpacing, Math.max(ts.minSpacing, ts.width / Math.max(1, b - a))),
      rightIndex: b - 0.5,
    };
    if (animate) this.animateView(target);
    else {
      Object.assign(ts, target);
      this.invalidate();
    }
  }

  /**
   * Keep the span from `from` to `to` (latest when omitted) fitted to the full width at all times.
   * Survives resizes and new bars (for overview and mini charts). Released when the user pans or zooms.
   */
  fitTimeRange(from, to = null) {
    this.#fit = { from, to };
    this.#anim = null;
    this.invalidate();
  }

  /** Release the lock set by fitTimeRange. */
  releaseFit() {
    this.#fit = null;
  }

  #applyFit() {
    const fit = this.#fit;
    const ts = this.timeScale;
    const n = this.data.length;
    if (!fit || !n) return;
    const a = Math.max(0, Math.ceil(ts.timeToIndex(fit.from) - 1e-9));
    const b = fit.to === null ? n - 1 : Math.min(n - 1, Math.floor(ts.timeToIndex(fit.to) + 1e-9));
    const bars = Math.max(Math.min(5, n), b - a + 1); // always show at least a few bars (so edge clamping never cuts off the latest)
    ts.maxSpacing = Math.max(80, ts.width); // stretch edge to edge even when there are few bars
    ts.barSpacing = ts.width / bars;
    ts.rightIndex = b;
  }

  /** Show the latest `count` bars. */
  showLastBars(count, animate = true) {
    const target = this.timeScale.lastBarsTarget(count);
    if (animate) this.animateView(target);
    else {
      Object.assign(this.timeScale, target);
      this.invalidate();
    }
  }

  fitContent() {
    this.animateView(this.timeScale.fitTarget());
  }

  scrollToRealtime() {
    this.animateView({ rightIndex: this.timeScale.realtimeIndex });
  }

  /** Bring a time to the middle of the view, keeping the zoom. */
  scrollToTime(time, animate = true) {
    const ts = this.timeScale;
    const view = { rightIndex: ts.timeToIndex(time) + ts.width / ts.barSpacing / 2 - 0.5 };
    if (animate) this.animateView(view);
    else {
      this.#fit = null;
      Object.assign(ts, view);
      this.invalidate();
    }
  }

  /** Animate the position and zoom smoothly. */
  animateView(target, duration = 280) {
    const ts = this.timeScale;
    this.#fit = null;
    this.#anim = {
      t0: performance.now(),
      duration,
      from: { barSpacing: ts.barSpacing, rightIndex: ts.rightIndex },
      to: { barSpacing: target.barSpacing ?? ts.barSpacing, rightIndex: target.rightIndex ?? ts.rightIndex },
      // A move that sticks to the latest bar keeps following it if bars arrive while animating.
      follow: target.rightIndex === ts.realtimeIndex,
    };
    this.invalidate();
  }

  stopAnimation() {
    this.#anim = null;
  }

  /** Change options of the main series (color, etc.). */
  setSeriesOptions(options) {
    this.options.series = { ...this.options.series, ...options };
    Object.assign(this.main.options, options);
    this.invalidate();
  }

  /**
   * Add a horizontal line at a price on the main pane (an average cost, a target, a stop, …).
   * @param {object} options
   * @param {number} options.price
   * @param {string} [options.title] short text shown above the line at the right edge
   * @param {string|number} [options.color] a CSS color, a palette index or a role name ('up', 'down', 'accent', …)
   * @param {number[]|null} [options.dash=[5, 4]] dash pattern; null for a solid line
   * @param {number} [options.width=1]
   * @param {boolean} [options.axisLabel=true] show the price on the axis
   * @param {boolean} [options.autoscale=false] keep the line inside the price range
   * @returns {object} the line; pass it to updatePriceLine() / removePriceLine()
   */
  addPriceLine(options) {
    const line = { id: `p${++lineUid}`, price: NaN, title: '', color: null, dash: [5, 4], width: 1, axisLabel: true, autoscale: false, ...options };
    this.priceLines.push(line);
    this.invalidate();
    return line;
  }

  updatePriceLine(line, options) {
    const target = this.priceLines.find((l) => l === line || l.id === line);
    if (!target) return;
    Object.assign(target, options);
    this.invalidate();
  }

  /** Remove a price line (the object returned by addPriceLine, or its id). Without an argument, remove all of them. */
  removePriceLine(line = null) {
    this.priceLines = line === null ? [] : this.priceLines.filter((l) => l !== line && l.id !== line);
    this.invalidate();
  }

  #lineColor(line) {
    return resolveColor(this.theme, line.color ?? this.theme.annotation);
  }

  /** Values the main pane's scale has to show besides its series: visible trade markers and the price lines that ask for it. */
  #extraRange(ra, rb) {
    let range = this.trades.range(ra, rb);
    for (const line of this.priceLines) {
      if (!line.autoscale || !Number.isFinite(line.price)) continue;
      range ??= { min: line.price, max: line.price };
      range.min = Math.min(range.min, line.price);
      range.max = Math.max(range.max, line.price);
    }
    return range;
  }

  #drawPriceLines(ctx, plotW, h) {
    const scale = this.panes[0].scale;
    ctx.font = `11px ${this.theme.font}`;
    ctx.textAlign = 'right';
    ctx.lineJoin = 'round';
    for (const line of this.priceLines) {
      const y = scale.y(line.price);
      if (!(y >= -1 && y <= h + 1)) continue;
      const color = this.#lineColor(line);
      const Y = Math.round(y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, Y);
      ctx.lineTo(plotW, Y);
      ctx.strokeStyle = color;
      ctx.lineWidth = line.width ?? 1;
      ctx.setLineDash(line.dash ?? []);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!line.title) continue;
      // The title sits above the line (below it near the top edge), outlined in the background color so it stays readable over the series.
      const above = Y > 18;
      ctx.textBaseline = above ? 'bottom' : 'top';
      const ty = above ? Y - 3 : Y + 3;
      ctx.lineWidth = 3;
      ctx.strokeStyle = this.theme.bg;
      ctx.strokeText(line.title, plotW - 8, ty);
      ctx.fillStyle = color;
      ctx.fillText(line.title, plotW - 8, ty);
    }
  }

  #stepAnimation(now) {
    const an = this.#anim;
    if (!an) return;
    const ts = this.timeScale;
    const k = Math.min(1, (now - an.t0) / an.duration);
    const e = 1 - (1 - k) ** 3;
    const toRight = an.follow ? ts.realtimeIndex : an.to.rightIndex;
    // Interpolating the zoom in log space makes the zoom rate look constant.
    ts.barSpacing = Math.exp(Math.log(an.from.barSpacing) + (Math.log(an.to.barSpacing) - Math.log(an.from.barSpacing)) * e);
    ts.rightIndex = an.from.rightIndex + (toRight - an.from.rightIndex) * e;
    if (k >= 1) this.#anim = null;
    this.#dirty |= BASE;
    if (this.#anim) this.#schedule();
  }

  /** Index of the bar shown in the legend. */
  legendIndex() {
    const n = this.data.length;
    const i = this.crosshair.active ? this.crosshair.index : n - 1;
    return i >= 0 && i < n ? i : n - 1;
  }

  setCrosshair(x, y, pane) {
    const ts = this.timeScale;
    const c = this.crosshair;
    const index = Math.round(ts.indexAt(x));
    c.active = true;
    c.x = x;
    c.y = y;
    c.pane = pane;
    if (index !== c.index) {
      c.index = index;
      const n = this.data.length;
      this.emit('crosshair', { index, time: ts.indexToTime(index), bar: index >= 0 && index < n ? this.data.bar(index) : null });
    }
    this.invalidate('overlay');
  }

  clearCrosshair() {
    if (!this.crosshair.active) return;
    this.crosshair.active = false;
    this.crosshair.index = -1;
    this.emit('crosshair', null);
    this.invalidate('overlay');
  }

  /* ───────────── Render loop ───────────── */

  /** Schedule a redraw. what: 'overlay' | 'base' | 'layout' */
  invalidate(what = 'base') {
    this.#dirty |= what === 'overlay' ? OVERLAY : what === 'layout' ? LAYOUT | BASE : BASE;
    this.#schedule();
  }

  /** Draw right now instead of waiting for the scheduled frame (for tests, or to read state right after drawing). */
  renderNow() {
    cancelAnimationFrame(this.#raf);
    this.#frame(performance.now());
  }

  #schedule() {
    if (!this.#raf && !this.#destroyed) this.#raf = requestAnimationFrame(this.#frame);
  }

  #frame = (now) => {
    this.#raf = 0;
    if (!this.width || !this.height) return;
    const t0 = performance.now();
    this.#stepAnimation(now);
    this.#flushData();
    const dirty = this.#dirty;
    this.#dirty = 0;
    if (dirty & LAYOUT) this.#layout();
    if (dirty & (BASE | LAYOUT)) {
      this.#drawBase();
      this.stats.drawMs = performance.now() - t0;
    }
    this.#drawOverlay();
    this.legend.update();
    this.#liveBtn.style.display = this.timeScale.atRealtime || !this.data.length || this.options.interactive === false ? 'none' : 'grid';
    this.stats.frameMs = performance.now() - t0;
    this.emit('frame', this.stats);
  };

  #resize() {
    const rect = this.root.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    for (const c of [this.#base, this.#over]) {
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    // Lay out here, so a view range requested before the first frame is computed correctly.
    this.#layout();
    this.invalidate('layout');
  }

  get plotWidth() {
    return Math.max(40, this.width - this.axisWidth);
  }

  #layout() {
    const plotW = this.plotWidth;
    const count = this.panes.length;
    const avail = Math.max(20, this.height - this.timeAxisHeight - (count - 1));
    const total = this.panes.reduce((s, p) => s + p.weight, 0);
    let y = 0;
    this.panes.forEach((pane, i) => {
      const h = i === count - 1 ? avail + (count - 1) - y : Math.round((avail * pane.weight) / total);
      pane.layout({ x: 0, y, w: plotW, h: Math.max(20, h) });
      y += h + 1;
    });
    this.timeScale.setWidth(plotW);
    this.legend.position();
    const last = this.panes[count - 1].rect;
    this.#liveBtn.style.left = `${plotW - 40}px`;
    this.#liveBtn.style.top = `${last.y + last.h - 40}px`;
  }

  /** Move a pane border (lower the top edge of pane `index` by dy). */
  resizePanes(index, dy) {
    const above = this.panes[index - 1];
    const below = this.panes[index];
    if (!above || !below) return;
    const perPx = (above.weight + below.weight) / (above.rect.h + below.rect.h);
    const min = 48 * perPx;
    const d = Math.max(min - above.weight, Math.min(below.weight - min, dy * perPx));
    above.weight += d;
    below.weight -= d;
    this.invalidate('layout');
  }

  #view(ctx, pane, item) {
    const ts = this.timeScale;
    const scale = pane.scaleOf(item);
    const r = this.#range;
    const dpr = this.dpr;
    const oy = Math.round(pane.rect.y * dpr);
    return {
      ctx,
      dpr,
      theme: this.theme,
      width: pane.rect.w,
      height: pane.rect.h,
      x0: ts.x0,
      bs: ts.barSpacing,
      a: r.a,
      b: r.b,
      ra: r.ra,
      rb: r.rb,
      scale,
      y: (v) => scale.y(v),
      bitmap: () => {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, oy);
      },
    };
  }

  #drawBase(retry = true) {
    const ts = this.timeScale;
    const { theme, dpr } = this;
    const ctx = this.#base.getContext('2d');
    const n = this.data.length;
    this.#applyFit();
    ts.clamp();
    const [rf, rt] = ts.visibleRange();
    const ra = Math.floor(rf);
    const rb = Math.ceil(rt);
    const a = Math.max(0, ra);
    const b = Math.min(n - 1, rb);
    const prev = this.#range;
    this.#range = { a, b, ra, rb };
    if (prev.a !== a || prev.b !== b) this.emit('range', { from: a, to: b });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `11px ${theme.mono}`;

    // Decide value ranges and ticks, then size the price axis from the label widths.
    let labelW = 0;
    for (const pane of this.panes) {
      pane.autoscale(a, b, ra, rb, pane === this.panes[0] ? this.#extraRange(ra, rb) : null);
      pane.ticks = pane.scale.ticks();
      pane.tags = this.#collectTags(pane);
      for (const t of pane.ticks) labelW = Math.max(labelW, ctx.measureText(t.label).width);
      for (const t of pane.tags) labelW = Math.max(labelW, ctx.measureText(t.label).width);
    }
    const showPriceAxis = this.options.priceAxis !== false;
    const showTimeAxis = this.timeAxisHeight > 0;
    const grid = this.options.grid ?? true;
    const axisW = showPriceAxis ? Math.max(56, Math.ceil((labelW + 20) / 6) * 6) : 0;
    if (axisW !== this.axisWidth && retry) {
      this.axisWidth = axisW;
      this.#layout();
      this.#drawBase(false);
      return;
    }

    const W = this.width;
    const H = this.height;
    const plotW = this.plotWidth;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);
    this.#marks = n && (showTimeAxis || grid === true) ? ts.marks.select(this.data, a, b, ts.x0, ts.barSpacing, plotW) : [];

    for (const pane of this.panes) {
      const { y: py, h } = pane.rect;
      ctx.save();
      ctx.translate(0, py);
      ctx.beginPath();
      ctx.rect(0, 0, plotW, h);
      ctx.clip();

      // Grid: horizontal lines at ticks; vertical lines are clear only at major boundaries (dates etc.) and very faint at minor ones.
      ctx.lineWidth = 1;
      for (const major of grid ? [false, true] : []) {
        ctx.beginPath();
        if (major) {
          for (const t of pane.ticks) {
            const Y = Math.round(t.y) + 0.5;
            ctx.moveTo(0, Y);
            ctx.lineTo(plotW, Y);
          }
        }
        for (const m of grid === true ? this.#marks : []) {
          if (m.level >= 50 !== major) continue;
          const X = Math.round(m.x) + 0.5;
          ctx.moveTo(X, 0);
          ctx.lineTo(X, h);
        }
        ctx.strokeStyle = major ? theme.grid : theme.gridMinor;
        ctx.stroke();
      }

      if (n) {
        const views = pane.items.map((item) => (item.visible ? this.#view(ctx, pane, item) : null));
        pane.items.forEach((item, i) => views[i] && item.drawBack(views[i]));
        pane.items.forEach((item, i) => views[i] && item.draw(views[i]));
      }

      // Horizontal line at the last value.
      for (const tag of pane.tags) {
        if (!tag.line || (this.options.priceLine ?? true) !== true) continue;
        const Y = Math.round(tag.rawY) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, Y);
        ctx.lineTo(plotW, Y);
        ctx.strokeStyle = withAlpha(tag.color, 0.55);
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (pane === this.panes[0]) {
        this.#drawPriceLines(ctx, plotW, h);
        this.trades.draw(ctx);
      }
      ctx.restore();

      // Price axis
      if (showPriceAxis) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.textMuted;
        for (const t of pane.ticks) {
          if (t.y < 8 || t.y > h - 8) continue;
          ctx.fillText(t.label, plotW + 9, py + t.y + 0.5);
        }
        // Tick marks
        ctx.fillStyle = theme.axisLine;
        for (const t of pane.ticks) ctx.fillRect(plotW, py + Math.round(t.y), 4, 1);
        ctx.font = `11px ${theme.mono}`;
        for (const tag of pane.tags) if (tag.fixed || this.options.priceLine !== false) this.#drawTag(ctx, plotW, py + tag.y, tag.label, tag.color);
      }

      // Pane separator
      if (pane !== this.panes[0]) {
        ctx.fillStyle = theme.axisLine;
        ctx.fillRect(0, py - 1, W, 1);
      }
    }

    // Axis border lines
    const axisH = this.timeAxisHeight;
    ctx.fillStyle = theme.axisLine;
    if (showPriceAxis) ctx.fillRect(plotW, 0, 1, H - axisH);
    if (!showTimeAxis) return;
    ctx.fillRect(0, H - axisH, W, 1);

    // Time axis
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ty = H - axisH / 2 + 1;
    for (const m of this.#marks) {
      ctx.fillStyle = theme.axisLine;
      ctx.fillRect(Math.round(m.x), H - axisH, 1, m.level >= 50 ? 6 : 4);
      const half = ctx.measureText(m.label).width / 2;
      if (m.x - half < 2 || m.x + half > plotW - 2) continue;
      ctx.fillStyle = m.level >= 50 ? theme.text : theme.textMuted;
      ctx.fillText(m.label, m.x, ty + 1);
    }
  }

  /** Collect the last-value labels for the price axis and nudge them apart so they do not overlap. */
  #collectTags(pane) {
    const tags = [];
    const h = pane.rect.h;
    const main = pane === this.panes[0];
    for (const item of pane.items) {
      if (!item.visible || item.scaleId !== 'right') continue;
      // The main pane shows only the price. Overlay values are readable in the legend, so keep the axis uncluttered.
      if (main && item.kind !== 'series' && !this.options.overlayLabels) continue;
      for (const lv of item.lastValues(this.theme)) {
        const y = pane.scale.y(lv.value);
        if (!(y >= 0 && y <= h)) continue;
        tags.push({ y, rawY: y, label: pane.scale.label(lv.value), color: lv.color, line: lv.line });
      }
    }
    for (const line of main ? this.priceLines : []) {
      const y = pane.scale.y(line.price);
      if (line.axisLabel === false || !(y >= 0 && y <= h)) continue;
      tags.push({ y, rawY: y, label: pane.scale.label(line.price), color: this.#lineColor(line), line: false, fixed: true });
    }
    tags.sort((p, q) => p.y - q.y);
    for (let i = 1; i < tags.length; i++) {
      if (tags[i].y - tags[i - 1].y < 18) tags[i].y = tags[i - 1].y + 18;
    }
    return tags;
  }

  #drawTag(ctx, x, y, label, bg, fg = contrastText(bg)) {
    const w = this.axisWidth;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x + 1, Math.round(y) - 9, w - 3, 18, 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 9, Math.round(y) + 0.5);
  }

  /** @param {boolean} live false leaves out what follows the pointer (crosshair, marker details), for image export */
  #drawOverlay(live = true) {
    const { theme, dpr } = this;
    const ctx = this.#over.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const plotW = this.plotWidth;
    const main = this.panes[0];
    const inMain = (draw) => {
      ctx.save();
      ctx.translate(0, main.rect.y);
      ctx.beginPath();
      ctx.rect(0, 0, plotW, main.rect.h);
      ctx.clip();
      draw();
      ctx.restore();
    };
    if (!this.data.length) return;

    inMain(() => {
      this.drawings.draw(ctx);
      if (live) this.trades.drawHover(ctx);
    });
    if (!live) return;
    // On a trade marker the horizontal line and the axis label show the marker's exact price instead of the pointer's.
    const marker = this.trades.hoverTag();
    this.#drawCrosshair(ctx, !marker);
    if (marker && this.options.priceAxis !== false && marker.y >= 0 && marker.y <= main.rect.h) {
      ctx.font = `11px ${theme.mono}`;
      this.#drawTag(ctx, plotW, main.rect.y + marker.y, marker.label, marker.color);
    }
    if (marker) inMain(() => this.trades.drawTooltip(ctx));
  }

  #drawCrosshair(ctx, horizontal) {
    const theme = this.theme;
    const plotW = this.plotWidth;
    const main = this.panes[0];
    const c = this.crosshair;
    const mode = this.options.crosshair ?? true;
    if (!mode || !c.active || !c.pane) return;
    const ts = this.timeScale;
    const X = Math.round(ts.x(c.index)) + 0.5;
    const bottom = this.height - this.timeAxisHeight;
    const Y = Math.round(c.y) + 0.5;
    horizontal &&= mode === true;
    ctx.beginPath();
    ctx.moveTo(X, 0);
    ctx.lineTo(X, bottom);
    if (horizontal && c.y >= c.pane.rect.y && c.y <= c.pane.rect.y + c.pane.rect.h) {
      ctx.moveTo(0, Y);
      ctx.lineTo(plotW, Y);
    }
    ctx.strokeStyle = theme.crosshair;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (mode === 'vertical' && c.index >= 0 && c.index < this.data.length) {
      // With a vertical-only crosshair, mark where the line meets the series (shows which value is being read).
      const my = main.rect.y + main.scale.y(this.data.close[c.index]);
      ctx.beginPath();
      ctx.arc(X, my, 3.5, 0, 6.2832);
      ctx.fillStyle = theme.bg;
      ctx.fill();
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.font = `11px ${theme.mono}`;
    if (horizontal && this.options.priceAxis !== false) {
      const value = c.pane.scale.value(c.y - c.pane.rect.y);
      this.#drawTag(ctx, plotW, c.y, c.pane.scale.label(value), theme.tagBg, theme.tagText);
    }
    if (!this.timeAxisHeight) return;

    const time = ts.indexToTime(c.index);
    const interval = this.data.interval;
    const label = this.options.formatTime?.(time, { kind: 'crosshair', interval }) ?? formatDateTime(time, this.utcOffset, interval);
    const tw = ctx.measureText(label).width + 16;
    const tx = Math.max(0, Math.min(plotW - tw, X - tw / 2));
    ctx.fillStyle = theme.tagBg;
    ctx.beginPath();
    ctx.roundRect(tx, bottom + 4, tw, 20, 2);
    ctx.fill();
    ctx.fillStyle = theme.tagText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, tx + tw / 2, bottom + 14.5);
  }

  /* ───────────── Import / export ───────────── */

  /** Return the current view as a single canvas (legend text is baked in). */
  toCanvas() {
    this.#flushData();
    this.#drawBase();
    this.#drawOverlay(false);
    const out = document.createElement('canvas');
    out.width = this.#base.width;
    out.height = this.#base.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(this.#base, 0, 0);
    ctx.drawImage(this.#over, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const theme = this.theme;
    const index = this.legendIndex();
    for (const pane of this.panes) {
      let y = pane.rect.y + 16;
      for (const item of pane.items) {
        if (!item.visible) continue;
        let x = 12;
        const put = (text, color, font = `11px ${theme.mono}`) => {
          ctx.font = font;
          ctx.fillStyle = color;
          ctx.fillText(text, x, y);
          x += ctx.measureText(text).width + 8;
        };
        if (item.kind === 'series') {
          put(this.symbol.name, theme.text, `600 13px ${theme.font}`);
          put([t(this.timeframeLabel), item.title].filter(Boolean).join(' · '), theme.textMuted, `11px ${theme.font}`);
        } else {
          put(item.title, theme.textMuted, `11px ${theme.font}`);
        }
        for (const it of item.legend(index, theme)) put((it.k ? it.k + ' ' : '') + it.v, it.color ?? theme.text);
        y += 20;
      }
    }
    this.#drawOverlay();
    return out;
  }

  /** Serialize the type, indicators and drawings. */
  serialize() {
    return {
      type: this.type,
      scaleMode: this.scaleMode,
      indicators: this.indicators.map((i) => i.serialize()),
      drawings: this.drawings.serialize(),
    };
  }

  /** Restore from the result of serialize(). */
  restore(state) {
    if (!state) return;
    for (const ind of [...this.indicators]) this.removeIndicator(ind);
    if (state.type) this.setType(state.type);
    if (state.scaleMode) this.setScaleMode(state.scaleMode);
    for (const s of state.indicators ?? []) {
      if (!indicatorDefs.has(s.id)) continue;
      const ind = this.addIndicator(s.id, s.inputs, s.styles ?? {});
      if (s.visible === false) this.setIndicatorVisible(ind, false);
    }
    if (state.drawings) this.drawings.restore(state.drawings);
  }

  destroy() {
    this.#destroyed = true;
    cancelAnimationFrame(this.#raf);
    this.#resizeObserver.disconnect();
    this.#unwatchPixelRatio?.();
    this.interaction.destroy();
    this.root.remove();
  }
}
