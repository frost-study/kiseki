import { markTypes } from '../core/Registry.js';
import { Figure } from './Figure.js';
import { placeBoxes, placeTickLabels, spreadLabels } from './layout.js';
import { crisp } from './marks.js';
import { makeScale } from './scales.js';

function margins(m) {
  if (typeof m === 'number') return { top: m, right: m, bottom: m, left: m };
  return { top: 0, right: 0, bottom: 0, left: 0, ...m };
}

function defaultFormat(v) {
  return typeof v === 'number' ? String(+v.toPrecision(12)) : String(v);
}

/**
 * Tick entries of one axis: [{ value, label, gridColor }]. `axis.ticks` is a count (default: by the room), or a list of
 * values or `{ value, label, gridColor }`; labels come from `axis.formatTicks(values)` (all at once, so a host can give them
 * one precision) or `axis.format(value)`.
 */
function resolveTicks(axis, scale, room) {
  const given = axis.ticks;
  const raw = Array.isArray(given) ? given : scale.ticks(typeof given === 'number' ? given : Math.max(2, Math.min(8, room)));
  const ticks = raw.map((t) => (t !== null && typeof t === 'object' ? t : { value: t }));
  const labels = axis.formatTicks?.(ticks.map((t) => t.value));
  return ticks.map((t, i) => ({
    ...t,
    label: t.label ?? labels?.[i] ?? (axis.format ?? defaultFormat)(t.value, i),
  }));
}

/**
 * A figure with an x scale, a y scale and marks the host composes (see marks.js): lines, areas, bars, dots, rules, regions,
 * grid cells, text and arrows. Axes and a grid are optional; margins fit the tick labels.
 *
 * `setData(marks)` takes the list of mark specs, drawn in the order given. Options (besides those of every figure):
 *
 * @param {object} [options.x]  the x axis, and the same for `options.y`:
 *   scale     'linear' (default) | 'time' (UNIX ms) | 'band' (categories)
 *   domain    [lo, hi] (a list of keys for a band); default: what the marks use (+ `include`), `nice` rounds it outwards
 *   reverse   flip the direction (a linear y runs up and a linear x to the right by default; a band y lists keys top to bottom)
 *   padding   band scale: the gap between bands as a fraction of a step (default 0.2)
 *   utcOffset time scale: the offset (ms) of the calendar used for ticks
 *   axis      false (default) | { ticks, format, formatTicks, color, textColor, tickSize, gap }
 *               ticks       a count, or a list of values or { value, label, gridColor }
 *               format      (value) => label            formatTicks  (values) => labels, takes priority
 *               tickSize    length of the tick marks (default 4 on x, 0 on y)
 *               gap         least space between x labels (default 10)
 *   grid      false (default) | true | { color, dash } — lines at the ticks
 * @param {number|{top?:number,right?:number,bottom?:number,left?:number}} [options.margin]  least margins (px); axis
 *   labels and end labels (text marks with `at: 'end'`) widen them as needed
 * @param {number} [options.fontSize=11]  size of tick labels
 */
export class CartesianFigure extends Figure {
  static id = 'cartesian';
  static label = 'Cartesian plot';

  /** After a layout: the plot rectangle and the scales (for hosts that place things themselves). */
  plot = null;
  scales = null;

  paint(ctx) {
    this.drawPlot(ctx, (Array.isArray(this.data) ? this.data : this.data?.marks ?? []).filter(Boolean), this.options);
  }

