import { BarData } from '../core/BarData.js';

const SEC = 1000;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Timeframe definitions.
 *   ticks: N  … one bar per N ticks (ticks: 1 is raw ticks)
 *   ms        … fixed-length time bucket
 *   unit      … 'week' | 'month' follow the calendar
 * label / short / group are { ja, en } objects that go through t() when displayed
 */
const GROUPS = {
  tick: { ja: 'ティック', en: 'Ticks' },
  sec: { ja: '秒', en: 'Seconds' },
  min: { ja: '分', en: 'Minutes' },
  hour: { ja: '時間', en: 'Hours' },
  day: { ja: '日以上', en: 'Daily and up' },
};
const L = (ja, en) => ({ ja, en });

export const TIMEFRAMES = [
  { id: 'tick', label: L('ティック', 'Tick'), short: L('T', 'T'), ticks: 1, group: GROUPS.tick },
  { id: '10t', label: L('10ティック', '10 ticks'), short: L('10T', '10T'), ticks: 10, group: GROUPS.tick },
  { id: '100t', label: L('100ティック', '100 ticks'), short: L('100T', '100T'), ticks: 100, group: GROUPS.tick },
  { id: '1000t', label: L('1000ティック', '1000 ticks'), short: L('1000T', '1000T'), ticks: 1000, group: GROUPS.tick },
  { id: '1s', label: L('1秒', '1 second'), short: L('1秒', '1s'), ms: SEC, group: GROUPS.sec },
  { id: '5s', label: L('5秒', '5 seconds'), short: L('5秒', '5s'), ms: 5 * SEC, group: GROUPS.sec },
  { id: '15s', label: L('15秒', '15 seconds'), short: L('15秒', '15s'), ms: 15 * SEC, group: GROUPS.sec },
  { id: '1m', label: L('1分', '1 minute'), short: L('1分', '1m'), ms: MIN, group: GROUPS.min },
  { id: '5m', label: L('5分', '5 minutes'), short: L('5分', '5m'), ms: 5 * MIN, group: GROUPS.min },
  { id: '15m', label: L('15分', '15 minutes'), short: L('15分', '15m'), ms: 15 * MIN, group: GROUPS.min },
  { id: '30m', label: L('30分', '30 minutes'), short: L('30分', '30m'), ms: 30 * MIN, group: GROUPS.min },
  { id: '1h', label: L('1時間', '1 hour'), short: L('1時間', '1h'), ms: HOUR, group: GROUPS.hour },
  { id: '4h', label: L('4時間', '4 hours'), short: L('4時間', '4h'), ms: 4 * HOUR, group: GROUPS.hour },
  { id: '1D', label: L('日足', 'Daily'), short: L('日', 'D'), ms: DAY, group: GROUPS.day },
  { id: '1W', label: L('週足', 'Weekly'), short: L('週', 'W'), ms: 7 * DAY, unit: 'week', group: GROUPS.day },
  { id: '1M', label: L('月足', 'Monthly'), short: L('月', 'M'), ms: 30 * DAY, unit: 'month', group: GROUPS.day },
];

export const timeframeById = new Map(TIMEFRAMES.map((tf) => [tf.id, tf]));

/**
 * Start time of the bucket that t belongs to. Days, weeks and months follow the calendar shifted by offset (ms).
 */
export function bucketStart(t, tf, offset = 0) {
  if (tf.unit === 'month') {
    const d = new Date(t + offset);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - offset;
  }
  if (tf.unit === 'week') {
    const day = Math.floor((t + offset) / DAY);
    const sinceMonday = (((day + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday
    return (day - sinceMonday) * DAY - offset;
  }
  if (tf.ms >= DAY) return Math.floor((t + offset) / tf.ms) * tf.ms - offset;
  return Math.floor(t / tf.ms) * tf.ms;
}

/**
 * Aggregate finer data into time buckets. `sources` is a list of BarData in time order
 * (so coarse old data and fine recent data can be chained).
 */
export function resample(sources, tf, offset = 0) {
  const total = sources.reduce((s, d) => s + d.length, 0);
  const out = new BarData(Math.max(64, Math.ceil(total / 2)));
  let cur = NaN;
  let o = 0;
  let h = 0;
  let l = 0;
  let c = 0;
  let v = 0;
  for (const src of sources) {
    const { time, open, high, low, close, volume } = src;
    for (let i = 0, n = src.length; i < n; i++) {
      const b = bucketStart(time[i], tf, offset);
      if (b !== cur) {
        if (cur === cur) out.push(cur, o, h, l, c, v);
        cur = b;
        o = open[i];
        h = high[i];
        l = low[i];
        v = 0;
      } else {
        if (high[i] > h) h = high[i];
        if (low[i] < l) l = low[i];
      }
      c = close[i];
      v += volume[i];
    }
  }
  if (cur === cur) out.push(cur, o, h, l, c, v);
  return out;
}

/** Aggregate every `count` ticks into one bar (tick bars). */
export function aggregateTicks(ticks, count) {
  const n = ticks.length;
  const out = new BarData(Math.ceil(n / count) + 64);
  const { time, close, volume } = ticks;
  for (let s = 0; s < n; s += count) {
    const e = Math.min(n, s + count);
    let h = -Infinity;
    let l = Infinity;
    let v = 0;
    for (let i = s; i < e; i++) {
      const p = close[i];
      if (p > h) h = p;
      if (p < l) l = p;
      v += volume[i];
    }
    out.push(time[s], close[s], h, l, close[e - 1], v);
  }
  return out;
}

/**
 * Live aggregator: takes ticks one at a time and returns the bar being formed.
 * An initial state can be passed so it continues from the last bar of the history.
 */
export class Aggregator {
  /**
   * @param {object} tf timeframe
   * @param {number} offset time zone offset (ms)
   * @param {object|null} last last bar of the history
   * @param {number} filled for tick bars, how many ticks the last bar already holds
   */
  constructor(tf, offset = 0, last = null, filled = 0) {
    this.tf = tf;
    this.offset = offset;
    this.bar = last ? { ...last } : null;
    this.filled = tf.ticks ? filled : 0;
    if (tf.ticks && filled === 0) this.bar = null;
  }

  /** @returns {{bar: object, isNew: boolean}} */
  add(time, price, size) {
    const tf = this.tf;
    let isNew;
    if (tf.ticks) {
      isNew = !this.bar || this.filled >= tf.ticks;
      if (isNew) this.filled = 0;
      this.filled++;
    } else {
      isNew = !this.bar || bucketStart(time, tf, this.offset) > this.bar.time;
      if (isNew) time = bucketStart(time, tf, this.offset);
    }
    if (isNew) {
      this.bar = { time, open: price, high: price, low: price, close: price, volume: size };
    } else {
      const b = this.bar;
      if (price > b.high) b.high = price;
      if (price < b.low) b.low = price;
      b.close = price;
      b.volume += size;
    }
    return { bar: this.bar, isNew };
  }
}
