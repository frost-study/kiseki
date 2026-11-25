/**
 * Min/max pyramid (LOD index).
 *
 * Level k holds the min / max of the source arrays in blocks of 16^(k+1).
 *  - min / max over any range in O(16·log n) (for autoscaling)
 *  - drawing cost stays proportional to pixels even with hundreds or thousands of bars per pixel
 *  - appends and updates at the tail recompute only the touched blocks (for live updates)
 *
 * NaN means "no value" and is ignored. An empty block has min=+∞ / max=-∞.
 */
export const BRANCH = 16;

export class MinMaxIndex {
  constructor() {
    /** @type {{min: Float64Array, max: Float64Array, len: number, size: number}[]} */
    this.levels = [];
    this.n = 0;
  }

  /**
   * Apply changes in [from, n) to the index.
   * @param {ArrayLike<number>} lo array for minima (e.g. lows)
   * @param {ArrayLike<number>} hi array for maxima (e.g. highs); the same array as lo for a line
   */
  update(lo, hi, from, n) {
    this.n = n;
    let srcLo = lo;
    let srcHi = hi;
    let srcN = n;
    let f = Math.max(0, Math.min(from, n));
    let k = 0;
    for (; srcN > BRANCH; k++) {
      const len = Math.ceil(srcN / BRANCH);
      let lv = this.levels[k];
      if (!lv || lv.min.length < len) {
        const cap = Math.max(64, 2 ** Math.ceil(Math.log2(len)));
        const min = new Float64Array(cap);
        const max = new Float64Array(cap);
        if (lv) {
          min.set(lv.min.subarray(0, lv.len));
          max.set(lv.max.subarray(0, lv.len));
        }
        lv = this.levels[k] = { min, max, len: lv ? lv.len : 0, size: BRANCH ** (k + 1) };
      }
      const first = Math.floor(f / BRANCH);
      for (let j = first; j < len; j++) {
        let mn = Infinity;
        let mx = -Infinity;
        const end = Math.min(srcN, (j + 1) * BRANCH);
        for (let i = j * BRANCH; i < end; i++) {
          const a = srcLo[i];
          const b = srcHi[i];
          if (a < mn) mn = a;
          if (b > mx) mx = b;
        }
        lv.min[j] = mn;
        lv.max[j] = mx;
      }
      lv.len = len;
      srcLo = lv.min;
      srcHi = lv.max;
      srcN = len;
      f = first;
    }
    this.levels.length = k;
  }

  /**
   * Min and max over the closed range [from, to]; null if there are no values.
   * @returns {{min: number, max: number} | null}
   */
  query(lo, hi, from, to) {
    let a = Math.max(0, from);
    let b = Math.min(this.n - 1, to) + 1;
    if (b <= a) return null;
    let mn = Infinity;
    let mx = -Infinity;
    let srcLo = lo;
    let srcHi = hi;
    const top = this.levels.length;
    for (let k = 0; ; k++) {
      const aEnd = k === top ? b : Math.min(b, Math.ceil(a / BRANCH) * BRANCH);
      for (let i = a; i < aEnd; i++) {
        const u = srcLo[i];
        const w = srcHi[i];
        if (u < mn) mn = u;
        if (w > mx) mx = w;
      }
      if (aEnd >= b) break;
      const bStart = Math.max(aEnd, Math.floor(b / BRANCH) * BRANCH);
      for (let i = bStart; i < b; i++) {
        const u = srcLo[i];
        const w = srcHi[i];
        if (u < mn) mn = u;
        if (w > mx) mx = w;
      }
      a = aEnd / BRANCH;
      b = bStart / BRANCH;
      if (a >= b) break;
      srcLo = this.levels[k].min;
      srcHi = this.levels[k].max;
    }
    return mn <= mx ? { min: mn, max: mx } : null;
  }

  /**
   * Enumerate, in ascending order, every i in [from, to] with hi[i] >= threshold.
   * Blocks whose max is below the threshold are skipped whole, so picking
   * "only the large ones" out of millions costs work proportional to the number picked.
   * Stops early when cb returns false.
   */
  forEachAbove(hi, from, to, threshold, cb) {
    const a = Math.max(0, from);
    const b = Math.min(this.n - 1, to);
    if (b < a) return;
    const levels = this.levels;
    let stop = false;
    const visit = (k, j) => {
      if (k < 0) {
        if (hi[j] >= threshold && cb(j) === false) stop = true;
        return;
      }
      const lv = levels[k];
      const size = lv.size;
      if (j * size > b || (j + 1) * size - 1 < a || !(lv.max[j] >= threshold)) return;
      const end = Math.min(k > 0 ? levels[k - 1].len : this.n, (j + 1) * BRANCH);
      for (let c = j * BRANCH; c < end && !stop; c++) {
        if (k === 0 && (c < a || c > b)) continue;
        visit(k - 1, c);
      }
    };
    const top = levels.length - 1;
    if (top < 0) {
      for (let i = a; i <= b && !stop; i++) visit(-1, i);
      return;
    }
    const size = levels[top].size;
    for (let j = Math.floor(a / size); j <= Math.floor(b / size) && j < levels[top].len && !stop; j++) visit(top, j);
  }

  /**
   * Coarsest level whose block size is at most maxSize; null if there is none.
   */
  pick(maxSize) {
    let found = null;
    for (const lv of this.levels) {
      if (lv.size <= maxSize) found = lv;
      else break;
    }
    return found;
  }
}
