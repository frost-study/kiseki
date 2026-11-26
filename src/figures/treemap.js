import { figureTypes } from '../core/Registry.js';
import { Figure } from './Figure.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The golden ratio: the aspect ratio squarified layouts aim for. */
export const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Squarified treemap layout (Bruls, Huizing and van Wijk; the algorithm of d3-hierarchy's `treemapSquarify`). Pure.
 *
 * Items with a non-positive or non-finite value are dropped. The rest are laid out largest first (ties keep their order), each
 * rectangle's area in proportion to its value, trying for rectangles close to `ratio` (width / height) in shape. The tiles
 * lie in [0, width] × [0, height]; with `gap` every tile is `gap / 2` smaller on each side where it touches another one, so the
 * gaps between tiles are `gap` wide and the outer edge stays flush (the way d3's `paddingInner` works). With `round` the edges
 * are rounded to whole pixels *after* the gaps are made, so neighbours stay `gap` apart.
 *
 * @param {{value:number}[]} items
 * @param {{width:number, height:number, gap?:number, round?:boolean, ratio?:number}} o
 * @returns {{index:number, x0:number, y0:number, x1:number, y1:number}[]}  largest first; `index` is the position in `items`
 */
export function squarify(items, { width, height, gap = 0, round = true, ratio = PHI }) {
  const nodes = [];
  (items ?? []).forEach((it, index) => {
    if (finite(it?.value) && it.value > 0) nodes.push({ index, value: it.value });
  });
  nodes.sort((a, b) => b.value - a.value);
  if (!nodes.length || !(width > 0) || !(height > 0)) return [];
  const half = gap / 2;
  // the layout runs over the box grown by half a gap, so that shrinking every tile by it leaves the outer edge flush
  place(nodes, -half, -half, width + half, height + half, ratio);
  return nodes.map((n) => {
    let x0 = n.x0 + half;
    let y0 = n.y0 + half;
    let x1 = n.x1 - half;
    let y1 = n.y1 - half;
    if (x1 < x0) x0 = x1 = (x0 + x1) / 2;
    if (y1 < y0) y0 = y1 = (y0 + y1) / 2;
    if (round) [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.round);
    return { index: n.index, x0, y0, x1, y1 };
  });
}

function place(nodes, x0, y0, x1, y1, ratio) {
  let value = nodes.reduce((a, n) => a + n.value, 0);
  let i0 = 0;
  let i1 = 0;
  const n = nodes.length;
  while (i0 < n) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let sum = nodes[i1++].value;
    let min = sum;
    let max = sum;
    const alpha = Math.max(dy / dx, dx / dy) / (value * ratio);
    let beta = sum * sum * alpha;
    let worst = Math.max(max / beta, beta / min);
    // keep adding nodes to the row while its worst aspect ratio does not get worse
    for (; i1 < n; i1++) {
      const v = nodes[i1].value;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
      beta = sum * sum * alpha;
      const next = Math.max(max / beta, beta / min);
      if (next > worst) {
        sum -= v;
        break;
      }
      worst = next;
    }
    const row = nodes.slice(i0, i1);
    if (dx < dy) {
      // a row along the top, as wide as the box
      const bottom = y0 + (dy * sum) / value;
      const k = sum && (x1 - x0) / sum;
      let x = x0;
      for (const node of row) {
        node.x0 = x;
        node.x1 = x += node.value * k;
        node.y0 = y0;
        node.y1 = bottom;
      }
      y0 = bottom;
    } else {
      // a column on the left, as high as the box
      const right = x0 + (dx * sum) / value;
      const k = sum && (y1 - y0) / sum;
      let y = y0;
      for (const node of row) {
        node.x0 = x0;
        node.x1 = right;
        node.y0 = y;
        node.y1 = y += node.value * k;
      }
      x0 = right;
    }
    value -= sum;
    i0 = i1;
  }
}

/**
 * How many of a tile's text lines fit. Pure. Each line says the least tile it needs (`minW` × `minH`, the outer size of the
 * tile); lines are shown in order and a line that does not fit hides every line after it, so a tile shows its title, or its
 * title and value, or nothing.
 * @param {{minW?:number, minH?:number}[]} lines
 * @returns {number}
 */
export function fitLines(lines, w, h) {
  let n = 0;
  for (const l of lines ?? []) {
    if (w >= (l.minW ?? 0) && h >= (l.minH ?? 0)) n++;
    else break;
  }
  return n;
}

/** `text` shortened with an ellipsis until `measure(text)` fits in `max` px (an empty string when not even one character fits). Pure. */
export function ellipsize(measure, text, max, ellipsis = '…') {
  const s = String(text);
  if (measure(s) <= max) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(s.slice(0, mid) + ellipsis) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 && measure(ellipsis) > max ? '' : s.slice(0, lo) + ellipsis;
}

/**
 * A treemap: one tile per datum, squarified (see `squarify`), on one canvas.
 *
 * `setData([{ id, value, fill, border, stripe, shade, opacity, lines, datum }])`
 *   fill     the tile's color spec (a CSS color, a palette index or a role)
 *   border   { color, width = 1 }       stripe   { color, width = 4 }: a bar down the left edge, over the border
 *   shade    0–1: a black veil over the tile (a pointer resting on it)
 *   lines    [{ text, size = 12, weight, color = 'text', minW, minH }] the words in the tile, top left, one line each, cut with an
 *            ellipsis at the tile's edge; a line is only printed when the tile is at least `minW` × `minH` px, and then so are the
 *            ones before it (see `fitLines`)
 * Every tile is exposed in `marks` as `{ id, kind: 'rect', x, y, w, h, datum, shown, lines, full }`: `shown` is the number of
 * text lines printed and `full` says all of them were, so a host knows which tiles need their words somewhere else.
 *
 * Options (besides those of every figure): `gap` between tiles (default 0), `round` edges to whole pixels (default true),
 * `ratio` aimed-for aspect (default the golden ratio), `padding` between a tile's edge and its words (default 6), `lineHeight`
 * (default 16), `radius` corner radius (default 2).
 */
export class TreemapFigure extends Figure {
  static id = 'treemap';
  static label = 'Treemap';

  paint(ctx) {
    const o = this.options;
    const rows = (Array.isArray(this.data) ? this.data : []).filter(Boolean);
    const tiles = squarify(rows, { width: this.width, height: this.height, gap: o.gap ?? 0, round: o.round ?? true, ratio: o.ratio ?? PHI });
    const pad = o.padding ?? 6;
    const lineHeight = o.lineHeight ?? 16;
    const radius = o.radius ?? 2;
    for (const t of tiles) {
      const row = rows[t.index];
      const x = t.x0;
      const y = t.y0;
      const w = t.x1 - t.x0;
      const h = t.y1 - t.y0;
      if (w <= 0 || h <= 0) continue;
      ctx.save();
      ctx.globalAlpha = row.opacity ?? 1;
      ctx.beginPath();
      if (radius && ctx.roundRect) ctx.roundRect(x, y, w, h, radius);
      else ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = this.color(row.fill ?? 'surface');
      ctx.fillRect(x, y, w, h);
      const bw = row.border ? row.border.width ?? 1 : 0;
      if (row.border) {
        ctx.strokeStyle = this.color(row.border.color ?? 'border');
        ctx.lineWidth = bw * 2; // clipped to the tile: the inner half is the border
        ctx.strokeRect(x, y, w, h);
      }
      const sw = row.stripe ? row.stripe.width ?? 4 : 0;
      if (row.stripe) {
        ctx.fillStyle = this.color(row.stripe.color ?? 0);
        ctx.fillRect(x, y, sw, h);
      }
      if (row.shade) {
        ctx.globalAlpha = row.shade;
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = row.opacity ?? 1;
      }
      const lines = row.lines ?? [];
      const shown = fitLines(lines, w, h);
      const left = x + Math.max(sw, bw) + pad;
      const room = w - Math.max(sw, bw) - bw - 2 * pad;
      ctx.textAlign = 'left';
      for (let i = 0; i < shown; i++) {
        const l = lines[i];
        const size = l.size ?? 12;
        ctx.font = this.font(size, l.weight);
        ctx.fillStyle = this.color(l.color ?? 'text');
        const text = ellipsize((s) => ctx.measureText(s).width, l.text, room);
        if (text) ctx.fillText(text, left, y + bw + pad + i * lineHeight + lineHeight / 2 + size * 0.32);
      }
      if (shown) this.watchFonts();
      ctx.restore();
      if (row.id !== undefined && row.id !== null) {
        this.expose({ id: row.id, datum: row.datum, type: 'tile', kind: 'rect', x, y, w, h, shown, lines: lines.length, full: shown === lines.length });
      }
    }
  }
}

figureTypes.register(TreemapFigure);
