import { formatMark } from './format.js';

const SEC = 1000;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Tick weights. Larger means a more important boundary. */
export const LEVELS = [70, 60, 50, 44, 43, 42, 41, 34, 33, 32, 31, 24, 23, 22, 21];
const SUBSECOND = 10;

/**
 * From the time difference to the previous bar, return the weight of the boundary this bar starts.
 * year > month > day > 12 hours > … > minute > second > sub-second.
 */
export function markWeight(t, prev, offset) {
  if (Math.floor(t / SEC) === Math.floor(prev / SEC)) return SUBSECOND;
  const T = t + offset;
  const P = prev + offset;
  if (Math.floor(T / DAY) !== Math.floor(P / DAY)) {
    const a = new Date(T);
    const b = new Date(P);
    if (a.getUTCFullYear() !== b.getUTCFullYear()) return 70;
    if (a.getUTCMonth() !== b.getUTCMonth()) return 60;
    return 50;
  }
  const h = Math.floor(T / HOUR);
  if (h !== Math.floor(P / HOUR)) {
    const hh = ((h % 24) + 24) % 24;
    return hh % 12 === 0 ? 44 : hh % 6 === 0 ? 43 : hh % 3 === 0 ? 42 : 41;
  }
  const m = Math.floor(T / MIN);
  if (m !== Math.floor(P / MIN)) {
    const mm = ((m % 60) + 60) % 60;
    return mm % 30 === 0 ? 34 : mm % 15 === 0 ? 33 : mm % 5 === 0 ? 32 : 31;
  }
  const s = ((Math.floor(T / SEC) % 60) + 60) % 60;
  return s % 30 === 0 ? 24 : s % 10 === 0 ? 23 : s % 5 === 0 ? 22 : 21;
}

function lowerBound(list, v) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Tick selection for the time axis.
 *
 * Bars are evenly spaced (time gaps collapse), so ticks sit on the bars that start a boundary.
 * Each weight keeps an ascending list of indices; the visible range is cut out by binary search
 * and ticks are placed greedily, heaviest first. Even with millions of bars a frame costs about one screen width of work.
 */
export class TimeMarks {
  constructor() {
    this.lists = new Map(LEVELS.map((lv) => [lv, []]));
    this.n = 0;
    this.offset = 0;
    /**
     * Optional label override: (time, level) => string. Return null or undefined to keep the built-in text.
     * @type {((time: number, level: number) => (string | null | undefined)) | null}
     */
    this.format = null;
    this.#grid = new Float64Array(64);
  }

  #grid;

  rebuild(data, offset) {
    this.offset = offset;
    for (const list of this.lists.values()) list.length = 0;
    this.n = 0;
    this.extend(data);
  }

  /** Take in only what was appended at the tail. */
  extend(data) {
    const time = data.time;
    const n = data.length;
    const off = this.offset;
    for (let i = this.n; i < n; i++) {
      const w = i === 0 ? 50 : markWeight(time[i], time[i - 1], off);
      if (w !== SUBSECOND) this.lists.get(w).push(i);
    }
    this.n = n;
  }

  /**
   * Choose the ticks for the visible range.
   * @param {{time: Float64Array}} data
   * @param {number} from first visible index
   * @param {number} to   last visible index
   * @param {number} x0   x = x0 + i * spacing
   * @param {number} spacing bar spacing (px)
   * @param {number} width  plot width (px)
   * @param {number} minGap minimum gap between ticks (px)
   * @returns {{index:number, x:number, level:number, label:string}[]}
   */
  select(data, from, to, x0, spacing, width, minGap = 76) {
    const marks = [];
    const slots = Math.ceil(width / minGap) + 3;
    if (this.#grid.length < slots) this.#grid = new Float64Array(slots * 2);
    const grid = this.#grid;
    grid.fill(NaN, 0, slots);
    const enough = width / minGap / 2;

    const place = (i, level) => {
      const x = x0 + i * spacing;
      if (x < 0 || x > width) return;
      const s = Math.floor(x / minGap) + 1;
      if (Math.abs(grid[s] - x) < minGap || Math.abs(grid[s - 1] - x) < minGap || Math.abs(grid[s + 1] - x) < minGap) return;
      grid[s] = x;
      marks.push({ index: i, x, level, label: '' });
    };

    for (const level of LEVELS) {
      const list = this.lists.get(level);
      for (let j = lowerBound(list, from); j < list.length && list[j] <= to; j++) place(list[j], level);
      if (marks.length >= enough) break;
    }
    // When many bars share one second (zoomed-in ticks), fill the gaps with millisecond labels.
    if (marks.length < enough && to - from <= 4000) {
      for (let i = from; i <= to; i++) place(i, SUBSECOND);
    }
    for (const m of marks) {
      const time = data.time[m.index];
      m.label = this.format?.(time, m.level) ?? formatMark(time, this.offset, m.level);
    }
    return marks;
  }
}
