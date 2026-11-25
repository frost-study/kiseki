import { pickTimeframe } from './ranges.js';

/** Derive the last price and daily change from daily bars. */
export function quoteFrom(daily) {
  const n = daily.length;
  if (!n) return null;
  const last = daily.close[n - 1];
  const prev = n > 1 ? daily.close[n - 2] : daily.open[n - 1];
  return { last, prev, change: last - prev, pct: prev ? ((last - prev) / prev) * 100 : 0, time: daily.time[n - 1] };
}

/**
 * Delivers the last price and daily change per symbol.
 * However many widgets watch a symbol, the history fetch and the subscription happen once.
 */
class Quotes {
  constructor(feed) {
    this.feed = feed;
    this.entries = new Map();
  }

  /**
   * @param {string} symbol
   * @param {(quote: {symbol:string, last:number, prev:number, change:number, pct:number}) => void} fn
   * @returns {() => void} unsubscribe function
   */
  watch(symbol, fn) {
    let entry = this.entries.get(symbol);
    if (!entry) {
      entry = { listeners: new Set(), quote: null, off: null, pending: false, dead: false };
      this.entries.set(symbol, entry);
      this.#start(symbol, entry);
    }
    entry.listeners.add(fn);
    if (entry.quote) fn(entry.quote);
    return () => {
      entry.listeners.delete(fn);
      if (entry.listeners.size) return;
      entry.dead = true;
      entry.off?.();
      this.entries.delete(symbol);
    };
  }

  async #start(symbol, entry) {
    const feed = this.feed;
    if (!feed.symbol(symbol)) return;
    const tf = pickTimeframe(feed, symbol, '1D');
    const daily = await feed.history(symbol, tf);
    if (entry.dead) return;
    const publish = () => {
      entry.pending = false;
      const q = quoteFrom(daily);
      if (!q) return;
      entry.quote = { symbol, ...q };
      for (const fn of [...entry.listeners]) fn(entry.quote);
    };
    publish();
    entry.off = feed.subscribe(
      symbol,
      tf,
      (bar, isNew) => {
        if (isNew || !daily.length) daily.push(bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume);
        else daily.setLast(bar.open, bar.high, bar.low, bar.close, bar.volume);
        // however many ticks arrive in a frame, notify once
        if (!entry.pending) {
          entry.pending = true;
          (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(publish);
        }
      },
      daily,
    );
  }
}

const services = new WeakMap();

/** Return the one Quotes instance for a feed. */
export function quotesFor(feed) {
  let q = services.get(feed);
  if (!q) services.set(feed, (q = new Quotes(feed)));
  return q;
}
