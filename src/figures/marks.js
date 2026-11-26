import { markTypes } from '../core/Registry.js';
import { ellipsize } from './layout.js';

/**
 * The marks a cartesian figure draws (`CartesianFigure`). Each is registered in `markTypes`, so a host can add its own:
 *
 *   markTypes.register({
 *     id: 'tick',
 *     extent(spec) { return { x: [spec.x], y: [spec.y] }; },   // values this mark places on each axis (optional)
 *     draw(env, spec) { … return geometry or undefined; },     // env: see below
 *   });
 *
 * `env` has: ctx · plot {x, y, w, h} · sx, sy (the scales) · px(v) / py(v) (value → px; a band gives its centre) · color(c)
 * (a CSS color, a palette index or a role name → CSS color) · font(size, weight) · text(spec) (the placed position of a
 * text mark, see `place`) · theme · dpr.
 *
 * Every mark takes: `color`, `opacity` (0–1), `dash` ([on, off, …]), `width` and an optional `id` and `datum`. A mark
 * with an `id` is exposed in `figure.marks` for hit testing; `datum` travels with it untouched.
 *
 * Points (line, area) are `{ x, y }` objects or `[x, y]` pairs; `null` (or a non-finite y) in a line breaks it.
 */

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function xy(p) {
  return Array.isArray(p) ? { x: p[0], y: p[1] } : p;
}

