import { BarData } from '../core/BarData.js';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Seeded pseudo-random numbers (mulberry32). The same seed gives the same sequence. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Trading calendars. session(t) returns the session [open, close) that contains t, or the next one.
 * yearMs is trading time per year, used to convert annualized volatility.
 */
export const calendars = {
  // 24 hours, 365 days (crypto-style)
  '24x7': {
    yearMs: 365 * DAY,
    session: () => [-Infinity, Infinity],
  },
  // 24 hours on weekdays (FX-style): Monday 00:00 UTC to Saturday 00:00 UTC
  '24x5': {
    yearMs: 260 * DAY,
    session(t) {
      const day = Math.floor(t / DAY);
      const wd = (((day + 4) % 7) + 7) % 7; // 0 = Sunday
      const monday = wd === 0 ? day + 1 : wd === 6 ? day + 2 : day - (wd - 1);
      return [monday * DAY, (monday + 5) * DAY];
    },
  },
  // Weekdays 09:00–15:30 JST (equity-style)
  tse: {
    yearMs: 245 * 6.5 * HOUR,
    session(t) {
      for (let day = Math.floor(t / DAY); ; day++) {
        const wd = (((day + 4) % 7) + 7) % 7;
        const open = day * DAY;
        const close = open + 6.5 * HOUR;
        if (wd !== 0 && wd !== 6 && t < close) return [open, close];
      }
    },
  },
};

/**
 * Price simulator with a few realistic traits:
 *   - volatility swells and fades over time (clustering)
 *   - a slowly changing trend, with a gentle pull back toward a long-term level
 *   - activity that depends on the time of day, and rare jumps
 *   - more volume when the price moves more
 * It keeps its state, so history generation and the live feed form one continuous series.
 */
export class MarketSim {
  constructor({ seed = 1, price = 100, vol = 0.3, volume = 1000, precision = 2, calendar = '24x7' }) {
    this.rand = mulberry32(seed);
    this.cal = calendars[calendar];
    this.calendarId = calendar;
    this.vol = vol;
    this.volumeBase = volume;
    this.tick = 10 ** -precision;
    this.precision = precision;
    this.x = Math.log(price); // log price
    this.x0 = this.x;
    this.v = 0; // log of the volatility multiplier
    this.m = 0; // trend (annualized)
    this.#spare = null;
  }

  #spare;

  /** Standard normal random number (Box–Muller). */
  gauss() {
    if (this.#spare !== null) {
      const s = this.#spare;
      this.#spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = this.rand();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 6.283185307179586 * this.rand();
    this.#spare = r * Math.sin(th);
    return r * Math.cos(th);
  }

  round(p) {
    return +(Math.round(p / this.tick) * this.tick).toFixed(this.precision);
  }

  get price() {
    return this.round(Math.exp(this.x));
  }

  /** Activity by time of day. */
  #season(t) {
    if (this.calendarId === 'tse') {
      const tau = (t % DAY) / (6.5 * HOUR);
      return 0.75 + 0.9 * (2 * tau - 1) ** 2;
    }
    return 1 + 0.3 * Math.cos((6.283185307179586 * ((t % DAY) / HOUR - 14)) / 24);
  }

  /** Advance by dt (ms). Returns the log return. */
  step(t, dt) {
    const year = this.cal.yearMs;
    const g = () => this.gauss();
    // Time constants are fractions of "one year of trading time" (so markets with different closing hours behave alike).
    const kv = dt / (year / 400);
    this.v += -this.v * kv + 0.45 * Math.sqrt(kv) * g();
    const km = dt / (year / 20);
    this.m += -this.m * km + 0.5 * Math.sqrt(2 * km) * g();
    let r = (this.m * dt) / year - (this.x - this.x0) * 1.2 * (dt / year);
    r += this.vol * Math.sqrt(dt / year) * Math.exp(this.v) * this.#season(t) * g();
    if (this.rand() < dt / (year / 120)) r += this.vol * Math.sqrt(1 / 2000) * g() * 2.5;
    this.x += r;
    return r;
  }

  /** Opening gap. */
  gap() {
    this.x += this.vol * Math.sqrt((2 * HOUR) / this.cal.yearMs) * this.gauss();
  }

  /** Volume over dt. */
  size(t, dt, absReturn = 0) {
    const expected = this.vol * Math.sqrt(dt / this.cal.yearMs);
    const activity = Math.exp(1.2 * this.v) * this.#season(t) ** 2 * (1 + 5 * (absReturn / (expected || 1)));
    const noise = Math.exp(0.35 * this.gauss());
    return this.volumeBase * (dt / MIN) * activity * noise * 0.3;
  }

