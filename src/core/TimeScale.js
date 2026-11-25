import { TimeMarks } from './TimeMarks.js';

/**
 * Time axis. Bars are laid out by index at even spacing (time gaps such as market closes collapse).
 *
 *   x(i) = width - (rightIndex - i + 0.5) * barSpacing
 *
 * rightIndex is the (possibly fractional) index of the bar at the right edge of the plot.
 * It can point past the data (the future), so leading spans and drawings can extend there.
 */
export class TimeScale {
  constructor() {
    this.barSpacing = 8;
    this.rightIndex = 0;
    this.width = 0;
    this.n = 0;
    this.maxSpacing = 80;
    this.rightOffset = 6;
    this.marks = new TimeMarks();
    /** @type {import('./BarData.js').BarData | null} */
    this.data = null;
  }

  get minSpacing() {
    return Math.min(0.5, this.width / (this.n + this.rightOffset + 4));
  }

  /** x = x0 + i * barSpacing */
  get x0() {
    return this.width - (this.rightIndex + 0.5) * this.barSpacing;
  }

  x(i) {
    return this.width - (this.rightIndex - i + 0.5) * this.barSpacing;
  }

  /** (Fractional) index of the bar at an x coordinate. */
  indexAt(x) {
    return this.rightIndex + 0.5 - (this.width - x) / this.barSpacing;
  }

  /** Visible index range [from, to] (fractional, not clamped to the data). */
  visibleRange() {
    return [this.indexAt(0) - 0.5, this.rightIndex + 0.5];
  }

  setData(data, utcOffset) {
    this.data = data;
    this.n = data.length;
    this.marks.rebuild(data, utcOffset);
  }

  /** Call when the data grew or its tail was updated. */
  sync() {
    const n = this.data.length;
    const added = n - this.n;
    if (added > 0) {
      // If the latest bar is in view, keep the view following it.
      if (this.rightIndex >= this.n - 1) this.rightIndex += added;
      this.marks.extend(this.data);
    }
    this.n = n;
  }

  setWidth(w) {
    this.width = Math.max(1, w);
  }

  clamp() {
    // Never lose the view to a broken value (NaN, zero or negative).
    if (!(this.barSpacing > 0)) this.barSpacing = 8;
    if (!Number.isFinite(this.rightIndex)) this.rightIndex = this.realtimeIndex;
    this.barSpacing = Math.min(this.maxSpacing, Math.max(this.minSpacing, this.barSpacing));
    const keep = Math.min(4, Math.max(0, this.n - 1));
    const visible = this.width / this.barSpacing;
    const min = keep - 0.5;
    const max = this.n - 1 - keep + visible - 0.5;
    this.rightIndex = Math.min(Math.max(this.rightIndex, min), Math.max(min, max));
  }

  /** Zoom keeping x fixed. */
  zoomAt(x, factor) {
    const anchor = this.indexAt(x);
    this.barSpacing = Math.min(this.maxSpacing, Math.max(this.minSpacing, this.barSpacing * factor));
    this.rightIndex = anchor - 0.5 + (this.width - x) / this.barSpacing;
    this.clamp();
  }

  scrollPx(dx) {
    this.rightIndex -= dx / this.barSpacing;
    this.clamp();
  }

  /** Position that puts the latest bar near the right edge. */
  get realtimeIndex() {
    return this.n - 1 + this.rightOffset;
  }

  get atRealtime() {
    return this.rightIndex >= this.n - 1;
  }

  /** View settings that fit all data. */
  fitTarget() {
    const barSpacing = Math.min(this.maxSpacing, this.width / (this.n + this.rightOffset));
    return { barSpacing, rightIndex: this.n - 1 + this.rightOffset * 0.5 };
  }

  /** View settings that show the latest `count` bars. */
  lastBarsTarget(count) {
    const barSpacing = Math.min(this.maxSpacing, Math.max(this.minSpacing, this.width / (count + this.rightOffset)));
    return { barSpacing, rightIndex: this.realtimeIndex };
  }

  /**
   * time → (fractional) index. Linear between bars; extrapolated by the bar interval outside the data.
   */
  timeToIndex(t) {
    const d = this.data;
    const n = this.n;
    if (!d || n === 0) return 0;
    const time = d.time;
    const step = d.interval;
    if (t <= time[0]) return (t - time[0]) / step;
    if (t >= time[n - 1]) return n - 1 + (t - time[n - 1]) / step;
    const i = d.lowerBound(t);
    if (time[i] === t) return i;
    const a = time[i - 1];
    return i - 1 + (t - a) / (time[i] - a);
  }

  /** (fractional) index → time, extrapolated outside the data. */
  indexToTime(i) {
    const d = this.data;
    const n = this.n;
    if (!d || n === 0) return 0;
    const time = d.time;
    const step = d.interval;
    if (i <= 0) return time[0] + i * step;
    if (i >= n - 1) return time[n - 1] + (i - (n - 1)) * step;
    const k = Math.floor(i);
    return time[k] + (i - k) * (time[k + 1] - time[k]);
  }
}