/** Split points into runs of valid ones, in px. A null or a point that cannot be placed ends the run. */
function runsOf(env, points) {
  const runs = [];
  let run = [];
  for (const raw of points ?? []) {
    const p = raw === null || raw === undefined ? null : xy(raw);
    const x = p ? env.px(p.x) : NaN;
    const y = p ? env.py(p.y) : NaN;
    if (finite(x) && finite(y)) {
      run.push({ x, y });
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

function bounds(points, pad = 0) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

function style(env, spec, fallback) {
  const { ctx } = env;
  ctx.globalAlpha = spec.opacity ?? 1;
  ctx.lineWidth = spec.width ?? 1;
  if (spec.dash) ctx.setLineDash(spec.dash);
  return env.color(spec.color ?? fallback);
}

function tracePath(ctx, run, step) {
  run.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else if (step) {
      ctx.lineTo(p.x, run[i - 1].y);
      ctx.lineTo(p.x, p.y);
    } else ctx.lineTo(p.x, p.y);
  });
}

/** Where the physical pixel grid is, for hairlines: a 1px line centred on a device pixel. */
function crisp(v, width, dpr) {
  if (width * dpr > 1.5) return v;
  return (Math.floor(v * dpr) + 0.5) / dpr;
}

/**
 * Opacity of each segment of a faded line: from `from` (the first segment) rising evenly to `to` (the last). A line of one
 * segment gets `to`. Pure.
 */
export function fadeOpacities(count, { from = 0.15, to = 0.9 } = {}) {
  return Array.from({ length: count }, (_, i) => (count > 1 ? from + (i / (count - 1)) * (to - from) : to));
}

/**
 * line: { points, color, width = 1.5, dash, opacity, curve: 'linear' | 'step', pointRadius, halo: { color, width }, hit,
 *         fade: { from = 0.15, to = 0.9 }, vertices: { r = 2 } }
 * A run of one point is drawn as a dot of `pointRadius` (default: the line width). `hit` is the width of the zone that counts
 * as on the line for pointing (default 14).
 * `fade` draws every segment on its own with an opacity that rises from `from` at the first one to `to` at the last (a
 * trail that shows which way it went); it multiplies `opacity`, and it ignores `dash` and `curve`. `vertices` puts a dot of
 * radius `r` on every point but the last of each run, with the opacity of the segment that starts there.
 */
const line = {
  id: 'line',
  extent: (s) => ({ x: (s.points ?? []).map((p) => (p ? xy(p).x : null)), y: (s.points ?? []).map((p) => (p ? xy(p).y : null)) }),
  draw(env, s) {
    const { ctx } = env;
    const runs = runsOf(env, s.points);
    if (!runs.length) return;
    const width = s.width ?? 1.5;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const paint = (color, w, dashed) => {
      ctx.beginPath();
      for (const run of runs) if (run.length > 1) tracePath(ctx, run, s.curve === 'step');
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.setLineDash(dashed && s.dash ? s.dash : []);
      ctx.stroke();
      ctx.fillStyle = color;
      for (const run of runs) {
        if (run.length !== 1) continue;
        ctx.beginPath();
        ctx.arc(run[0].x, run[0].y, s.pointRadius ?? (w + 0) / 2 + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    ctx.globalAlpha = s.opacity ?? 1;
    if (s.halo) paint(env.color(s.halo.color), s.halo.width ?? width + 3, false);
    if (s.fade) {
      const color = env.color(s.color ?? 'series');
      const base = s.opacity ?? 1;
      const segs = runs.reduce((n, run) => n + Math.max(0, run.length - 1), 0);
      const alphas = fadeOpacities(segs, s.fade);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash([]);
      let k = 0;
      for (const run of runs) {
        for (let i = 1; i < run.length; i++, k++) {
          ctx.globalAlpha = base * alphas[k];
          ctx.beginPath();
          ctx.moveTo(run[i - 1].x, run[i - 1].y);
          ctx.lineTo(run[i].x, run[i].y);
          ctx.stroke();
        }
      }
      if (s.vertices) {
        k = 0;
        for (const run of runs) {
          for (let i = 0; i < run.length - 1; i++, k++) {
            ctx.globalAlpha = base * (alphas[k] ?? s.fade.to ?? 0.9);
            ctx.beginPath();
            ctx.arc(run[i].x, run[i].y, s.vertices.r ?? 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    } else paint(env.color(s.color ?? 'series'), width, true);
    ctx.restore();
    const tol = Math.max(width, s.hit ?? 14) / 2;
    return { kind: 'path', runs, width, tol, ...bounds(runs.flat(), tol) };
  },
};

/**
 * area: { points: [{ x, y0, y1 }], color, opacity, curve } — filled between y0 and y1 (y0 defaults to 0).
 * A point without a value ends the shape and starts the next one.
 */
const area = {
  id: 'area',
  extent: (s) => ({
    x: (s.points ?? []).map((p) => p?.x),
    y: (s.points ?? []).flatMap((p) => (p ? [p.y0 ?? 0, p.y1] : [])),
  }),
  draw(env, s) {
    const { ctx } = env;
    const tops = [];
    const bottoms = [];
    let top = [];
    let bot = [];
    for (const p of s.points ?? []) {
      const x = p ? env.px(p.x) : NaN;
      const y1 = p ? env.py(p.y1) : NaN;
      const y0 = p ? env.py(p.y0 ?? 0) : NaN;
      if (finite(x) && finite(y1) && finite(y0)) {
        top.push({ x, y: y1 });
        bot.push({ x, y: y0 });
      } else if (top.length) {
        tops.push(top);
        bottoms.push(bot);
        top = [];
        bot = [];
      }
    }
    if (top.length) {
      tops.push(top);
      bottoms.push(bot);
    }
    if (!tops.length) return;
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.fillStyle = env.color(s.color ?? 'series');
    ctx.beginPath();
    tops.forEach((t, k) => {
      tracePath(ctx, t, s.curve === 'step');
      const b = [...bottoms[k]].reverse();
      b.forEach((p, i) => {
        if (s.curve === 'step' && i > 0) ctx.lineTo(p.x, b[i - 1].y);
        ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
    });
    ctx.fill();
    ctx.restore();
    return { kind: 'rect', ...bounds([...tops.flat(), ...bottoms.flat()]) };
  },
};

/**
 * bar: { x, from, to, size, ratio, orientation: 'v' | 'h', color, opacity, minLength, stroke, strokeWidth, radius }
 * 'v' (default): `x` is the position on the x scale and the bar runs from value `from` (default 0) to `to` on the y scale.
 * 'h': `x` names the position on the y scale (usually a band) and the bar runs from `from` to `to` on the x scale.
 * Thickness: a band scale gives `ratio` (default 1) of the band (the band scale's `padding` makes the gaps), any other scale `size` px (default 6).
 * `minLength` keeps a bar of nearly zero length visible. For stacked or diverging bars give each segment its own
 * `from` and `to` (see `stackValues`).
 * `pattern: { color, angle = 135, width = 1.5, period = 5 }` hatches the bar over its fill (`color: null` for hatching alone): stripes
 * of `color`, `width` px thick every `period` px, the way `repeating-linear-gradient(angle, color 0 width, transparent width period)`
 * would paint the box (`angle` is the direction of the gradient in degrees clockwise from up, so 135 gives stripes running up to
 * the right). `strokeInside` draws the outline inside the bar's edge instead of centred on it, so the bar keeps its size.
 */
const bar = {
  id: 'bar',
  extent(s) {
    const v = [s.from ?? 0, s.to];
    return s.orientation === 'h' ? { y: [s.x], x: v } : { x: [s.x], y: v };
  },
  draw(env, s) {
    const { ctx } = env;
    const horizontal = s.orientation === 'h';
    const along = horizontal ? env.sy : env.sx;
    const value = horizontal ? env.px : env.py;
    const c = along.bandwidth ? along.scale(s.x) + (along.bandwidth * (1 - (s.ratio ?? 1))) / 2 : along.pos(s.x) - (s.size ?? 6) / 2;
    const t = along.bandwidth ? along.bandwidth * (s.ratio ?? 1) : (s.size ?? 6);
    const a = value(s.from ?? 0);
    const b = value(s.to);
    if (![a, b, c, t].every(finite)) return;
    let lo = Math.min(a, b);
    let len = Math.abs(b - a);
    if (s.minLength && len < s.minLength) {
      lo -= (s.minLength - len) / 2;
      len = s.minLength;
    }
    const box = horizontal ? { x: lo, y: c, w: len, h: t } : { x: c, y: lo, w: t, h: len };
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.beginPath();
    if (s.radius && ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, s.radius);
    else ctx.rect(box.x, box.y, box.w, box.h);
    if (s.color !== null) {
      ctx.fillStyle = env.color(s.color ?? 0);
      ctx.fill();
    }
    if (s.pattern) {
      ctx.save();
      ctx.clip();
      hatch(ctx, box, env.color(s.pattern.color ?? s.color ?? 0), s.pattern);
      ctx.restore();
    }
    if (s.stroke !== undefined && s.stroke !== null) {
      ctx.strokeStyle = env.color(s.stroke);
      const lw = s.strokeWidth ?? 1;
      ctx.lineWidth = lw;
      if (s.strokeInside) {
        // the same outline, one stroke-width smaller on every side, so its outer edge is the bar's
        ctx.beginPath();
        const r = s.radius;
        const inner = { x: box.x + lw / 2, y: box.y + lw / 2, w: Math.max(0, box.w - lw), h: Math.max(0, box.h - lw) };
        if (r && ctx.roundRect) ctx.roundRect(inner.x, inner.y, inner.w, inner.h, shrinkRadius(r, lw / 2));
        else ctx.rect(inner.x, inner.y, inner.w, inner.h);
      }
      ctx.stroke();
    }
    ctx.restore();
    return { kind: 'rect', ...box };
  },
};

/** A corner radius (a number, or a list as `roundRect` takes) made `d` px smaller. Pure. */
export function shrinkRadius(r, d) {
  return Array.isArray(r) ? r.map((v) => Math.max(0, v - d)) : Math.max(0, r - d);
}

/**
 * The stripes of a hatched box (see `bar`): `{ color, angle = 135, width = 1.5, period = 5 }`. Stripe k covers the distance
 * [k·period, k·period + width) along the gradient line, which runs at `angle` (CSS degrees) through the middle of the box and is as
 * long as the box is along it. Draws into whatever clip the caller set.
 */
export function hatch(ctx, box, color, { angle = 135, width = 1.5, period = 5 } = {}) {
  if (!(period > 0) || !(width > 0)) return;
  const a = (angle * Math.PI) / 180;
  const d = { x: Math.sin(a), y: -Math.cos(a) };
  const n = { x: -d.y, y: d.x };
  const len = Math.abs(box.w * d.x) + Math.abs(box.h * d.y);
  const mid = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const start = { x: mid.x - (d.x * len) / 2, y: mid.y - (d.y * len) / 2 };
  const reach = Math.hypot(box.w, box.h);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let k = 0; k * period < len; k++) {
    const t = k * period + width / 2;
    const c = { x: start.x + d.x * t, y: start.y + d.y * t };
    ctx.moveTo(c.x - n.x * reach, c.y - n.y * reach);
    ctx.lineTo(c.x + n.x * reach, c.y + n.y * reach);
  }
  ctx.stroke();
}

/** dot: { x, y, r = 3, color, stroke, strokeWidth, strokeDash, opacity } — a filled circle with an optional, optionally dashed, outline in `stroke` (`color: null` leaves it unfilled). */
const dot = {
  id: 'dot',
  extent: (s) => ({ x: [s.x], y: [s.y] }),
  draw(env, s) {
    const { ctx } = env;
    const cx = env.px(s.x);
    const cy = env.py(s.y);
    if (!finite(cx) || !finite(cy)) return;
    const r = s.r ?? 3;
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (s.color !== null) {
      ctx.fillStyle = env.color(s.color ?? 'series');
      ctx.fill();
    }
    if (s.stroke !== undefined && s.stroke !== null) {
      ctx.strokeStyle = env.color(s.stroke);
      ctx.lineWidth = s.strokeWidth ?? 1;
      if (s.strokeDash) ctx.setLineDash(s.strokeDash);
      ctx.stroke();
    }
    ctx.restore();
    return { kind: 'circle', cx, cy, r, x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
  },
};

/**
 * rule: { y } or { x }, optional { from, to } along the other axis (default: the whole plot), color, width = 1, dash, opacity.
 * Its value takes part in the domain unless `extent: false`.
 */
const rule = {
  id: 'rule',
  extent: (s) => (s.extent === false ? {} : s.y !== undefined ? { y: [s.y] } : { x: [s.x] }),
  draw(env, s) {
    const { ctx, plot } = env;
    const width = s.width ?? 1;
    let x0;
    let y0;
    let x1;
    let y1;
    if (s.y !== undefined) {
      y0 = y1 = crisp(env.py(s.y), width, env.dpr);
      x0 = s.from === undefined ? plot.x : env.px(s.from);
      x1 = s.to === undefined ? plot.x + plot.w : env.px(s.to);
    } else {
      x0 = x1 = crisp(env.px(s.x), width, env.dpr);
      y0 = s.from === undefined ? plot.y + plot.h : env.py(s.from);
      y1 = s.to === undefined ? plot.y : env.py(s.to);
    }
    if (![x0, y0, x1, y1].every(finite)) return;
    ctx.save();
    ctx.strokeStyle = style(env, { ...s, width }, 'grid');
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
    return { kind: 'rect', x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  },
};

/**
 * region: { x0, x1, y0, y1, color, opacity, stroke, strokeWidth, strokeDash, label } — a shaded span; a missing bound runs to
 * the edge of the plot. `stroke` outlines it (inside its edge, so neighbouring regions do not overlap); `color: null` leaves it
 * unfilled.
 * `label: { corner: 'tl' | 'tr' | 'bl' | 'br', lines: [{ text, size = 11, weight, color }], dx = 10, dy = 18, lineHeight = 14 }`
 * prints words in a corner of the region (a quadrant's name with a gloss under it). `dx` is the distance from the side; at the
 * top `dy` is the distance from the top edge to the first baseline, at the bottom the distance from the bottom edge to the last.
 */
const region = {
  id: 'region',
  extent: (s) => (s.extent === false ? {} : { x: [s.x0, s.x1], y: [s.y0, s.y1] }),
  draw(env, s) {
    const { ctx, plot } = env;
    const a = s.x0 === undefined ? plot.x : env.px(s.x0);
    const b = s.x1 === undefined ? plot.x + plot.w : env.px(s.x1);
    const c = s.y0 === undefined ? plot.y + plot.h : env.py(s.y0);
    const d = s.y1 === undefined ? plot.y : env.py(s.y1);
    if (![a, b, c, d].every(finite)) return;
    const box = { x: Math.min(a, b), y: Math.min(c, d), w: Math.abs(b - a), h: Math.abs(d - c) };
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.fillStyle = env.color(s.color ?? 'muted');
    if (s.color !== null) ctx.fillRect(box.x, box.y, box.w, box.h);
    if (s.stroke !== undefined && s.stroke !== null) {
      const lw = s.strokeWidth ?? 1;
      ctx.strokeStyle = env.color(s.stroke);
      ctx.lineWidth = lw;
      ctx.setLineDash(s.strokeDash ?? []);
      ctx.strokeRect(box.x + lw / 2, box.y + lw / 2, Math.max(0, box.w - lw), Math.max(0, box.h - lw));
    }
    if (s.label) cornerLabel(env, box, s.label);
    ctx.restore();
    return { kind: 'rect', ...box };
  },
};

/** The words of a region's `label` (see `region`). */
function cornerLabel(env, box, label) {
  const { ctx } = env;
  const lines = label.lines ?? [];
  const dx = label.dx ?? 10;
  const dy = label.dy ?? 18;
  const lh = label.lineHeight ?? 14;
  const corner = label.corner ?? 'tl';
  const right = corner[1] === 'r';
  const bottom = corner[0] === 'b';
  ctx.textAlign = right ? 'right' : 'left';
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  lines.forEach((l, i) => {
    ctx.font = env.font(l.size ?? 11, l.weight);
    ctx.fillStyle = env.color(l.color ?? 'text');
    const y = bottom ? box.y + box.h - dy - (lines.length - 1 - i) * lh : box.y + dy + i * lh;
    ctx.fillText(String(l.text), right ? box.x + box.w - dx : box.x + dx, y);
  });
}

/**
 * cell: { x, y, color, opacity, inset = 1, radius, stroke, strokeWidth = 1, strokeDash, shade, label }
 * One cell of a grid: `x` and `y` are keys of band scales. `inset` px are left free on every side. `stroke` outlines the cell inside
 * its edge (`strokeDash` for a dashed one, `color: null` leaves it unfilled); `shade` (0–1) lays a black veil over it (a pointer
 * resting on it).
 * `label: { text, color, size = 11, weight, align = 'center', pad = 2, ellipsis }` prints words in the cell: centred, or from the
 * `'start'` or `'end'` edge `pad` px in (a negative `pad` lets the word overhang the cell by that much). With `ellipsis` a word wider than the cell (less its padding) is cut short with an ellipsis,
 * and nothing is printed when not even one letter fits. The mark's geometry says whether the label was cut: `cut`.
 */
const cell = {
  id: 'cell',
  extent: (s) => ({ x: [s.x], y: [s.y] }),
  draw(env, s) {
    const { ctx, sx, sy } = env;
    const inset = s.inset ?? 1;
    const box = { x: sx.scale(s.x) + inset, y: sy.scale(s.y) + inset, w: sx.bandwidth - 2 * inset, h: sy.bandwidth - 2 * inset };
    if (![box.x, box.y, box.w, box.h].every(finite) || box.w <= 0 || box.h <= 0) return;
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.beginPath();
    if (s.radius && ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, s.radius);
    else ctx.rect(box.x, box.y, box.w, box.h);
    if (s.color !== null) {
      ctx.fillStyle = env.color(s.color ?? 'surface');
      ctx.fill();
    }
    if (s.shade) {
      ctx.save();
      ctx.globalAlpha = s.shade;
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
    }
    if (s.stroke !== undefined && s.stroke !== null) {
      const lw = s.strokeWidth ?? 1;
      ctx.strokeStyle = env.color(s.stroke);
      ctx.lineWidth = lw;
      ctx.setLineDash(s.strokeDash ?? []);
      ctx.beginPath();
      const inner = { x: box.x + lw / 2, y: box.y + lw / 2, w: Math.max(0, box.w - lw), h: Math.max(0, box.h - lw) };
      if (s.radius && ctx.roundRect) ctx.roundRect(inner.x, inner.y, inner.w, inner.h, shrinkRadius(s.radius, lw / 2));
      else ctx.rect(inner.x, inner.y, inner.w, inner.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    let cut = false;
    if (s.label?.text !== undefined) {
      const size = s.label.size ?? 11;
      ctx.font = env.font(size, s.label.weight);
      ctx.fillStyle = env.color(s.label.color ?? 'text');
      const align = s.label.align ?? 'center';
      const pad = s.label.pad ?? 2;
      let word = String(s.label.text);
      if (s.label.ellipsis) {
        word = ellipsize((v) => ctx.measureText(v).width, word, Math.max(0, box.w - 2 * pad));
        cut = word !== String(s.label.text);
      }
      ctx.textAlign = align === 'start' ? 'left' : align === 'end' ? 'right' : 'center';
      const tx = align === 'start' ? box.x + pad : align === 'end' ? box.x + box.w - pad : box.x + box.w / 2;
      if (word) ctx.fillText(word, tx, box.y + box.h / 2 + size * 0.32);
    }
    ctx.restore();
    return { kind: 'rect', ...box, cut };
  },
};

/**
 * text: { x, y, text, at, anchor, baseline, dx, dy, size = 11, weight, color, halo: { color, width }, place }
 *   anchor    'start' (default) | 'middle' | 'end'
 *   rotate    degrees, clockwise on screen, about the anchor point (a y axis title is -90)
 *   baseline  'alphabetic' (default: y is the baseline) | 'middle' (y is the centre of the line) | 'top'
 *   at        'end': placed just right of the plot at the height of `y` (an end label); the right margin makes room for it
 *   halo      an outline drawn first, for text over lines (width in px, centred on the glyph edge)
 *   place     keeps labels from overlapping, among the text marks that share `group`:
 *               { group, mode: 'spread', gap = 14 }   moves them along y (end labels beside lines)
 *               { group, mode: 'avoid', gap = 9, h = 14 }  tries other heights and the other side (point labels)
 *             optional `minY` / `maxY` keep them inside the given px range.
 */
const text = {
  id: 'text',
  extent: (s) => (s.at === 'end' ? { y: [s.y] } : { x: [s.x], y: [s.y] }),
  draw(env, s) {
    const { ctx } = env;
    const at = env.text(s);
    if (!at) return;
    const size = s.size ?? 11;
    ctx.save();
    ctx.font = env.font(size, s.weight);
    const anchor = at.anchor ?? s.anchor ?? 'start';
    ctx.textAlign = anchor === 'middle' ? 'center' : anchor;
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = s.opacity ?? 1;
    const w = ctx.measureText(String(s.text)).width;
    const base = at.y + (s.baseline === 'middle' ? size * 0.32 : s.baseline === 'top' ? size * 0.8 : 0);
    let tx = at.x;
    let ty = base;
    if (s.rotate) {
      ctx.translate(at.x, base);
      ctx.rotate((s.rotate * Math.PI) / 180);
      tx = 0;
      ty = 0;
    }
    if (s.halo) {
      ctx.strokeStyle = env.color(s.halo.color);
      ctx.lineWidth = s.halo.width ?? 3;
      ctx.lineJoin = 'round';
      ctx.strokeText(String(s.text), tx, ty);
    }
    ctx.fillStyle = env.color(s.color ?? 'text');
    ctx.fillText(String(s.text), tx, ty);
    ctx.restore();
    const left = ctx.textAlign === 'end' ? at.x - w : ctx.textAlign === 'center' ? at.x - w / 2 : at.x;
    return { kind: 'text', x: left, y: base - size * 0.8, w, h: size * 1.2 };
  },
};

/**
 * arrow: { from: { x, y }, to: { x, y }, size = 6, headLength, headWidth, color, width, opacity, stem = true } — a head at
 * `to`, pointing away from `from`, with a line between them. Put it on the end of a line mark to show where it is heading.
 * `size` makes a head of a fixed shape; `headLength` (tip to base) and `headWidth` (the base) set it exactly.
 */
const arrow = {
  id: 'arrow',
  extent: (s) => ({ x: [s.from?.x, s.to?.x], y: [s.from?.y, s.to?.y] }),
  draw(env, s) {
    const { ctx } = env;
    const a = { x: env.px(s.from.x), y: env.py(s.from.y) };
    const b = { x: env.px(s.to.x), y: env.py(s.to.y) };
    if (![a.x, a.y, b.x, b.y].every(finite)) return;
    const size = s.size ?? 6;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const color = env.color(s.color ?? 'series');
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = s.width ?? 1.5;
    ctx.lineJoin = 'round';
    if (s.stem !== false) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x - Math.cos(ang) * size * 0.6, b.y - Math.sin(ang) * size * 0.6);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    if (s.headLength !== undefined || s.headWidth !== undefined) {
      const len = s.headLength ?? size;
      const half = (s.headWidth ?? size * 0.9) / 2;
      const bx = b.x - Math.cos(ang) * len;
      const by = b.y - Math.sin(ang) * len;
      ctx.lineTo(bx - Math.sin(ang) * half, by + Math.cos(ang) * half);
      ctx.lineTo(bx + Math.sin(ang) * half, by - Math.cos(ang) * half);
    } else {
      ctx.lineTo(b.x - Math.cos(ang - 0.45) * size, b.y - Math.sin(ang - 0.45) * size);
      ctx.lineTo(b.x - Math.cos(ang + 0.45) * size, b.y - Math.sin(ang + 0.45) * size);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return { kind: 'rect', ...bounds([a, b], size) };
  },
};

/** Points along the curve of a `link`, for pointing at it. Pure. */
export function linkPoints(a, b, direction = 'h', steps = 24) {
  const mid = direction === 'v' ? (a.y + b.y) / 2 : (a.x + b.x) / 2;
  const c1 = direction === 'v' ? { x: a.x, y: mid } : { x: mid, y: a.y };
  const c2 = direction === 'v' ? { x: b.x, y: mid } : { x: mid, y: b.y };
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    });
  }
  return out;
}

/**
 * link: { from: { x, y }, to: { x, y }, direction: 'h' | 'v', width = 1.5, color, opacity, cap = 'round', hit = width }
 * A smooth S-shaped ribbon between two nodes (a flow diagram): it leaves `from` and arrives at `to` along the x axis ('h',
 * default) or the y axis ('v'), with its two control points halfway. `width` is its thickness in px.
 */
const link = {
  id: 'link',
  extent: (s) => ({ x: [s.from?.x, s.to?.x], y: [s.from?.y, s.to?.y] }),
  draw(env, s) {
    const { ctx } = env;
    const a = { x: env.px(s.from.x), y: env.py(s.from.y) };
    const b = { x: env.px(s.to.x), y: env.py(s.to.y) };
    if (![a.x, a.y, b.x, b.y].every(finite)) return;
    const width = s.width ?? 1.5;
    const vertical = s.direction === 'v';
    const mid = vertical ? (a.y + b.y) / 2 : (a.x + b.x) / 2;
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.strokeStyle = env.color(s.color ?? 'series');
    ctx.lineWidth = width;
    ctx.lineCap = s.cap ?? 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (vertical) ctx.bezierCurveTo(a.x, mid, b.x, mid, b.x, b.y);
    else ctx.bezierCurveTo(mid, a.y, mid, b.y, b.x, b.y);
    ctx.stroke();
    ctx.restore();
    const run = linkPoints(a, b, s.direction);
    const tol = Math.max(width, s.hit ?? width) / 2;
    return { kind: 'path', runs: [run], width, tol, ...bounds(run, tol) };
  },
};

for (const def of [line, area, bar, dot, rule, region, cell, text, arrow, link]) markTypes.register(def);

export { crisp, runsOf };
