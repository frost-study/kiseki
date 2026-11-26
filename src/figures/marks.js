import { markTypes } from '../core/Registry.js';

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
 * line: { points, color, width = 1.5, dash, opacity, curve: 'linear' | 'step', pointRadius, halo: { color, width }, hit }
 * A run of one point is drawn as a dot of `pointRadius` (default: the line width). `hit` is the width of the zone that counts
 * as on the line for pointing (default 14).
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
    paint(env.color(s.color ?? 'series'), width, true);
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
    if (s.stroke) {
      ctx.strokeStyle = env.color(s.stroke);
      ctx.lineWidth = s.strokeWidth ?? 1;
      ctx.stroke();
    }
    ctx.restore();
    return { kind: 'rect', ...box };
  },
};

/** dot: { x, y, r = 3, color, stroke, strokeWidth, opacity } — a filled circle (with an optional outline in `stroke`). */
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
    if (s.stroke) {
      ctx.strokeStyle = env.color(s.stroke);
      ctx.lineWidth = s.strokeWidth ?? 1;
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

/** region: { x0, x1, y0, y1, color, opacity } — a shaded span; a missing bound runs to the edge of the plot. */
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
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.restore();
    return { kind: 'rect', ...box };
  },
};

/**
 * cell: { x, y, color, opacity, inset = 1, radius, label: { text, color, size, weight } }
 * One cell of a grid: `x` and `y` are keys of band scales. `inset` px are left free on every side.
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
    ctx.fillStyle = env.color(s.color ?? 'surface');
    ctx.beginPath();
    if (s.radius && ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, s.radius);
    else ctx.rect(box.x, box.y, box.w, box.h);
    ctx.fill();
    if (s.label?.text !== undefined) {
      const size = s.label.size ?? 11;
      ctx.font = env.font(size, s.label.weight);
      ctx.fillStyle = env.color(s.label.color ?? 'text');
      ctx.textAlign = 'center';
      ctx.fillText(String(s.label.text), box.x + box.w / 2, box.y + box.h / 2 + size * 0.32);
    }
    ctx.restore();
    return { kind: 'rect', ...box };
  },
};

/**
 * text: { x, y, text, at, anchor, baseline, dx, dy, size = 11, weight, color, halo: { color, width }, place }
 *   anchor    'start' (default) | 'middle' | 'end'
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
    ctx.textAlign = at.anchor ?? s.anchor ?? 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = s.opacity ?? 1;
    const w = ctx.measureText(String(s.text)).width;
    const base = at.y + (s.baseline === 'middle' ? size * 0.32 : s.baseline === 'top' ? size * 0.8 : 0);
    if (s.halo) {
      ctx.strokeStyle = env.color(s.halo.color);
      ctx.lineWidth = s.halo.width ?? 3;
      ctx.lineJoin = 'round';
      ctx.strokeText(String(s.text), at.x, base);
    }
    ctx.fillStyle = env.color(s.color ?? 'text');
    ctx.fillText(String(s.text), at.x, base);
    ctx.restore();
    const left = ctx.textAlign === 'end' ? at.x - w : ctx.textAlign === 'center' ? at.x - w / 2 : at.x;
    return { kind: 'text', x: left, y: base - size * 0.8, w, h: size * 1.2 };
  },
};

/**
 * arrow: { from: { x, y }, to: { x, y }, size = 6, color, width, opacity, stem = true } — a head at `to`, pointing away from
 * `from`, with a line between them. Put it on the end of a line mark to show where it is heading.
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
    ctx.lineTo(b.x - Math.cos(ang - 0.45) * size, b.y - Math.sin(ang - 0.45) * size);
    ctx.lineTo(b.x - Math.cos(ang + 0.45) * size, b.y - Math.sin(ang + 0.45) * size);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return { kind: 'rect', ...bounds([a, b], size) };
  },
};

for (const def of [line, area, bar, dot, rule, region, cell, text, arrow]) markTypes.register(def);

export { crisp, runsOf };
