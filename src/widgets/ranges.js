import { TIMEFRAMES, timeframeById } from '../data/timeframes.js';

const DAY = 86_400_000;

/**
 * Periods selectable in the summary and price cards. Each uses a timeframe of suitable detail
 * (5-minute bars for one day, daily bars for one year).
 */
export const RANGES = [
  { id: '1D', label: { ja: '1日', en: '1D' }, span: DAY, tf: '5m' },
  { id: '1W', label: { ja: '1週', en: '1W' }, span: 7 * DAY, tf: '30m' },
  { id: '1M', label: { ja: '1か月', en: '1M' }, span: 30 * DAY, tf: '1h' },
  { id: '3M', label: { ja: '3か月', en: '3M' }, span: 91 * DAY, tf: '4h' },
  { id: '1Y', label: { ja: '1年', en: '1Y' }, span: 365 * DAY, tf: '1D' },
  { id: 'ALL', label: { ja: '全期間', en: 'All' }, span: Infinity, tf: '1W' },
];

export const rangeById = (id) => RANGES.find((r) => r.id === String(id ?? '').toUpperCase()) ?? RANGES[2];

/** Among the symbol's available timeframes, the finest one that is at least `wanted` (or the coarsest if none). */
export function pickTimeframe(feed, symbol, wanted) {
  const available = new Set(feed.timeframes(symbol));
  if (available.has(wanted)) return wanted;
  const need = timeframeById.get(wanted)?.ms ?? 0;
  const timed = TIMEFRAMES.filter((tf) => tf.ms && available.has(tf.id));
  return (timed.find((tf) => tf.ms >= need) ?? timed[timed.length - 1])?.id ?? [...available][0];
}

/**
 * Statistics for a period: change, high, low and volume over the bars from `from` onward.
 * The change is measured from the close just before the period (or the first open when there is none).
 */
export function rangeStats(data, from) {
  const n = data.length;
  if (!n) return null;
  const a = Math.min(n - 1, Math.max(0, data.lowerBound(from)));
  const hl = data.range(a, n - 1);
  let volume = 0;
  for (let i = a; i < n; i++) volume += data.volume[i];
  const last = data.close[n - 1];
  const ref = a > 0 ? data.close[a - 1] : data.open[a];
  return {
    index: a,
    from: data.time[a],
    last,
    ref,
    change: last - ref,
    pct: ref ? ((last - ref) / ref) * 100 : 0,
    high: hl.max,
    low: hl.min,
    volume,
  };
}

/** Load the history for a period. */
export async function loadRange(feed, symbol, range) {
  const tf = pickTimeframe(feed, symbol, range.tf);
  const data = await feed.history(symbol, tf);
  const from = Number.isFinite(range.span) && data.length ? data.lastTime - range.span : -Infinity;
  return { data, tf, from };
}
