import { EventEmitter } from '../core/EventEmitter.js';
import { resolveColor, resolveTheme } from '../core/theme.js';
import { hitTest } from './hit.js';

const LAYOUT = 1;
const PAINT = 2;

/**
 * Redraws of every figure on a page share one animation frame, so a page with a hundred small figures costs one callback.
 */
const waiting = new Set();
let raf = 0;
const nextFrame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

function flush() {
  raf = 0;
  const list = [...waiting];
  waiting.clear();
  for (const fig of list) fig._frame();
}

function schedule(fig) {
  waiting.add(fig);
  if (!raf) raf = nextFrame(flush);
}

/**
 * Base of every figure: one canvas inside a container, drawn from `setData` / `setOptions` / `setTheme`.
 *
 * A figure is for charts that are not bar-indexed time series (those are `Chart`): a sparkline, a fan of bands, a bump chart,
 * a donut, a heatmap. Subclasses implement `paint(ctx)` (lay out and draw; return the marks that can be pointed at through
 * `this.expose(mark)`) and are registered in `figureTypes` so hosts can create them by name (see `createFigure`).
 *
 * Size: `options.width` and `options.height` (CSS px) fix the size. A figure with both fixed never observes anything, so a
 * host can create a hundred of them cheaply. A missing one follows the container (a ResizeObserver) — the container must
 * then have a height / width of its own.
 *
 * Drawing is batched into the next frame (`invalidate`), device-pixel-ratio aware, never animated, and the figure never takes
 * the wheel or a touch drag from the page.
 *
 * After each layout `marks` holds the geometry of what was drawn that has an `id` (CSS px relative to the canvas):
 *   { id, kind: 'rect' | 'text' | 'circle' | 'path', x, y, w, h, datum, … }   (see hit.js)
 * and 'layout' is emitted, so a host can put real DOM controls, focus rings and tooltips over the canvas.
 *
 * Events: 'layout' (marks) · 'hover' ({ mark, x, y }; mark is null when the pointer leaves) · 'click' ({ mark, x, y }).
 * The pointer is only listened to once a 'hover' or 'click' handler is added.
 *
 * Options common to all figures:
 * @param {string|object} [options.theme='light']  a theme name or object (see themes), the same as for Chart
 * @param {string|object} [options.scheme='wa']    candle scheme (for the up / down roles)
 * @param {number} [options.width]   fixed width in CSS px
 * @param {number} [options.height]  fixed height in CSS px
 * @param {number} [options.hitSlop=0]  how far from a mark (px) the pointer still counts as on it
 * @param {{active?: object, selected?: object}} [options.emphasis]  look of setActive / setSelected: { color, width }
 */
export class Figure extends EventEmitter {
  static id = 'figure';

  /** @type {HTMLElement} */
  root;
  /** @type {HTMLCanvasElement} */
  canvas;
  /** The marks that can be pointed at, after the last layout. */
  marks = [];
  width = 0;
  height = 0;
  dpr = 1;
  data = null;

  #dirty = LAYOUT | PAINT;
  #queued = false;
  #destroyed = false;
  #observer = null;
  #byId = new Map();
  #active = null;
  #selected = null;
  #listening = false;
  #hover = null;
  #fontWatch = false;
  #off = [];

  constructor(container, options = {}) {
    super();
    this.options = { theme: 'light', scheme: 'wa', hitSlop: 0, ...options };
    this.theme = resolveTheme(this.options.theme, this.options.scheme);
    const fixedW = Number.isFinite(options.width) && options.width > 0;
    const fixedH = Number.isFinite(options.height) && options.height > 0;
    this.root = document.createElement('div');
    this.root.style.cssText = `position:relative;display:block;overflow:visible;width:${fixedW ? options.width + 'px' : '100%'};height:${fixedH ? options.height + 'px' : '100%'}`;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;display:block;touch-action:auto';
    this.root.append(this.canvas);
    container.append(this.root);
    this.ctx = this.canvas.getContext('2d');
    this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (fixedW && fixedH) {
      this.#resize(options.width, options.height);
    } else {
      this.#measure();
      if (typeof ResizeObserver === 'function') {
        this.#observer = new ResizeObserver(() => this.#measure());
        this.#observer.observe(this.root);
      }
    }
  }

