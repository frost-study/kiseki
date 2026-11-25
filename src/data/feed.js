import { t } from '../core/i18n.js';
import { MarketSim, expandBars, generateHistory, synthesizeTicks } from './simulator.js';
import { Aggregator, TIMEFRAMES, aggregateTicks, resample, timeframeById } from './timeframes.js';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Start of the synthetic history (a Monday). Keeping it fixed keeps the past stable. */
const EPOCH = Date.UTC(2022, 0, 3);

/** Fictional demo symbols. All prices are synthetic and unrelated to any real market. */
export const DEMO_SYMBOLS = [
  { id: 'MYTH/USD', description: { ja: 'ミス・コイン / 米ドル', en: 'Myth Coin / US Dollar' }, kind: { ja: '暗号資産型 · 24時間', en: 'crypto-style · 24/7' }, calendar: '24x7', price: 64_250, precision: 1, vol: 0.52, volume: 42, seed: 20261125 },
  { id: 'FABLE', description: { ja: 'フェイブル・ホールディングス', en: 'Fable Holdings' }, kind: { ja: '株式型 · 9:00–15:30', en: 'equity-style · 9:00–15:30' }, calendar: 'tse', price: 3_184, precision: 0, vol: 0.34, volume: 18_000, seed: 52 },
  { id: 'AUR/JPY', description: { ja: 'オーラム / 円', en: 'Aurum / Yen' }, kind: { ja: '為替型 · 平日24時間', en: 'FX-style · 24h on weekdays' }, calendar: '24x5', price: 152.4, precision: 3, vol: 0.1, volume: 900, seed: 7 },
  { id: 'NOVA', description: { ja: 'ノヴァ・ロボティクス', en: 'Nova Robotics' }, kind: { ja: '株式型 · 9:00–15:30', en: 'equity-style · 9:00–15:30' }, calendar: 'tse', price: 842.5, precision: 1, vol: 0.62, volume: 64_000, seed: 314 },
];

/**
 * A sample data feed (synthetic data). The chart itself knows nothing about this class.
 * To use real data, provide an object of the same shape:
 *
 *   symbols                          list of symbols [{ id, description, precision }]
 *   timeframes(symbolId)             timeframe ids available for that symbol
 *   async history(symbolId, tfId)    returns a BarData
 *   subscribe(symbolId, tfId, onBar) live updates via onBar(bar, isNew); returns an unsubscribe function
 */
export class DemoFeed {
  /**
   * @param {object} [opts]
   * @param {number} [opts.utcOffset] time zone (ms) used to cut daily and longer bars
   * @param {number} [opts.ticks]     approximate number of ticks to synthesize
   * @param {number} [opts.fineDays]  how many recent days are kept as 1-minute bars
   */
  constructor({ utcOffset = 0, ticks = 1_200_000, fineDays = 60 } = {}) {
    this.utcOffset = utcOffset;
    this.tickTarget = ticks;
    this.fineDays = fineDays;
    this.speed = 20;
    this.symbols = DEMO_SYMBOLS.map((s) => ({ ...s }));
    this.#states = new Map();
  }

  #states;

  symbol(id) {
    return this.symbols.find((s) => s.id === id);
  }

  /** Add static data (e.g. loaded from a CSV) as a symbol. */
  addStatic(id, data, { description = 'imported data', precision = 2 } = {}) {
    this.symbols = this.symbols.filter((s) => s.id !== id);
    this.symbols.push({ id, description, kind: 'CSV', precision, static: true });
    this.#states.set(id, { static: true, base: data });
    return this.symbol(id);
  }

  timeframes(symbolId) {
    const st = this.#states.get(symbolId);
    if (st?.static) {
      const step = st.base.interval;
      return TIMEFRAMES.filter((tf) => tf.ms && tf.ms >= step * 0.99).map((tf) => tf.id);
    }
    return TIMEFRAMES.map((tf) => tf.id);
  }

