import { figureTypes } from '../core/Registry.js';
import { Figure } from './Figure.js';

const TURN = Math.PI * 2;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The slices of a donut as angles. Pure.
 *
 * Slices with a non-positive or non-finite value are dropped (they keep no slice and no mark). The rest share the circle in
 * proportion to their values, in the order given, starting at `startAngle` and running clockwise on screen. With
 * `padAngle` every slice also owns that much more angle, which is the gap between neighbours (as d3's pie does): the gap is
 * only left when there are two slices or more.
 *
 * @param {{value:number}[]} items
 * @param {object} [o]
 * @param {number} [o.startAngle=-Math.PI/2]  where the first slice starts; the default is 12 o'clock (canvas angles: 0 = 3 o'clock)
 * @param {number} [o.padAngle=0]  gap between slices, as an angle at the middle radius of the ring
 * @returns {{index:number, value:number, a0:number, a1:number, share:number}[]}  a1 > a0 each; `index` is the position in `items`
 */
export function donutSlices(items, { startAngle = -Math.PI / 2, padAngle = 0 } = {}) {
  const rows = [];
  (items ?? []).forEach((it, index) => {
    if (finite(it?.value) && it.value > 0) rows.push({ index, value: it.value });
  });
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (!(total > 0)) return [];
  const pad = rows.length > 1 ? padAngle : 0;
  const k = (TURN - pad * rows.length) / total;
  let a = startAngle;
  return rows.map((r) => {
    const span = r.value * k + pad;
    const out = { index: r.index, value: r.value, a0: a, a1: a + span, share: r.value / total };
    a += span;
    return out;
  });
}

/**
 * The outline of one ring sector with rounded corners, as the geometry the canvas path is made of. Pure.
 *
 * The two sides of the sector are straight lines parallel to the radius at its middle angle, `gap / 2` away from where
 * the neighbouring sector begins, so a gap has the same width along its whole length (the way d3's arc pads). Each of the
 * four corners is rounded with radius `corner` (reduced when the sector is too small for it). A sector that is a whole ring
 * (no gap, a span of a full turn) has no corners.
 *
 * @returns {{ whole: true } | { whole: false, corners: {cx:number, cy:number, from:number, to:number, ccw:boolean}[], r0:number, r1:number, start:{x:number,y:number} } | null}
 *   `null` when nothing is left to draw (the sector is thinner than its gap).
 */
export function sectorOutline({ cx = 0, cy = 0, r0, r1, a0, a1, gap = 0, corner = 0 }) {
  if (!(r1 > r0) || !(a1 > a0)) return null;
  if (a1 - a0 >= TURN - 1e-9 && gap === 0) return { whole: true, cx, cy, r0, r1 };
  const h = gap / 2;
  let cr = Math.max(0, Math.min(corner, (r1 - r0) / 2));
  for (let attempt = 0; attempt < 8; attempt++) {
    const o = build(cx, cy, r0, r1, a0, a1, h, cr);
    if (o) return o;
    if (cr === 0) return null;
    cr = cr > 0.25 ? cr / 2 : 0;
  }
  return null;
}

function build(cx, cy, r0, r1, a0, a1, h, cr) {
  // frame of each side: u along the radius, n toward the inside of the sector
  const side = (a, sign) => ({ u: { x: Math.cos(a), y: Math.sin(a) }, n: { x: -Math.sin(a) * sign, y: Math.cos(a) * sign } });
  const s0 = side(a0, 1);
  const s1 = side(a1, -1);
  // the centre of the corner circle tangent to the side and to the circle of radius `r` (inside when `inner` is false)
  const centre = (f, r, inner) => {
    const dist = inner ? r + cr : r - cr;
    const off = h + cr;
    const along2 = dist * dist - off * off;
    if (along2 < 0) return null;
    const s = Math.sqrt(along2);
    return { x: cx + f.u.x * s + f.n.x * off, y: cy + f.u.y * s + f.n.y * off };
  };
  const c = { io: centre(s0, r1, false), ii: centre(s0, r0, true), eo: centre(s1, r1, false), ei: centre(s1, r0, true) };
  if (!c.io || !c.ii || !c.eo || !c.ei) return null;
  const ang = (p, q) => Math.atan2(p.y - q.y, p.x - q.x);
  const onCircle = (p, r) => {
    const d = Math.hypot(p.x - cx, p.y - cy);
    return { x: cx + ((p.x - cx) / d) * r, y: cy + ((p.y - cy) / d) * r };
  };
  // the outer circle must still run forward from the first corner to the last, and so must the inner one backward
  const span = a1 - a0;
  const room = (r) => 2 * Math.asin(Math.min(1, (h + cr) / r));
  if (span <= room(r1 - cr) + 1e-9 || span <= room(r0 + cr) + 1e-9) return null;
  const o0 = onCircle(c.io, r1);
  const o1 = onCircle(c.eo, r1);
  const i0 = onCircle(c.ii, r0);
  const i1 = onCircle(c.ei, r0);
  const foot = (p, f) => ({ x: p.x - f.n.x * cr, y: p.y - f.n.y * cr });
  const eo0 = foot(c.io, s0);
  const ei0 = foot(c.ii, s0);
  const eo1 = foot(c.eo, s1);
  const ei1 = foot(c.ei, s1);
  const corners = [
    { cx: c.io.x, cy: c.io.y, from: ang(eo0, c.io), to: ang(o0, c.io), ccw: false },
    { cx: c.eo.x, cy: c.eo.y, from: ang(o1, c.eo), to: ang(eo1, c.eo), ccw: false },
    { cx: c.ei.x, cy: c.ei.y, from: ang(ei1, c.ei), to: ang(i1, c.ei), ccw: true },
    { cx: c.ii.x, cy: c.ii.y, from: ang(i0, c.ii), to: ang(ei0, c.ii), ccw: true },
  ];
  return { whole: false, cx, cy, r0, r1, cr, start: eo0, outer: { from: ang(o0, { x: cx, y: cy }), to: ang(o1, { x: cx, y: cy }) }, inner: { from: ang(i1, { x: cx, y: cy }), to: ang(i0, { x: cx, y: cy }) }, corners };
}