  /* ───────────── Host API ───────────── */

  /** Replace what the figure shows. The meaning of `data` belongs to the subclass. */
  setData(data) {
    this.data = data;
    this.invalidate('layout');
  }

  /** Merge options (shallowly) and lay out again. */
  setOptions(patch) {
    this.options = { ...this.options, ...patch };
    if ('width' in patch || 'height' in patch) this.#applyFixedSize();
    this.invalidate('layout');
  }

  setTheme(theme, scheme = this.options.scheme) {
    this.options = { ...this.options, theme, scheme };
    this.theme = resolveTheme(theme, scheme);
    this.invalidate('layout');
  }

  /** The mark with this id, or null. */
  markById(id) {
    return this.#byId.get(id) ?? null;
  }

  /** The mark under a point (CSS px relative to the canvas), or null. */
  markAt(x, y) {
    return hitTest(this.marks, x, y, this.options.hitSlop);
  }

  /** Emphasis for keyboard focus: a ring (or a halo behind a line) on the mark. `null` clears it. */
  setActive(id) {
    if (id === this.#active) return;
    this.#active = id;
    this.invalidate('paint');
  }

  /** Emphasis for the selected mark. `null` clears it. */
  setSelected(id) {
    if (id === this.#selected) return;
    this.#selected = id;
    this.invalidate('paint');
  }

  get active() {
    return this.#active;
  }

  get selected() {
    return this.#selected;
  }

  /** Schedule a redraw. what: 'layout' (default) | 'paint' (nothing but the look changed). */
  invalidate(what = 'layout') {
    this.#dirty |= what === 'paint' ? PAINT : LAYOUT | PAINT;
    if (!this.#queued && !this.#destroyed) {
      this.#queued = true;
      schedule(this);
    }
  }

  /** Draw right now instead of waiting for the frame (tests; reading `marks` straight after `setData`). */
  renderNow() {
    waiting.delete(this);
    this._frame();
  }

  /** The figure as one canvas (for export). */
  toCanvas() {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(this.width * this.dpr));
    out.height = Math.max(1, Math.round(this.height * this.dpr));
    const ctx = out.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.#render(ctx, false);
    return out;
  }

  destroy() {
    this.#destroyed = true;
    waiting.delete(this);
    this.#observer?.disconnect();
    for (const off of this.#off) off();
    this.#off = [];
    this.root.remove();
  }

  /** Listen to the pointer only when someone wants 'hover' or 'click'. */
  on(type, fn) {
    if ((type === 'hover' || type === 'click') && !this.#listening) this.#listen();
    return super.on(type, fn);
  }

  /* ───────────── For subclasses ───────────── */

  /** Lay out and draw into `ctx` (CSS px; the transform is set). Call `this.expose(geometry)` for every mark that can be pointed at. */
  paint() {}

  /** Expose the geometry of a mark that has an id. */
  expose(geometry) {
    if (geometry?.id === undefined || geometry.id === null) return;
    this.marks.push(geometry);
    this.#byId.set(geometry.id, geometry);
  }

  /** `ctx.font` for this theme. */
  font(size = 11, weight = 400) {
    return `${weight} ${size}px ${this.theme.font}`;
  }

  /** CSS color for a color spec (a CSS color, a palette index or a role name). */
  color(c) {
    return resolveColor(this.theme, c);
  }

  /** Call from `paint` when text was drawn: a web font that is still loading redraws the figure once it arrives. */
  watchFonts() {
    if (this.#fontWatch || typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded') return;
    this.#fontWatch = true;
    document.fonts.ready.then(() => {
      this.#fontWatch = false;
      this.invalidate('layout');
    });
  }

  /**
   * Draw the emphasis of one mark. The default draws a ring around a box or circle, and a halo behind a line.
   * @param {'active'|'selected'} state
   */
  paintEmphasis(ctx, mark, state) {
    const look = { color: state === 'active' ? this.theme.accent : this.theme.text, width: state === 'active' ? 2 : 1.5, ...this.options.emphasis?.[state] };
    ctx.save();
    ctx.strokeStyle = this.color(look.color);
    ctx.lineWidth = look.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (mark.kind === 'path') {
      // behind everything already drawn, so the line itself stays on top
      ctx.globalCompositeOperation = 'destination-over';
      ctx.lineWidth = (mark.width ?? 1.5) + look.width * 2 + 2;
      ctx.beginPath();
      for (const run of mark.runs) {
        run.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (run.length === 1) ctx.lineTo(run[0].x + 0.01, run[0].y);
      }
      ctx.stroke();
    } else if (mark.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(mark.cx, mark.cy, mark.r + 2 + look.width / 2, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const pad = 1 + look.width / 2;
      ctx.strokeRect(mark.x - pad, mark.y - pad, mark.w + 2 * pad, mark.h + 2 * pad);
    }
    ctx.restore();
  }

  /* ───────────── Internals ───────────── */

  _frame() {
    this.#queued = false;
    if (this.#destroyed) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.#size();
      this.#dirty |= LAYOUT | PAINT;
    }
    if (!this.width || !this.height) return;
    const layout = this.#dirty & LAYOUT;
    this.#dirty = 0;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.#render(ctx, true);
    if (layout) this.emit('layout', this.marks);
  }

  #render(ctx, expose) {
    const keep = this.marks;
    const keepIds = this.#byId;
    this.marks = [];
    this.#byId = new Map();
    this.paint(ctx);
    const ownIds = this.#byId;
    for (const [id, state] of [[this.#selected, 'selected'], [this.#active, 'active']]) {
      const mark = id === null ? null : ownIds.get(id);
      if (mark) this.paintEmphasis(ctx, mark, state);
    }
    if (!expose) {
      this.marks = keep;
      this.#byId = keepIds;
    }
  }

  #applyFixedSize() {
    const { width, height } = this.options;
    if (Number.isFinite(width) && width > 0) this.root.style.width = `${width}px`;
    if (Number.isFinite(height) && height > 0) this.root.style.height = `${height}px`;
    this.#measure();
  }

  #measure() {
    const { width, height } = this.options;
    const fixedW = Number.isFinite(width) && width > 0;
    const fixedH = Number.isFinite(height) && height > 0;
    const rect = fixedW && fixedH ? null : this.root.getBoundingClientRect();
    this.#resize(fixedW ? width : Math.floor(rect.width), fixedH ? height : Math.floor(rect.height));
  }

  #resize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.#size();
    this.invalidate('layout');
  }

  #size() {
    const c = this.canvas;
    c.width = Math.max(1, Math.round(this.width * this.dpr));
    c.height = Math.max(1, Math.round(this.height * this.dpr));
    c.style.width = `${this.width}px`;
    c.style.height = `${this.height}px`;
  }

  #listen() {
    this.#listening = true;
    const point = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const move = (e) => {
      const { x, y } = point(e);
      const mark = this.markAt(x, y);
      this.canvas.style.cursor = mark ? 'pointer' : '';
      if ((mark?.id ?? null) === (this.#hover?.id ?? null)) return;
      this.#hover = mark;
      this.emit('hover', { mark, x, y });
    };
    const leave = () => {
      this.canvas.style.cursor = '';
      if (this.#hover === null) return;
      this.#hover = null;
      this.emit('hover', { mark: null, x: -1, y: -1 });
    };
    const click = (e) => {
      const { x, y } = point(e);
      this.emit('click', { mark: this.markAt(x, y), x, y });
    };
    const events = [['pointermove', move], ['pointerleave', leave], ['click', click]];
    for (const [type, fn] of events) {
      this.canvas.addEventListener(type, fn, { passive: true });
      this.#off.push(() => this.canvas.removeEventListener(type, fn));
    }
  }
}
