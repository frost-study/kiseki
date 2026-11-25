import { drawingTools } from '../core/Registry.js';

let uid = 0;
const HANDLE = 4.5;

/**
 * Manages drawings (trend lines etc.).
 *
 * Points are stored as { t: time (ms), p: price }. Because they are stored by time, not index,
 * they stay in place across timeframe switches. They can also sit in the future, right of the data.
 */
export class DrawingManager {
  constructor(chart) {
    this.chart = chart;
    /** @type {{id:string, tool:string, points:{t:number,p:number}[], color:string|null}[]} */
    this.items = [];
    this.tool = null;
    this.magnet = false;
    this.selected = null;
    this.hover = null;
    this.#draft = null;
    this.#drag = null;
  }

  #draft;
  #drag;

  get pane() {
    return this.chart.panes[0];
  }

  get busy() {
    return !!(this.#draft || this.#drag);
  }

  setTool(id) {
    this.tool = id && drawingTools.has(id) ? id : null;
    this.#draft = null;
    if (this.tool) this.select(null);
    this.chart.emit('tool', this.tool);
    this.chart.invalidate('overlay');
  }

  select(item) {
    if (this.selected === item) return;
    this.selected = item;
    this.chart.emit('drawing:select', item);
    this.chart.invalidate('overlay');
  }

  remove(item) {
    const i = this.items.indexOf(item);
    if (i < 0) return;
    this.items.splice(i, 1);
    if (this.selected === item) this.select(null);
    if (this.hover === item) this.hover = null;
    this.#changed();
  }

  clear() {
    this.items = [];
    this.select(null);
    this.hover = null;
    this.#changed();
  }

  setColor(item, color) {
    item.color = color;
    this.#changed();
  }

  #changed() {
    this.chart.emit('drawings', this.items);
    this.chart.invalidate('overlay');
  }

  toPx(pt) {
    const ts = this.chart.timeScale;
    return { x: ts.x(ts.timeToIndex(pt.t)), y: this.pane.scale.y(pt.p) };
  }

  /** Screen coordinates → point. x snaps to the bar center; with the magnet on, the price snaps to OHLC as well. */
  fromPx(x, y) {
    const { timeScale: ts, data } = this.chart;
    const scale = this.pane.scale;
    const index = Math.round(ts.indexAt(x));
    let p = scale.value(y);
    if (this.magnet && index >= 0 && index < data.length) {
      let best = 14;
      for (const c of [data.open[index], data.high[index], data.low[index], data.close[index]]) {
        const d = Math.abs(scale.y(c) - y);
        if (d < best) {
          best = d;
          p = c;
        }
      }
    }
    return { t: ts.indexToTime(index), p };
  }

