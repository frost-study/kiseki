const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Layout helpers for figures: spreading and placing labels, stacking values. Pure: no DOM.
 */

/**
 * Keep labels at least `gap` apart along one axis (end labels beside lines, for example).
 * Labels that overlap move apart symmetrically around where they wanted to be; a group stays inside [min, max].
 * @param {number[]} positions wanted centre of each label
 * @returns {number[]} the new positions, in the order given
 */
export function spreadLabels(positions, { gap = 14, min = -Infinity, max = Infinity } = {}) {
  const n = positions.length;
  if (n === 0) return [];
  const order = positions.map((_, i) => i).sort((a, b) => positions[a] - positions[b] || a - b);
  // A block is a run of labels `gap` apart. `sum` is the total of (wanted − rank within the block × gap), so the block starts at sum / count.
  const blocks = order.map((idx, rank) => ({ from: rank, count: 1, sum: positions[idx] }));
  for (let guard = 0; guard < n * 4 + 4; guard++) {
    let merged = false;
    // push blocks that were clamped against an edge into place first, so a neighbour sees where they really are
    for (const blk of blocks) {
      const start = blk.sum / blk.count;
      const last = start + (blk.count - 1) * gap;
      if (start < min) blk.sum += (min - start) * blk.count;
      else if (last > max) blk.sum -= (last - max) * blk.count;
    }
    for (let b = 0; b < blocks.length - 1; b++) {
      const a = blocks[b];
      const c = blocks[b + 1];
      if (a.sum / a.count + a.count * gap > c.sum / c.count + 1e-9) {
        blocks.splice(b, 2, { from: a.from, count: a.count + c.count, sum: a.sum + c.sum - a.count * gap * c.count });
        merged = true;
        break;
      }
    }
    if (!merged) break;
  }
  const out = new Array(n);
  for (const blk of blocks) {
    const start = blk.sum / blk.count;
    for (let k = 0; k < blk.count; k++) out[order[blk.from + k]] = start + k * gap;
  }
  return out;
}

/**
 * Tick labels of width `w` centred on `x` inside [minX, maxX] (an edge label is shifted inwards); a label that would come
 * closer than `gap` px to the previous kept one is dropped.
 * @param {{x:number, w:number}[]} ticks
 * @returns {(object & {left:number})[]} the kept ticks with the left edge of their label, in x order
 */
export function placeTickLabels(ticks, minX, maxX, gap = 8) {
  const out = [];
  let lastRight = -Infinity;
  for (const t of [...ticks].sort((p, q) => p.x - q.x)) {
    const left = Math.min(Math.max(t.x - t.w / 2, minX), Math.max(minX, maxX - t.w));
    if (left < lastRight + gap) continue;
    out.push({ ...t, left });
    lastRight = left + t.w;
  }
  return out;
}

/**
 * Greedy placement of point labels that must not overlap (a scatter plot): each label sits to the right of its point, or to
 * the left when it would leave `maxX`; it tries vertical offsets 0, +h, −h, +2h, −2h … until it clears every placed box.
 * @param {{id:string|number, x:number, y:number, w:number}[]} items anchor point and label width
 * @returns {Map<string|number, {x:number, y:number, side:'start'|'end'}>} the label's anchor x, centre y and the side it hangs on
 */
export function placeBoxes(items, { maxX = Infinity, h = 14, gap = 9, minY, maxY } = {}) {
  const placed = [];
  const out = new Map();
  const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id)));
  for (const it of order) {
    const side = it.x + gap + it.w > maxX ? 'end' : 'start';
    const x0 = side === 'start' ? it.x + gap : it.x - gap - it.w;
    let chosen = it.y;
    for (let k = 0; k < 12; k++) {
      const dy = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * h;
      const cy = it.y + dy;
      if (minY !== undefined && cy - h / 2 < minY) continue;
      if (maxY !== undefined && cy + h / 2 > maxY) continue;
      const box = { x0, x1: x0 + it.w, y0: cy - h / 2, y1: cy + h / 2 };
      const hit = placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
      if (!hit) {
        chosen = cy;
        placed.push(box);
        break;
      }
      if (k === 11) placed.push(box);
    }
    out.set(it.id, { x: side === 'start' ? x0 : x0 + it.w, y: chosen, side });
  }
  return out;
}

/**
 * Stack values for bar marks. `series` is a list of value arrays (one per series, one value per category); the result has
 * the same shape, each entry `{ from, to }` in value units. Positive values stack up from 0 and negative ones down from 0,
 * so a diverging bar is a stack with values of both signs. With 'percent' every category is scaled so its absolute values
 * add up to 100. Missing or non-finite values count as 0 and give a zero-length entry.
 * @param {number[][]} series
 * @param {'stack'|'percent'} [mode]
 */
export function stackValues(series, mode = 'stack') {
  const cats = Math.max(0, ...series.map((s) => s.length));
  const out = series.map(() => new Array(cats));
  for (let c = 0; c < cats; c++) {
    let pos = 0;
    let neg = 0;
    let total = 0;
    if (mode === 'percent') for (const s of series) total += Math.abs(Number.isFinite(s[c]) ? s[c] : 0);
    const scale = mode === 'percent' ? (total > 0 ? 100 / total : 0) : 1;
    series.forEach((s, i) => {
      const v = (Number.isFinite(s[c]) ? s[c] : 0) * scale;
      if (v >= 0) {
        out[i][c] = { from: pos, to: pos + v };
        pos += v;
      } else {
        out[i][c] = { from: neg, to: neg + v };
        neg += v;
      }
    });
  }
  return out;
}

/**
 * The mark to move to from `fromId` with an arrow key (a roving focus over tiles or cells): the nearest one, centre to centre,
 * in that direction, where being off to the side counts double (so ← from a tile goes to its left neighbour, not to something
 * far left on another row). `boxes` are `{ id, x, y, w, h }` (the marks a figure exposes). Null at the edge, or for an unknown id.
 * @param {{id:string|number, x:number, y:number, w:number, h:number}[]} boxes
 * @param {'left'|'right'|'up'|'down'} dir
 */
export function nextInDirection(boxes, fromId, dir) {
  const from = boxes.find((b) => b.id === fromId);
  if (!from) return null;
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  let best = null;
  let bestScore = Infinity;
  for (const b of boxes) {
    if (b.id === fromId) continue;
    const dx = b.x + b.w / 2 - cx;
    const dy = b.y + b.h / 2 - cy;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    if (along <= 0.5) continue;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = along + 2 * across;
    if (score < bestScore) {
      best = b.id;
      bestScore = score;
    }
  }
  return best;
}

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
