import { BRANCH } from './MinMaxIndex.js';

/**
 * Drawing primitives. Series and indicators are built by combining these.
 *
 * Every primitive switches strategy by how many bars fall on one pixel:
 *   - sparse (up to 1.5 bars/px)   … draw each bar as is
 *   - dense                        … fold into min / max per pixel column
 *   - very dense (16+ bars/px)     … walk the LOD index blocks directly
 * so the cost of a frame depends on the screen width, not on the number of bars.
 *
 * Main contents of the view (v):
 *   ctx, dpr, theme, width, height   drawing target and pane size (CSS px)
 *   x0, bs                           x = x0 + i * bs
 *   a, b                             visible indices clamped to the data range
 *   ra, rb                           visible indices before clamping (for plots with an offset)
 *   y(value)                         value → y (px)
 *   bitmap()                         switch to device-pixel coordinates (ctx.save is done; restore when finished)
 */

/**
 * Add a polyline to the current path (does not stroke).
 * @returns {{x1:number, x2:number} | null} the x range that was drawn
 */
export function traceLine(v, arr, n, offset = 0, index = null, step = false) {
  const { ctx, bs, dpr, y } = v;
  const a = Math.max(0, v.ra - offset - 1);
  const b = Math.min(n - 1, v.rb - offset + 1);
  if (b < a) return null;
  const x0 = v.x0 + offset * bs;
  const perPx = 1 / (bs * dpr);
  let pen = false;
  let x1 = NaN;
  let x2 = NaN;

  if (perPx <= 1.5) {
    let prevY = 0;
    for (let i = a; i <= b; i++) {
      const val = arr[i];
      if (val !== val) {
        pen = false;
        continue;
      }
      const X = x0 + i * bs;
      const Y = y(val);
      if (!pen) {
        ctx.moveTo(X, Y);
        pen = true;
        if (x1 !== x1) x1 = X;
      } else {
        if (step) ctx.lineTo(X, prevY);
        ctx.lineTo(X, Y);
      }
      prevY = Y;
      x2 = X;
    }
    return x1 === x1 ? { x1, x2 } : null;
  }

  let col = -1e9;
  let first = 0;
  let mn = 0;
  let mx = 0;
  let last = 0;
  let has = false;
  const flush = () => {
    if (!has) return;
    has = false;
    const X = (col + 0.5) / dpr;
    const yf = y(first);
    if (!pen) {
      ctx.moveTo(X, yf);
      pen = true;
      if (x1 !== x1) x1 = X;
    } else {
      ctx.lineTo(X, yf);
    }
    if (mn !== mx) {
      ctx.lineTo(X, y(mn));
      ctx.lineTo(X, y(mx));
      ctx.lineTo(X, y(last));
    }
    x2 = X;
  };

  const lv = index && perPx >= BRANCH ? index.pick(perPx) : null;
  if (lv) {
    const S = lv.size;
    const jb = Math.min(lv.len - 1, Math.floor(b / S));
    for (let j = Math.floor(a / S); j <= jb; j++) {
      const lo = lv.min[j];
      const hi = lv.max[j];
      if (lo > hi) {
        flush();
        pen = false;
        continue;
      }
      const c = Math.floor((x0 + (j * S + S / 2) * bs) * dpr);
      if (c !== col) {
        flush();
        col = c;
        first = mn = lo;
        mx = last = hi;
        has = true;
      } else {
        if (lo < mn) mn = lo;
        if (hi > mx) mx = hi;
        last = hi;
      }
    }
  } else {
    for (let i = a; i <= b; i++) {
      const val = arr[i];
      if (val !== val) {
        flush();
        pen = false;
        continue;
      }
      const c = Math.floor((x0 + i * bs) * dpr);
      if (c !== col) {
        flush();
        col = c;
        first = mn = mx = last = val;
        has = true;
      } else {
        if (val < mn) mn = val;
        else if (val > mx) mx = val;
        last = val;
      }
    }
  }
  flush();
  return x1 === x1 ? { x1, x2 } : null;
}

export function strokeLine(v, arr, n, { color, width = 1.5, dash = null, offset = 0, index = null, step = false } = {}) {
  const { ctx } = v;
  ctx.beginPath();
  if (!traceLine(v, arr, n, offset, index, step)) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.stroke();
  if (dash) ctx.setLineDash([]);
}