  #env(item, selected) {
    const chart = this.chart;
    const ts = chart.timeScale;
    const pane = this.pane;
    return {
      theme: chart.theme,
      color: item.color ?? chart.theme.annotation,
      width: pane.rect.w,
      height: pane.rect.h,
      anchors: item.points,
      indices: item.points.map((pt) => ts.timeToIndex(pt.t)),
      selected,
      precision: chart.main.precision,
      formatPrice: (v) => chart.main.format(v),
    };
  }

  /** Find the drawing at (x, y). Handles of the selected drawing take priority. */
  hitTest(x, y) {
    const sel = this.selected;
    if (sel) {
      const px = sel.points.map((pt) => this.toPx(pt));
      for (let k = 0; k < px.length; k++) {
        if (Math.hypot(px[k].x - x, px[k].y - y) <= HANDLE + 4) return { item: sel, handle: k };
      }
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      const def = drawingTools.get(item.tool);
      const px = item.points.map((pt) => this.toPx(pt));
      if (def.hit(px, x, y, this.#env(item, false))) return { item, handle: -1 };
    }
    return null;
  }

  /** Pointer down. Returns true when handled (which stops the chart from panning). */
  down(x, y) {
    if (this.tool) {
      const def = drawingTools.get(this.tool);
      const pt = this.fromPx(x, y);
      if (!this.#draft) this.#draft = { tool: this.tool, def, points: [pt], cursor: pt, sx: x, sy: y };
      else this.#draft.points.push(pt);
      if (this.#draft.points.length >= def.points) this.#commit();
      else this.chart.invalidate('overlay');
      return true;
    }
    const hit = this.hitTest(x, y);
    if (hit) {
      this.select(hit.item);
      this.#drag = { item: hit.item, handle: hit.handle, sx: x, sy: y, orig: hit.item.points.map((pt) => this.toPx(pt)), moved: false };
      return true;
    }
    this.select(null);
    return false;
  }

  /** Pointer move. Returns true while drawing or dragging. */
  move(x, y) {
    if (this.#draft) {
      this.#draft.cursor = this.fromPx(x, y);
      this.chart.invalidate('overlay');
      return true;
    }
    const drag = this.#drag;
    if (drag) {
      const dx = x - drag.sx;
      const dy = y - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return true;
      drag.moved = true;
      const pts = drag.item.points;
      for (let k = 0; k < pts.length; k++) {
        if (drag.handle >= 0 && drag.handle !== k) continue;
        pts[k] = this.fromPx(drag.orig[k].x + dx, drag.orig[k].y + dy);
      }
      this.chart.invalidate('overlay');
      return true;
    }
    const hover = this.hitTest(x, y)?.item ?? null;
    if (hover !== this.hover) {
      this.hover = hover;
      this.chart.invalidate('overlay');
    }
    return false;
  }

  up(x, y) {
    const draft = this.#draft;
    if (draft && draft.points.length === 1 && draft.def.points === 2 && Math.hypot(x - draft.sx, y - draft.sy) > 6) {
      // also supports press–drag–release drawing
      draft.points.push(this.fromPx(x, y));
      this.#commit();
    }
    if (this.#drag) {
      const moved = this.#drag.moved;
      this.#drag = null;
      if (moved) this.#changed();
    }
  }

  /** Cancel drawing. Returns true if there was something to cancel. */
  cancel() {
    if (this.#draft || this.tool) {
      this.setTool(null);
      return true;
    }
    if (this.selected) {
      this.select(null);
      return true;
    }
    return false;
  }

  #commit() {
    const draft = this.#draft;
    this.#draft = null;
    const item = { id: `d${++uid}`, tool: draft.tool, points: draft.points, color: null };
    this.items.push(item);
    this.tool = null;
    this.chart.emit('tool', null);
    this.select(item);
    this.#changed();
  }

  /** Draw onto the overlay (ctx has its origin at the main pane's top-left and is already clipped). */
  draw(ctx) {
    const theme = this.chart.theme;
    ctx.font = `11px ${theme.mono}`;
    const paint = (item, px, active) => {
      const env = this.#env(item, active);
      const def = drawingTools.get(item.tool);
      ctx.strokeStyle = env.color;
      ctx.fillStyle = env.color;
      ctx.lineWidth = active ? 1.75 : 1.25;
      ctx.lineJoin = 'round';
      if (px.length >= def.points) {
        def.draw(ctx, px, env);
      } else if (px.length > 1) {
        ctx.beginPath();
        ctx.moveTo(px[0].x, px[0].y);
        for (let k = 1; k < px.length; k++) ctx.lineTo(px[k].x, px[k].y);
        ctx.stroke();
      }
      if (active) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = env.color;
        ctx.fillStyle = theme.bg;
        for (const pt of px) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, HANDLE, 0, 6.2832);
          ctx.fill();
          ctx.stroke();
        }
      }
    };
    for (const item of this.items) {
      paint(item, item.points.map((pt) => this.toPx(pt)), item === this.selected || item === this.hover);
    }
    const draft = this.#draft;
    if (draft) {
      const pts = [...draft.points, draft.cursor];
      // include the provisional point so env.anchors has one entry per point
      paint({ tool: draft.tool, points: pts, color: null }, pts.map((pt) => this.toPx(pt)), true);
    }
  }

  serialize() {
    return this.items.map((it) => ({ tool: it.tool, points: it.points.map((p) => ({ t: p.t, p: p.p })), color: it.color }));
  }

  restore(list = []) {
    this.items = list
      .filter((it) => drawingTools.has(it.tool) && Array.isArray(it.points))
      .map((it) => ({ id: `d${++uid}`, tool: it.tool, points: it.points.map((p) => ({ t: p.t, p: p.p })), color: it.color ?? null }));
    this.select(null);
    this.hover = null;
    this.#draft = null;
    this.#drag = null;
    this.#changed();
  }
}
