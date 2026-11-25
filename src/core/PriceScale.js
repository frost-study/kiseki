import { formatPercent } from './format.js';

/** A "nice" step size (1 / 2 / 2.5 / 5 × 10^n). */
export function niceStep(range, maxTicks) {
  const raw = range / Math.max(1, maxTicks);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * pow;
}

/** Nice tick values inside [lo, hi]. */
export function linearTicks(lo, hi, maxTicks, minStep = 0) {
  if (!(hi > lo)) return [];
  const step = Math.max(niceStep(hi - lo, maxTicks), minStep);
  const out = [];
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  const digits = Math.max(0, Math.ceil(-Math.log10(step)) + 2);
  for (let k = first; k <= last; k++) out.push(+(k * step).toFixed(digits));
  return out;
}

/**
 * Price scale: maps values to y coordinates.
 *
 * mode:
 *   linear  — as is
 *   log     — logarithmic; equal percentage moves get equal heights
 *   percent — change relative to the first visible value (base)
 *
 * Internally values live in a transformed space (T), and [lo, hi] is mapped onto the pane height with margins.
 */
export class PriceScale {
  constructor({ top = 0.1, bottom = 0.1, visible = true } = {}) {
    this.mode = 'linear';
    this.auto = true;
    this.lo = 0;
    this.hi = 1;
    this.marginTop = top;
    this.marginBottom = bottom;
    this.height = 1;
    this.base = 1;
    this.visible = visible;
    /** Value formatter (replaced by the pane's primary series). */
    this.format = (v) => v.toFixed(2);
    /** Smallest tick step (so ticks never get finer than the price tick size). */
    this.minStep = 0;
    /**
     * Optional: labels for all ticks at once, (values) => labels, so a host can give them one precision.
     * A missing result (or a missing entry) keeps the `format` text. Not used in percent mode.
     * @type {((values: number[]) => (string[] | null | undefined)) | null}
     */
    this.formatTicks = null;
    this.#k = 1;
    this.#y0 = 0;
  }

  #k;
  #y0;

  T(v) {
    if (this.mode === 'log') return Math.log10(v > 0 ? v : 1e-12);
    if (this.mode === 'percent') return (v / this.base - 1) * 100;
    return v;
  }

  Tinv(u) {
    if (this.mode === 'log') return 10 ** u;
    if (this.mode === 'percent') return (u / 100 + 1) * this.base;
    return u;
  }

  /** value → y (px, 0 at the top of the pane) */
  y(v) {
    return this.#y0 + (this.hi - this.T(v)) * this.#k;
  }

  /** y → value */
  value(y) {
    return this.Tinv(this.hi - (y - this.#y0) / this.#k);
  }

  /** Refresh the coefficients after the range, height or mode changes. */
  refresh() {
    const usable = Math.max(1, this.height * (1 - this.marginTop - this.marginBottom));
    this.#y0 = this.height * this.marginTop;
    this.#k = usable / (this.hi - this.lo || 1);
  }

  setHeight(h) {
    this.height = Math.max(1, h);
    this.refresh();
  }

  /**
   * Fit to a raw value range [min, max] (autoscale).
   */
  fit(min, max) {
    if (this.mode === 'log' && min <= 0) min = max > 0 ? max / 1000 : 1e-6;
    let lo = this.T(min);
    let hi = this.T(max);
    if (!(lo === lo && hi === hi) || !Number.isFinite(lo) || !Number.isFinite(hi)) return;
    if (hi - lo < 1e-12) {
      const pad = Math.abs(hi) * 0.01 || 1;
      lo -= pad;
      hi += pad;
    }
    this.lo = lo;
    this.hi = hi;
    this.refresh();
  }

  /** Zoom vertically around the center (axis drag). */
  zoom(factor) {
    const mid = (this.lo + this.hi) / 2;
    const half = ((this.hi - this.lo) / 2) * factor;
    if (half < 1e-10) return;
    this.auto = false;
    this.lo = mid - half;
    this.hi = mid + half;
    this.refresh();
  }

  /** Shift vertically by dy px. */
  pan(dy) {
    const d = dy / this.#k;
    this.auto = false;
    this.lo += d;
    this.hi += d;
    this.refresh();
  }

  setMode(mode) {
    if (mode === this.mode) return;
    // A manual range cannot carry over between modes, so go back to auto.
    this.mode = mode;
    this.auto = true;
  }

  /** Label text for the axis and the crosshair. */
  label(v) {
    return this.mode === 'percent' ? formatPercent(this.T(v)) : this.format(v);
  }

  /**
   * Ticks.
   * @returns {{y:number, value:number, label:string}[]}
   */
  ticks(minGap = 44) {
    const h = this.height;
    const maxTicks = Math.max(2, Math.floor(h / minGap));
    const uTop = this.hi + this.#y0 / this.#k;
    const uBottom = this.hi - (h - this.#y0) / this.#k;
    let values;
    if (this.mode === 'log') {
      values = this.#logTicks(uBottom, uTop, maxTicks);
    } else if (this.mode === 'percent') {
      // Use enough decimals to express the step (3 digits for a 0.025% step).
      const step = niceStep(uTop - uBottom, maxTicks);
      const exp = Math.floor(Math.log10(step));
      const digits = Math.max(1, -exp + (Math.round(step / 10 ** exp) === 3 || step / 10 ** exp === 2.5 ? 1 : 0));
      return linearTicks(uBottom, uTop, maxTicks).map((u) => ({
        y: this.#y0 + (this.hi - u) * this.#k,
        value: this.Tinv(u),
        label: formatPercent(u, digits),
      }));
    } else {
      values = linearTicks(uBottom, uTop, maxTicks, this.minStep);
    }
    const labels = this.formatTicks?.(values);
    return values.map((v, i) => ({ y: this.y(v), value: v, label: labels?.[i] ?? this.format(v) }));
  }

  #logTicks(uLo, uHi, maxTicks) {
    const span = uHi - uLo;
    // A range of less than one decade reads fine with linear ticks.
    if (span < 0.7) return linearTicks(10 ** uLo, 10 ** uHi, maxTicks);
    const first = Math.floor(uLo);
    const last = Math.ceil(uHi);
    for (const mults of [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 5], [1, 3], [1]]) {
      const out = [];
      for (let e = first; e <= last; e++) {
        for (const m of mults) {
          const u = e + Math.log10(m);
          if (u >= uLo && u <= uHi) out.push(m * 10 ** e);
        }
      }
      if (out.length <= maxTicks) return out;
    }
    const out = [];
    const stride = Math.ceil((last - first) / maxTicks);
    for (let e = first; e <= last; e += stride) if (e >= uLo && e <= uHi) out.push(10 ** e);
    return out;
  }
}
