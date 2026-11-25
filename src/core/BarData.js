import { MinMaxIndex } from './MinMaxIndex.js';

/**
 * Columnar OHLCV store.
 *
 * Each column is a Float64Array with spare capacity; only the first `length` entries are valid.
 * Millions of bars cause no GC pressure, and indicator math simply walks the arrays.
 *
 * Tick data is treated as degenerate bars where open = high = low = close.
 * BarData.ticks() shares one array between those four columns, so memory is one price column.
 */
export class BarData {
  /**
   * @param {number} capacity initial capacity
   * @param {{ aliased?: boolean }} [opts] aliased: share one array for O/H/L/C (for ticks)
   */
  constructor(capacity = 256, { aliased = false } = {}) {
    this.length = 0;
    this.capacity = 0;
    this.aliased = aliased;
    this.#alloc(Math.max(16, capacity));
    this.#index = new MinMaxIndex();
    this.#indexFrom = 0;
    this.#interval = 0;
  }

  #index;
  #indexFrom;
  #interval;

  /** Create a store for ticks (O/H/L/C shared). */
  static ticks(capacity = 1024) {
    return new BarData(capacity, { aliased: true });
  }

  /**
   * Build from an array of objects.
   * @param {{time:number, open:number, high:number, low:number, close:number, volume?:number}[]} rows
   */
  static from(rows) {
    const d = new BarData(rows.length);
    for (const r of rows) d.push(r.time, r.open, r.high, r.low, r.close, r.volume ?? 0);
    return d;
  }

  #alloc(cap) {
    const grow = (old) => {
      const a = new Float64Array(cap);
      if (old) a.set(old.subarray(0, this.length));
      return a;
    };
    this.time = grow(this.time);
    this.volume = grow(this.volume);
    if (this.aliased) {
      this.open = this.high = this.low = this.close = grow(this.close);
    } else {
      this.open = grow(this.open);
      this.high = grow(this.high);
      this.low = grow(this.low);
      this.close = grow(this.close);
    }
    this.capacity = cap;
  }

  /** Make sure at least n bars fit. */
  ensure(n) {
    if (n > this.capacity) this.#alloc(Math.max(n, this.#grown()));
  }

  /** Next capacity: double while small, then grow by 1.25x past a million bars (avoids doubling memory at multi-million sizes). */
  #grown() {
    return this.capacity < 1 << 20 ? this.capacity * 2 : Math.ceil(this.capacity * 1.25);
  }

  push(time, open, high, low, close, volume = 0) {
    const i = this.length;
    if (i === this.capacity) this.#alloc(this.#grown());
    this.time[i] = time;
    this.volume[i] = volume;
    if (this.aliased) {
      this.close[i] = close;
    } else {
      this.open[i] = open;
      this.high[i] = high;
      this.low[i] = low;
      this.close[i] = close;
    }
    this.length = i + 1;
    this.#interval = 0;
    return i;
  }

  /** Overwrite the last bar (updates to the bar that is still forming). */
  setLast(open, high, low, close, volume) {
    const i = this.length - 1;
    if (i < 0) return;
    if (this.aliased) {
      this.close[i] = close;
    } else {
      this.open[i] = open;
      this.high[i] = high;
      this.low[i] = low;
      this.close[i] = close;
    }
    if (volume !== undefined) this.volume[i] = volume;
    this.touch(i);
  }

  /** After writing to the arrays directly, report the first changed index. */
  touch(from) {
    if (from < this.#indexFrom) this.#indexFrom = from;
  }

  bar(i) {
    return {
      time: this.time[i],
      open: this.open[i],
      high: this.high[i],
      low: this.low[i],
      close: this.close[i],
      volume: this.volume[i],
    };
  }

  /**
   * Whether bar i is rising. For bars: close >= open. For ticks: higher than the previous trade;
   * on an unchanged price, look back until the price differs and carry that direction forward.
   */
  isUp(i) {
    const c = this.close;
    if (!this.aliased) return c[i] >= this.open[i];
    const p = c[i];
    for (let j = i - 1, stop = Math.max(0, i - 64); j >= stop; j--) {
      if (c[j] !== p) return p > c[j];
    }
    return true;
  }

  get lastTime() {
    return this.length ? this.time[this.length - 1] : NaN;
  }

  /** Smallest i with time[i] >= t (length if there is none). */
  lowerBound(t) {
    let lo = 0;
    let hi = this.length;
    const time = this.time;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (time[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Typical bar interval in ms: the median of the most recent time deltas. */
  get interval() {
    if (this.#interval) return this.#interval;
    const n = this.length;
    if (n < 2) return 60_000;
    const deltas = [];
    for (let i = Math.max(1, n - 120); i < n; i++) {
      const d = this.time[i] - this.time[i - 1];
      if (d > 0) deltas.push(d);
    }
    if (!deltas.length) return (this.#interval = 1);
    deltas.sort((a, b) => a - b);
    return (this.#interval = deltas[deltas.length >> 1]);
  }

  /** LOD index over low/high (updated incrementally, only when needed). */
  minmax() {
    if (this.#indexFrom < this.length || this.#index.n !== this.length) {
      const from = this.length < this.#index.n ? 0 : Math.min(this.#indexFrom, this.#index.n);
      this.#index.update(this.low, this.high, from, this.length);
      this.#indexFrom = this.length;
    }
    return this.#index;
  }

  /** Lowest low and highest high over the closed range [a, b]. */
  range(a, b) {
    return this.minmax().query(this.low, this.high, a, b);
  }

  /** A copy that keeps the contents. */
  clone() {
    const d = new BarData(Math.ceil(this.length * 1.05) + 64, { aliased: this.aliased });
    const n = this.length;
    d.time.set(this.time.subarray(0, n));
    d.volume.set(this.volume.subarray(0, n));
    d.close.set(this.close.subarray(0, n));
    if (!this.aliased) {
      d.open.set(this.open.subarray(0, n));
      d.high.set(this.high.subarray(0, n));
      d.low.set(this.low.subarray(0, n));
    }
    d.length = n;
    return d;
  }
}