  /** Make one bar for [t, t+dt). */
  bar(t, dt, opening = false) {
    if (opening) this.gap();
    const steps = dt <= MIN ? 4 : 12;
    const part = dt / steps;
    const open = this.x;
    let hi = open;
    let lo = open;
    let abs = 0;
    for (let k = 0; k < steps; k++) {
      abs += Math.abs(this.step(t + k * part, part));
      if (this.x > hi) hi = this.x;
      if (this.x < lo) lo = this.x;
    }
    const o = this.round(Math.exp(open));
    const c = this.round(Math.exp(this.x));
    const h = Math.max(o, c, this.round(Math.exp(hi)));
    const l = Math.min(o, c, this.round(Math.exp(lo)));
    return { open: o, high: h, low: l, close: c, volume: this.#roundSize(this.size(t, dt, abs / Math.sqrt(steps))) };
  }

  #roundSize(v) {
    return this.volumeBase >= 100 ? Math.max(1, Math.round(v)) : Math.max(0.001, +v.toFixed(3));
  }

  roundSize(v) {
    return this.#roundSize(v);
  }
}

/** Create an independent random source from a seed and a key (the same key always gives the same sequence). */
function rngFor(seed, key) {
  const rand = mulberry32((Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(key | 0, 0x85ebca6b)) >>> 0);
  let spare = null;
  const gauss = () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 6.283185307179586 * rand();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
  return { rand, gauss };
}

/**
 * Build a price path that satisfies an OHLC bar.
 * Writes `count` points to `out`: starts at the open, ends at the close, and touches the high and low exactly.
 *
 * Method: pin a free random walk to the end point (a Brownian bridge), then stretch the parts that go
 * above / below the open and close so that they reach the high / low.
 * A side that must not be exceeded is reflected at a wall. The shape stays a random walk,
 * so there are none of the unnatural steps that connecting points with straight lines would give.
 */
export function bridgePath(o, h, l, c, count, gauss, round, out = []) {
  out.length = count;
  const N = count - 1;
  if (N < 3 || h - l <= 0) {
    for (let j = 0; j < count; j++) out[j] = j === N && N > 0 ? c : o;
    return out;
  }
  const a = o - l;
  const b = h - o;
  const e = c - o;
  const eps = (h - l) * 1e-9;

  // 1) Make a free walk and add a linear term so that it ends at E.
  const E = (e / (h - l)) * 1.6 * Math.sqrt(N);
  let w = 0;
  out[0] = 0;
  for (let j = 1; j <= N; j++) out[j] = w += gauss();
  for (let j = 1; j <= N; j++) out[j] += (E - w) * (j / N);

  const loK = Math.min(0, E);
  const hiK = Math.max(0, E);
  const loT = Math.min(0, e);
  const hiT = Math.max(0, e);
  const needLow = -a < loT - eps; // does the path need to go below both the open and the close?
  const needHigh = b > hiT + eps;

  // 2) Reflect at the sides that must not be exceeded.
  if (!needLow && !needHigh) {
    const span = hiK - loK;
    for (let j = 1; j < N; j++) {
      if (span <= 0) {
        out[j] = loK;
        continue;
      }
      let u = (out[j] - loK) % (2 * span);
      if (u < 0) u += 2 * span;
      out[j] = loK + (u > span ? 2 * span - u : u);
    }
  } else if (!needLow) {
    for (let j = 1; j < N; j++) if (out[j] < loK) out[j] = 2 * loK - out[j];
  } else if (!needHigh) {
    for (let j = 1; j < N; j++) if (out[j] > hiK) out[j] = 2 * hiK - out[j];
  }

  // 3) Where an excursion is required but missing, add a peak / trough to create it.
  const half = Math.max(1, Math.floor(N * 0.2));
  const tent = (center, sign) => {
    const depth = Math.abs(out[center] - (sign < 0 ? loK : hiK)) + 0.5 * Math.sqrt(N);
    for (let j = Math.max(1, center - half + 1); j < Math.min(N, center + half); j++) {
      out[j] += sign * depth * (1 - Math.abs(j - center) / half);
    }
  };
  let mn = Infinity;
  let mx = -Infinity;
  let jmn = 0;
  let jmx = 0;
  const scan = () => {
    mn = Infinity;
    mx = -Infinity;
    for (let j = 0; j <= N; j++) {
      if (out[j] < mn) {
        mn = out[j];
        jmn = j;
      }
      if (out[j] > mx) {
        mx = out[j];
        jmx = j;
      }
    }
  };
  scan();
  // Adding one can erase the other extreme, so check until both are present.
  for (let pass = 0; pass < 3; pass++) {
    const lowOk = !needLow || mn < loK - 1e-9;
    const highOk = !needHigh || mx > hiK + 1e-9;
    if (lowOk && highOk) break;
    if (!lowOk) tent(Math.max(1, Math.round(N * 0.3)), -1);
    else tent(Math.min(N - 1, Math.round(N * 0.7)), 1);
    scan();
  }

  // 4) Stretch the values onto low / (open, close) / high.
  const sLo = needLow ? (loT + a) / (loK - mn) : 0;
  const sMid = hiK > loK ? (hiT - loT) / (hiK - loK) : 0;
  const sHi = needHigh ? (b - hiT) / (mx - hiK) : 0;
  for (let j = 1; j < N; j++) {
    const v = out[j];
    const mapped = v < loK ? loT + (v - loK) * sLo : v > hiK ? hiT + (v - hiK) * sHi : loT + (v - loK) * sMid;
    out[j] = Math.min(h, Math.max(l, round(o + mapped)));
  }
  out[0] = o;
  out[N] = c;
  if (needLow) out[jmn] = l;
  if (needHigh) out[jmx] = h;
  return out;
}