/** The bounding box of a ring sector (its four corners and the extremes of the arcs between). Pure. */
export function sectorBounds({ cx, cy, r0, r1, a0, a1 }) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const angles = [a0, a1];
  // the extremes of a circle lie at multiples of a quarter turn
  for (let q = Math.ceil(a0 / (Math.PI / 2)); q * (Math.PI / 2) < a1; q++) angles.push(q * (Math.PI / 2));
  for (const a of angles) {
    for (const r of [r0, r1]) {
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Trace `sectorOutline(...)` into the current path of `ctx` (the caller fills it). */
export function traceSector(ctx, o) {
  if (!o) return;
  if (o.whole) {
    ctx.moveTo(o.cx + o.r1, o.cy);
    ctx.arc(o.cx, o.cy, o.r1, 0, TURN);
    ctx.moveTo(o.cx + o.r0, o.cy);
    ctx.arc(o.cx, o.cy, o.r0, 0, TURN, true);
    return;
  }
  const [co, ce, ie, ii] = o.corners;
  ctx.moveTo(o.start.x, o.start.y);
  ctx.arc(co.cx, co.cy, o.cr, co.from, co.to, false);
  ctx.arc(o.cx, o.cy, o.r1, o.outer.from, unwrap(o.outer.from, o.outer.to, false), false);
  ctx.arc(ce.cx, ce.cy, o.cr, ce.from, unwrap(ce.from, ce.to, false), false);
  ctx.arc(ie.cx, ie.cy, o.cr, ie.from, unwrap(ie.from, ie.to, true), true);
  ctx.arc(o.cx, o.cy, o.r0, o.inner.from, unwrap(o.inner.from, o.inner.to, true), true);
  ctx.arc(ii.cx, ii.cy, o.cr, ii.from, unwrap(ii.from, ii.to, true), true);
  ctx.closePath();
}

// `arc` takes the end angle as given and sweeps in the stated direction, so make it the same angle modulo a turn
function unwrap(from, to, ccw) {
  let d = to - from;
  if (ccw) {
    while (d > 0) d -= TURN;
    while (d < -TURN) d += TURN;
  } else {
    while (d < 0) d += TURN;
    while (d > TURN) d -= TURN;
  }
  return from + d;
}

/**
 * A donut: ring slices, one per datum. `setData([{ id, value, color, datum }])`: a slice with an `id` is exposed in `marks` as
 * `{ kind: 'arc', cx, cy, r0, r1, a0, a1 }` so a host can point at it or lay a control over it (see hit.js). `color` is a
 * color spec (a CSS color, a palette index or a role). Slices with a non-positive value draw nothing and have no mark.
 *
 * Options (besides those of every figure):
 *   outer         outer radius in px (default: half of the smaller side)
 *   innerRatio    inner radius as a fraction of the outer one (default 0.68)
 *   cornerRadius  px (default 2)          padAngle  gap between slices as an angle in radians (default 0.025; none for one slice)
 *   startAngle    radians, canvas angles (default: 12 o'clock)
 *   label         { text, size = 12, weight, color } printed in the middle of the ring
 *
 * Meant to be small and static: give it a fixed `width` and `height` and it observes nothing.
 */
export class DonutFigure extends Figure {
  static id = 'donut';
  static label = 'Donut';

  /** After a layout: the centre and the two radii. */
  ring = null;

  paint(ctx) {
    const o = this.options;
    const rows = (Array.isArray(this.data) ? this.data : []).filter(Boolean);
    const cx = this.width / 2;
    const cy = this.height / 2;
    const r1 = o.outer ?? Math.min(this.width, this.height) / 2;
    const r0 = r1 * (o.innerRatio ?? 0.68);
    this.ring = { cx, cy, r0, r1 };
    const pad = o.padAngle ?? 0.025;
    const slices = donutSlices(rows, { startAngle: o.startAngle ?? -Math.PI / 2, padAngle: pad });
    // d3's convention: the padding is a gap of constant width, measured at the radius sqrt(r0 * r0 + r1 * r1)
    const gap = slices.length > 1 ? pad * Math.sqrt(r0 * r0 + r1 * r1) : 0;
    for (const s of slices) {
      const row = rows[s.index];
      const outline = sectorOutline({ cx, cy, r0, r1, a0: s.a0, a1: s.a1, gap, corner: o.cornerRadius ?? 2 });
      if (!outline) continue;
      ctx.save();
      ctx.fillStyle = this.color(row.color ?? 0);
      ctx.beginPath();
      traceSector(ctx, outline);
      ctx.fill();
      ctx.restore();
      if (row.id !== undefined && row.id !== null) {
        this.expose({ id: row.id, datum: row.datum, type: 'arc', kind: 'arc', cx, cy, r0, r1, a0: s.a0, a1: s.a1, share: s.share, ...sectorBounds({ cx, cy, r0, r1, a0: s.a0, a1: s.a1 }) });
      }
    }
    if (o.label?.text !== undefined) {
      ctx.save();
      ctx.font = this.font(o.label.size ?? 12, o.label.weight);
      ctx.fillStyle = this.color(o.label.color ?? 'text');
      ctx.textAlign = 'center';
      ctx.fillText(String(o.label.text), cx, cy + (o.label.size ?? 12) * 0.32);
      ctx.restore();
      this.watchFonts();
    }
  }
}

figureTypes.register(DonutFigure);