/** Fill between a polyline and baseY (px). */
export function fillArea(v, arr, n, baseY, fillStyle, { offset = 0, index = null, step = false } = {}) {
  const { ctx } = v;
  ctx.beginPath();
  const r = traceLine(v, arr, n, offset, index, step);
  if (!r) return;
  ctx.lineTo(r.x2, baseY);
  ctx.lineTo(r.x1, baseY);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

const SX = [];
const SA = [];
const SB = [];

/** Sample two series at the same x positions (for fills; thinned out when dense). */
function samplePair(v, A, B, n, offset) {
  const { bs, dpr, y } = v;
  const a = Math.max(0, v.ra - offset - 1);
  const b = Math.min(n - 1, v.rb - offset + 1);
  const x0 = v.x0 + offset * bs;
  const stride = Math.max(1, Math.floor(1 / (bs * dpr)));
  let k = 0;
  for (let i = a - (a % stride); i <= b; i += stride) {
    const p = A[i];
    const q = B[i];
    if (p !== p || q !== q) continue;
    SX[k] = x0 + i * bs;
    SA[k] = y(p);
    SB[k] = y(q);
    k++;
  }
  return k;
}

/** Fill between two lines with one color (Bollinger Bands etc.). */
export function fillBand(v, A, B, n, fillStyle, offset = 0) {
  const k = samplePair(v, A, B, n, offset);
  if (k < 2) return;
  const { ctx } = v;
  ctx.beginPath();
  ctx.moveTo(SX[0], SA[0]);
  for (let j = 1; j < k; j++) ctx.lineTo(SX[j], SA[j]);
  for (let j = k - 1; j >= 0; j--) ctx.lineTo(SX[j], SB[j]);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

/** Fill between two lines, colored by which one is on top (the Ichimoku cloud etc.). */
export function fillCloud(v, A, B, n, colorAbove, colorBelow, offset = 0) {
  const k = samplePair(v, A, B, n, offset);
  if (k < 2) return;
  const pos = new Path2D();
  const neg = new Path2D();
  const poly = (p, pts) => {
    p.moveTo(pts[0], pts[1]);
    for (let j = 2; j < pts.length; j += 2) p.lineTo(pts[j], pts[j + 1]);
    p.closePath();
  };
  for (let j = 0; j < k - 1; j++) {
    const xa = SX[j];
    const xb = SX[j + 1];
    const a1 = SA[j];
    const a2 = SA[j + 1];
    const b1 = SB[j];
    const b2 = SB[j + 1];
    const d1 = b1 - a1;
    const d2 = b2 - a2;
    if (d1 >= 0 && d2 >= 0) poly(pos, [xa, a1, xb, a2, xb, b2, xa, b1]);
    else if (d1 <= 0 && d2 <= 0) poly(neg, [xa, a1, xb, a2, xb, b2, xa, b1]);
    else {
      const t = d1 / (d1 - d2);
      const xc = xa + t * (xb - xa);
      const yc = a1 + t * (a2 - a1);
      poly(d1 > 0 ? pos : neg, [xa, a1, xc, yc, xa, b1]);
      poly(d2 > 0 ? pos : neg, [xc, yc, xb, a2, xb, b2]);
    }
  }
  const { ctx } = v;
  ctx.fillStyle = colorAbove;
  ctx.fill(pos);
  ctx.fillStyle = colorBelow;
  ctx.fill(neg);
}

/**
 * Columns (volume, histograms). The color comes from `colors`, indexed by colorOf(i).
 * @param {object} o
 * @param {number} [o.base]   value at the foot of the columns (default 0)
 * @param {number} [o.baseY]  give the foot directly as y (px) instead
 * @param {string[]} o.colors
 * @param {(i:number)=>number} [o.colorOf]
 */
export function drawColumns(v, arr, n, { base = 0, baseY = null, colors, colorOf = null, index = null, offset = 0, ratio = 0.72 }) {
  const { ctx, bs, dpr, y } = v;
  const a = Math.max(0, v.ra - offset);
  const b = Math.min(n - 1, v.rb - offset);
  if (b < a) return;
  const x0 = v.x0 + offset * bs;
  const px = bs * dpr;
  const paths = colors.map(() => new Path2D());
  const Y0 = Math.round((baseY ?? y(base)) * dpr);
  v.bitmap();
  if (px >= 2) {
    const bw = Math.max(1, Math.floor(px * ratio));
    const half = bw >> 1;
    for (let i = a; i <= b; i++) {
      const val = arr[i];
      if (val !== val) continue;
      const X = Math.round((x0 + i * bs) * dpr) - half;
      const Y = Math.round(y(val) * dpr);
      paths[colorOf ? colorOf(i) : 0].rect(X, Math.min(Y, Y0), bw, Math.max(1, Math.abs(Y - Y0)));
    }
  } else {
    // For each pixel column, the value farthest from the foot represents it.
    let col = -1e9;
    let best = 0;
    let dist = -1;
    let ci = 0;
    const flush = () => {
      if (dist < 0) return;
      const Y = Math.round(y(best) * dpr);
      paths[ci].rect(col, Math.min(Y, Y0), 1, Math.max(1, Math.abs(Y - Y0)));
      dist = -1;
    };
    const baseV = baseY === null ? base : -Infinity;
    const perPx = 1 / px;
    const lv = index && perPx >= BRANCH ? index.pick(perPx) : null;
    if (lv) {
      const S = lv.size;
      const jb = Math.min(lv.len - 1, Math.floor(b / S));
      for (let j = Math.floor(a / S); j <= jb; j++) {
        const lo = lv.min[j];
        const hi = lv.max[j];
        if (lo > hi) continue;
        const val = baseV === -Infinity || hi - baseV >= baseV - lo ? hi : lo;
        const c = Math.floor((x0 + (j * S + S / 2) * bs) * dpr);
        if (c !== col) {
          flush();
          col = c;
        }
        const dd = baseV === -Infinity ? val : Math.abs(val - baseV);
        if (dd > dist || dist < 0) {
          dist = Math.max(dd, 0);
          best = val;
          ci = colorOf ? colorOf(j * S) : 0;
        }
      }
    } else {
      for (let i = a; i <= b; i++) {
        const val = arr[i];
        if (val !== val) continue;
        const c = Math.floor((x0 + i * bs) * dpr);
        if (c !== col) {
          flush();
          col = c;
        }
        const dd = baseV === -Infinity ? val : Math.abs(val - baseV);
        if (dd > dist || dist < 0) {
          dist = Math.max(dd, 0);
          best = val;
          ci = colorOf ? colorOf(i) : 0;
        }
      }
    }
    flush();
  }
  for (let k = 0; k < paths.length; k++) {
    ctx.fillStyle = colors[k];
    ctx.fill(paths[k]);
  }
  ctx.restore();
}

/** Dots (Parabolic SAR etc.). */
export function drawDots(v, arr, n, color, radius = 1.8, offset = 0) {
  const { ctx, bs, dpr, y } = v;
  const a = Math.max(0, v.ra - offset);
  const b = Math.min(n - 1, v.rb - offset);
  if (b < a) return;
  const x0 = v.x0 + offset * bs;
  const stride = Math.max(1, Math.floor(2 / (bs * dpr)));
  const r = Math.min(radius, Math.max(0.8, bs * 0.3));
  ctx.beginPath();
  for (let i = a - (a % stride); i <= b; i += stride) {
    const val = arr[i];
    if (val !== val) continue;
    const X = x0 + i * bs;
    const Y = y(val);
    ctx.moveTo(X + r, Y);
    ctx.arc(X, Y, r, 0, 6.2832);
  }
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Fold OHLC into 1px-wide high–low lines and add them to the up / dn paths (device-pixel coordinates).
 * Used when candles or bars become thinner than 2px.
 */
export function conflatedOhlc(v, d, up, dn) {
  const { bs, dpr, y, x0 } = v;
  const n = d.length;
  const perPx = 1 / (bs * dpr);
  const O = d.open;
  const C = d.close;
  let col = -1e9;
  let hi = 0;
  let lo = 0;
  let o = 0;
  let c = 0;
  let has = false;
  const flush = () => {
    if (!has) return;
    has = false;
    const Y1 = Math.round(y(hi) * dpr);
    const Y2 = Math.round(y(lo) * dpr);
    (c >= o ? up : dn).rect(col, Y1, 1, Math.max(1, Y2 - Y1));
  };
  const lv = perPx >= BRANCH ? d.minmax().pick(perPx) : null;
  if (lv) {
    const S = lv.size;
    const jb = Math.min(lv.len - 1, Math.floor(v.b / S));
    for (let j = Math.floor(v.a / S); j <= jb; j++) {
      const bl = lv.min[j];
      const bh = lv.max[j];
      if (bl > bh) continue;
      const i0 = j * S;
      const i1 = Math.min(n - 1, i0 + S - 1);
      const X = Math.floor((x0 + ((i0 + i1) / 2) * bs) * dpr);
      if (X !== col) {
        flush();
        col = X;
        o = O[i0];
        hi = bh;
        lo = bl;
        has = true;
      } else {
        if (bh > hi) hi = bh;
        if (bl < lo) lo = bl;
      }
      c = C[i1];
    }
  } else {
    const H = d.high;
    const L = d.low;
    for (let i = v.a; i <= v.b; i++) {
      const X = Math.floor((x0 + i * bs) * dpr);
      if (X !== col) {
        flush();
        col = X;
        o = O[i];
        hi = H[i];
        lo = L[i];
        has = true;
      } else {
        if (H[i] > hi) hi = H[i];
        if (L[i] < lo) lo = L[i];
      }
      c = C[i];
    }
  }
  flush();
}