/**
 * Generate hourly history. It advances hour by hour from a fixed start,
 * so the past is identical whenever it is loaded (only the tail grows).
 */
export function generateHistory(sim, { start, end }) {
  const bars = new BarData(48_000);
  const cal = sim.cal;
  let t = start;
  let opening = false;
  while (t < end) {
    const [open, close] = cal.session(t);
    if (t < open) {
      t = open;
      opening = true;
      if (t >= end) break;
    }
    const barEnd = Math.min(Math.floor(t / HOUR) * HOUR + HOUR, close, end);
    const b = sim.bar(t, barEnd - t, opening);
    bars.push(t, b.open, b.high, b.low, b.close, b.volume);
    t = barEnd;
    opening = false;
  }
  return bars;
}

/**
 * Split coarse bars into finer ones (hourly → 1-minute).
 * Each bar is cut along a path that satisfies its OHLC, so re-aggregating gives the original bars back.
 * The random seed is per bar, so the same bar always expands to the same contents.
 * @param {BarData} bars   source bars
 * @param {number} from    index to start splitting from
 * @param {(i:number)=>number} spanOf length of bar i (ms)
 * @param {number} step    interval of the finer bars (ms)
 */
export function expandBars(sim, seed, bars, from, spanOf, step = MIN) {
  const n = bars.length;
  const out = new BarData(Math.max(64, (n - from) * 60));
  const SUB = 4;
  const path = [];
  const weights = [];
  for (let i = from; i < n; i++) {
    const t0 = bars.time[i];
    const pieces = Math.max(1, Math.ceil(spanOf(i) / step));
    const { gauss } = rngFor(seed, Math.floor(t0 / step));
    bridgePath(bars.open[i], bars.high[i], bars.low[i], bars.close[i], pieces * SUB + 1, gauss, (p) => sim.round(p), path);
    let wsum = 0;
    for (let k = 0; k < pieces; k++) wsum += weights[k] = Math.exp(0.6 * gauss());
    for (let k = 0; k < pieces; k++) {
      let hi = -Infinity;
      let lo = Infinity;
      for (let j = k * SUB; j <= (k + 1) * SUB; j++) {
        if (path[j] > hi) hi = path[j];
        if (path[j] < lo) lo = path[j];
      }
      out.push(t0 + k * step, path[k * SUB], hi, lo, path[(k + 1) * SUB], sim.roundSize((bars.volume[i] * weights[k]) / wsum));
    }
  }
  return out;
}

/**
 * Synthesize ticks from 1-minute bars. The trades match each bar's OHLC,
 * so re-aggregating the ticks reproduces the 1-minute bars (volume differs only by rounding).
 * @param {BarData} bars 1-minute bars
 * @param {number} from  index of the first bar to synthesize
 * @param {number} endTime when the last bar actually ends (for the bar still forming)
 * @param {number} perBar average ticks per bar
 */
export function synthesizeTicks(sim, seed, bars, from, endTime, perBar = 600) {
  const n = bars.length;
  const ticks = BarData.ticks(Math.ceil((n - from) * perBar * 1.1) + 1024);
  let avgVol = 0;
  for (let i = from; i < n; i++) avgVol += bars.volume[i];
  avgVol /= Math.max(1, n - from);
  const path = [];
  const gaps = [];
  const weights = [];
  const round = (p) => sim.round(p);

  for (let i = from; i < n; i++) {
    const t0 = bars.time[i];
    const span = Math.max(1000, Math.min(MIN, (i === n - 1 ? endTime : t0 + MIN) - t0));
    const vol = bars.volume[i];
    const count = Math.max(8, Math.min(4000, Math.round(perBar * (vol / (avgVol || 1)) ** 0.7 * (span / MIN))));
    const { rand, gauss } = rngFor(seed ^ 0x51ed, Math.floor(t0 / MIN));
    bridgePath(bars.open[i], bars.high[i], bars.low[i], bars.close[i], count, gauss, round, path);

    // Irregular timestamps; sizes are distributed so that they sum to the bar volume.
    let gsum = 0;
    let wsum = 0;
    for (let j = 0; j < count; j++) {
      gsum += gaps[j] = -Math.log(1 - rand() * 0.999);
      wsum += weights[j] = Math.exp(1.1 * gauss());
    }
    let acc = 0;
    for (let j = 0; j < count; j++) {
      acc += gaps[j];
      const time = t0 + Math.min(span - 1, Math.floor((acc / gsum) * (span - 1)));
      const p = path[j];
      ticks.push(time, p, p, p, p, sim.roundSize((vol * weights[j]) / wsum));
    }
  }
  return ticks;
}