  #state(symbolId) {
    let st = this.#states.get(symbolId);
    if (st) return st;
    const sym = this.symbol(symbolId);
    if (!sym) throw new Error(t('Unknown symbol: {id}', { id: symbolId }));
    const sim = new MarketSim(sym);
    const cal = sim.cal;
    const end = Math.floor(Date.now() / 1000) * 1000;
    // Build hourly bars from the fixed start, then split only the recent part into 1-minute bars. The older part is identical on every load.
    const coarse = generateHistory(sim, { start: EPOCH, end });
    const from = Math.max(0, coarse.lowerBound(end - this.fineDays * DAY));
    const n = coarse.length;
    const lastStart = coarse.lastTime;
    const simTime = Math.min(end, cal.session(lastStart)[1], lastStart + HOUR);
    const spanOf = (i) => (i === n - 1 ? simTime : Math.min(coarse.time[i] + HOUR, cal.session(coarse.time[i])[1])) - coarse.time[i];
    const fine = expandBars(sim, sym.seed, coarse, from, spanOf);
    st = { sym, sim, coarse, fine, ticks: null, simTime, carry: 0 };
    this.#states.set(symbolId, st);
    return st;
  }

  #ticks(st) {
    if (!st.ticks) {
      const perBar = 600;
      const from = Math.max(0, st.fine.length - Math.ceil(this.tickTarget / perBar));
      st.ticks = synthesizeTicks(st.sim, st.sym.seed, st.fine, from, st.simTime, perBar);
    }
    return st.ticks;
  }

  /** Return the history. */
  async history(symbolId, tfId) {
    const tf = timeframeById.get(tfId);
    const st = this.#state(symbolId);
    if (st.static) return resample([st.base], tf, this.utcOffset);
    if (tf.ticks === 1) return this.#ticks(st).clone();
    if (tf.ticks) return aggregateTicks(this.#ticks(st), tf.ticks);
    if (tf.ms < MIN) return resample([this.#ticks(st)], tf, this.utcOffset);
    if (tf.ms < HOUR) return resample([st.fine], tf, this.utcOffset);
    return resample([st.coarse], tf, this.utcOffset);
  }

  /** Number of ticks held (0 if none have been synthesized yet). */
  tickCount(symbolId) {
    return this.#states.get(symbolId)?.ticks?.length ?? 0;
  }

  /**
   * Start the live feed: simulated trades are aggregated into the requested timeframe and delivered.
   * Simulation time runs `speed` times faster than real time (closed hours are skipped to the next open).
   *
   * Prices are advanced by a single timer per symbol, shared by all subscribers
   * (several widgets watching one symbol never double its speed or see different prices).
   * @param {(bar: object, isNew: boolean) => void} onBar
   * @param {BarData} history the history currently shown (used to continue the aggregation)
   * @returns {() => void} unsubscribe function
   */
  subscribe(symbolId, tfId, onBar, history) {
    const st = this.#state(symbolId);
    if (st.static) return () => {};
    const tf = timeframeById.get(tfId);
    const n = history.length;
    const filled = tf.ticks ? (this.#ticks(st).length % tf.ticks || (n ? tf.ticks : 0)) : 0;
    const sub = { agg: new Aggregator(tf, this.utcOffset, n ? history.bar(n - 1) : null, filled), onBar };
    st.subs ??= new Set();
    st.subs.add(sub);
    if (!st.timer) {
      let last = performance.now();
      st.timer = setInterval(() => {
        const now = performance.now();
        const real = Math.min(250, now - last);
        last = now;
        this.#pump(st, real * this.speed);
      }, 50);
    }
    return () => {
      st.subs.delete(sub);
      if (!st.subs.size && st.timer) {
        clearInterval(st.timer);
        st.timer = null;
      }
    };
  }

  /** Advance simulation time by simDt and emit the ticks in between. */
  #pump(st, simDt) {
    const { sim, fine } = st;
    const rate = 7 / 1000; // average ticks per millisecond of simulation time
    const expected = (st.carry + simDt) * rate;
    let count = Math.floor(expected);
    if (sim.rand() < expected - count) count++;
    if (count === 0) {
      st.carry += simDt;
      return;
    }
    count = Math.min(count, 12);
    const span = st.carry + simDt;
    st.carry = 0;
    const dt = span / count;
    for (let k = 0; k < count; k++) {
      // If the market has closed, jump to the next open.
      const t = st.simTime + dt;
      const [open] = sim.cal.session(t);
      const opening = t < open;
      st.simTime = opening ? open : t;
      if (opening) sim.gap();
      const r = sim.step(st.simTime, dt);
      const price = sim.price;
      const size = sim.roundSize(sim.size(st.simTime, dt, Math.abs(r)) * (0.4 + 1.2 * sim.rand()));
      const time = Math.floor(st.simTime);

      if (st.ticks) st.ticks.push(time, price, price, price, price, size);
      // Apply to both the 1-minute and the hourly bars (so the live part is still there after a timeframe switch).
      for (const [store, step] of [[fine, MIN], [st.coarse, HOUR]]) {
        const bucket = Math.floor(time / step) * step;
        const i = store.length - 1;
        if (i < 0 || bucket > store.time[i]) store.push(bucket, price, price, price, price, size);
        else store.setLast(store.open[i], Math.max(store.high[i], price), Math.min(store.low[i], price), price, store.volume[i] + size);
      }

      for (const sub of [...st.subs]) {
        const { bar, isNew } = sub.agg.add(time, price, size);
        sub.onBar(bar, isNew);
      }
    }
  }
}