  /** Lay out the axes and draw the marks `specs` with the axis options in `o`. Presets that turn their data into marks call this. */
  drawPlot(ctx, specs, o) {
    const defs = specs.map((spec) => ({ spec, def: markTypes.get(spec.type) }));
    const size = o.fontSize ?? 11;
    const xo = o.x ?? {};
    const yo = o.y ?? {};
    const xa = xo.axis ? { ...xo.axis } : null;
    const ya = yo.axis ? { ...yo.axis } : null;
    const m = margins(o.margin);
    const W = this.width;
    const H = this.height;

    const values = (axis) => defs.flatMap(({ spec, def }) => def.extent?.(spec)?.[axis] ?? []).filter((v) => v !== undefined);
    const xs = values('x');
    const ys = values('y');
    ctx.font = this.font(size);
    const textW = (s) => ctx.measureText(String(s)).width;

    // right: room for end labels
    const ends = specs.filter((s) => s.type === 'text' && s.at === 'end');
    let endRoom = 0;
    for (const s of ends) {
      ctx.font = this.font(s.size ?? size, s.weight);
      endRoom = Math.max(endRoom, textW(s.text) + (s.dx ?? 8) + 6);
    }
    ctx.font = this.font(size);

    const tickSizeX = xa ? xa.tickSize ?? 4 : 0;
    const bottom = Math.max(m.bottom, xa ? tickSizeX + size + 7 : 0);
    const top = m.top;
    const yBand = yo.scale === 'band';
    const yRange = (t, b) => (yBand ? [t, b] : [b, t]);

    // y first: its labels decide the left margin
    let yTicks = [];
    let left = m.left;
    if (ya) {
      const prov = makeScale(yo, ys, yRange(top, H - bottom));
      yTicks = resolveTicks(ya, prov, (H - top - bottom) / 40);
      left = Math.max(left, Math.max(0, ...yTicks.map((t) => textW(t.label))) + (ya.tickSize ?? 0) + 10);
    }
    const right = Math.max(m.right, endRoom);
    const plot = { x: left, y: top, w: Math.max(1, W - left - right), h: Math.max(1, H - top - bottom) };
    const sx = makeScale(xo, xs, [plot.x, plot.x + plot.w]);
    const sy = makeScale(yo, ys, yRange(plot.y, plot.y + plot.h));
    this.plot = plot;
    this.scales = { x: sx, y: sy };

    const env = {
      ctx,
      plot,
      sx,
      sy,
      // a number is a position on a linear or time scale, a key on a band scale; anything that does not fit is NaN
      px: (v) => (sx.type === 'band' ? (sx.has(v) ? sx.pos(v) : NaN) : Number.isFinite(v) ? sx.pos(v) : NaN),
      py: (v) => (sy.type === 'band' ? (sy.has(v) ? sy.pos(v) : NaN) : Number.isFinite(v) ? sy.pos(v) : NaN),
      color: (c) => this.color(c),
      font: (s, w) => this.font(s, w),
      theme: this.theme,
      dpr: this.dpr,
      text: null,
    };

    // grid and axes sit under the marks
    const gridOf = (g, tick) => ({ color: tick.gridColor ?? g?.color ?? 'grid', dash: g?.dash });
    ctx.save();
    ctx.lineWidth = 1;
    if (yo.grid) {
      for (const t of ya ? yTicks : resolveTicks({ ticks: yo.ticks }, sy, plot.h / 40)) {
        const y = crisp(sy.pos(t.value), 1, this.dpr);
        const g = gridOf(yo.grid === true ? null : yo.grid, t);
        ctx.strokeStyle = this.color(g.color);
        ctx.setLineDash(g.dash ?? []);
        ctx.beginPath();
        ctx.moveTo(plot.x, y);
        ctx.lineTo(plot.x + plot.w, y);
        ctx.stroke();
      }
    }
    let xTicks = [];
    if (xa || xo.grid) {
      xTicks = resolveTicks(xa ?? { ticks: xo.ticks }, sx, plot.w / 90);
    }
    if (xo.grid) {
      for (const t of xTicks) {
        const x = crisp(sx.pos(t.value), 1, this.dpr);
        const g = gridOf(xo.grid === true ? null : xo.grid, t);
        ctx.strokeStyle = this.color(g.color);
        ctx.setLineDash(g.dash ?? []);
        ctx.beginPath();
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, plot.y + plot.h);
        ctx.stroke();
      }
    }
    ctx.restore();
    if (ya || xa) this.watchFonts();
    if (ya) {
      ctx.save();
      ctx.font = this.font(size);
      ctx.fillStyle = this.color(ya.textColor ?? 'muted');
      ctx.textAlign = 'right';
      for (const t of yTicks) ctx.fillText(t.label, plot.x - 6 - (ya.tickSize ?? 0), sy.pos(t.value) + size * 0.32);
      ctx.restore();
    }
    if (xa) {
      ctx.save();
      ctx.font = this.font(size);
      const baseY = plot.y + plot.h;
      const items = xTicks.map((t) => ({ ...t, x: sx.pos(t.value), w: textW(t.label) }));
      const kept = placeTickLabels(items, plot.x, plot.x + plot.w + (endRoom ? 0 : right), xa.gap ?? 10);
      ctx.strokeStyle = this.color(xa.color ?? 'axis');
      ctx.lineWidth = 1;
      if (tickSizeX > 0) {
        ctx.beginPath();
        for (const t of kept) {
          const x = crisp(t.x, 1, this.dpr);
          ctx.moveTo(x, baseY);
          ctx.lineTo(x, baseY + tickSizeX);
        }
        ctx.stroke();
      }
      ctx.fillStyle = this.color(xa.textColor ?? 'muted');
      ctx.textAlign = 'left';
      for (const t of kept) ctx.fillText(t.label, t.left, baseY + tickSizeX + size + 1);
      ctx.restore();
    }

    // text marks: where each goes, with end labels kept apart
    const placed = new Map();
    this.#placeText(ctx, specs, env, placed, size);
    env.text = (spec) => placed.get(spec);

    for (const { spec, def } of defs) {
      const geo = def.draw(env, spec);
      if (geo && spec.id !== undefined && spec.id !== null) this.expose({ id: spec.id, datum: spec.datum, type: spec.type, ...geo });
    }
  }

  #placeText(ctx, specs, env, placed, size) {
    const groups = new Map();
    for (const s of specs) {
      if (s.type !== 'text') continue;
      const x = (s.at === 'end' ? env.plot.x + env.plot.w : env.px(s.x)) + (s.dx ?? (s.at === 'end' ? 8 : 0));
      const y = env.py(s.y) + (s.dy ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const at = { x, y };
      placed.set(s, at);
      const g = s.place?.group;
      if (g !== undefined) {
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push({ s, at });
      }
    }
    for (const list of groups.values()) {
      const p = list[0].s.place;
      if (p.mode === 'avoid') {
        const items = list.map(({ s, at }, i) => {
          ctx.font = this.font(s.size ?? size, s.weight);
          // `dx` is the gap to the point here, so the anchor is the point itself
          return { id: i, x: at.x - (s.dx ?? 0), y: at.y, w: ctx.measureText(String(s.text)).width };
        });
        const out = placeBoxes(items, { maxX: p.maxX ?? Infinity, h: p.h ?? 14, gap: p.gap ?? 9, minY: p.minY, maxY: p.maxY });
        list.forEach(({ s, at }, i) => {
          const r = out.get(i);
          at.x = r.x;
          at.y = r.y;
          if (r.side === 'end') at.anchor = 'end'; // hangs to the left of its point
        });
      } else {
        const ys = spreadLabels(list.map(({ at }) => at.y), { gap: p.gap ?? 14, min: p.minY, max: p.maxY });
        list.forEach(({ at }, i) => (at.y = ys[i]));
      }
    }
  }
}
