/**
 * Hit testing for the marks a figure exposes (`figure.marks`). Pure: no DOM.
 *
 * A mark is `{ id, kind, x, y, w, h, datum, … }`; x / y / w / h is always its bounding box in CSS px, and
 *   kind 'rect' | 'text'   the box itself
 *   kind 'circle'          also cx, cy, r
 *   kind 'path'            also runs (a list of polylines of {x, y}) and tol (the distance that still counts as on it)
 *   kind 'arc'             a ring sector: also cx, cy, r0, r1 (inner and outer radius) and a0, a1 (angles in radians, a1 > a0,
 *                          clockwise on screen, 0 = the positive x axis)
 */

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

/** Distance from (x, y) to the mark: 0 inside a box or a circle, and within `tol` of a path's line. */
export function distanceTo(mark, x, y) {
  if (mark.kind === 'circle') return Math.max(0, Math.hypot(x - mark.cx, y - mark.cy) - mark.r);
  if (mark.kind === 'arc') {
    const r = Math.hypot(x - mark.cx, y - mark.cy);
    const turn = Math.PI * 2;
    let da = (Math.atan2(y - mark.cy, x - mark.cx) - mark.a0) % turn;
    if (da < 0) da += turn;
    if (da <= mark.a1 - mark.a0) return Math.max(0, mark.r0 - r, r - mark.r1);
    const edge = (a) => distToSegment(x, y, mark.cx + Math.cos(a) * mark.r0, mark.cy + Math.sin(a) * mark.r0, mark.cx + Math.cos(a) * mark.r1, mark.cy + Math.sin(a) * mark.r1);
    return Math.min(edge(mark.a0), edge(mark.a1));
  }
  if (mark.kind === 'path') {
    let best = Infinity;
    for (const run of mark.runs) {
      if (run.length === 1) best = Math.min(best, Math.hypot(x - run[0].x, y - run[0].y));
      for (let i = 1; i < run.length; i++) best = Math.min(best, distToSegment(x, y, run[i - 1].x, run[i - 1].y, run[i].x, run[i].y));
    }
    return Math.max(0, best - (mark.tol ?? 0));
  }
  const dx = Math.max(mark.x - x, 0, x - (mark.x + mark.w));
  const dy = Math.max(mark.y - y, 0, y - (mark.y + mark.h));
  return Math.hypot(dx, dy);
}

/**
 * The mark under (x, y): the topmost (last drawn) one that contains the point, otherwise the nearest one within `slop` px.
 * @returns {object|null}
 */
export function hitTest(marks, x, y, slop = 0) {
  let best = null;
  let bestD = Infinity;
  for (let i = marks.length - 1; i >= 0; i--) {
    const d = distanceTo(marks[i], x, y);
    if (d === 0) return marks[i];
    if (d <= slop && d < bestD) {
      best = marks[i];
      bestD = d;
    }
  }
  return best;
}
