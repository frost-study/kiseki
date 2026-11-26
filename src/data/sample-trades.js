import { sma } from '../indicators/math.js';
import { mulberry32 } from './simulator.js';

/**
 * Synthetic trades for demos: round trips from a moving-average cross over the most recent bars.
 * Like everything else in the demo they are made up; nobody traded these.
 *
 * Each fill gets a time somewhere inside its bar and a price somewhere inside the bar's range,
 * which is what real executions look like and what the markers have to place exactly.
 *
 * @param {import('../core/BarData.js').BarData} data
 * @param {object} [opts]
 * @param {number} [opts.bars=4000]   how many recent bars to trade over
 * @param {number} [opts.fast=12]     fast average length
 * @param {number} [opts.slow=36]     slow average length
 * @param {number} [opts.precision=2] decimals of the prices
 * @param {number} [opts.seed=7]
 * @returns {object[]} entries for chart.trades.set()
 */
export function sampleTrades(data, { bars = 4000, fast = 12, slow = 36, precision = 2, seed = 7 } = {}) {
  const n = data.length;
  const start = Math.max(0, n - bars);
  if (n - start < slow + 2) return [];
  const rand = mulberry32(seed);
  const close = data.close.subarray(start, n);
  const m = close.length;
  const a = new Float64Array(m);
  const b = new Float64Array(m);
  sma(close, fast, a, 0, m);
  sma(close, slow, b, 0, m);

  const round = (v) => +v.toFixed(precision);
  const unit = 10 ** Math.round(4 - Math.log10(Math.max(1e-9, close[m - 1])));
  const step = data.interval;
  const fill = (k) => {
    const i = start + k;
    if (data.aliased) return { time: data.time[i], price: data.close[i] };
    const span = i + 1 < n ? Math.min(data.time[i + 1] - data.time[i], step * 3) : step;
    return {
      time: data.time[i] + (span > 2000 ? Math.floor((rand() * span) / 1000) * 1000 : Math.floor(rand() * span)),
      price: round(data.low[i] + (data.high[i] - data.low[i]) * rand()),
    };
  };

  const out = [];
  let open = null;
  for (let k = slow + 1; k < m; k++) {
    const up = a[k - 1] <= b[k - 1] && a[k] > b[k];
    const down = a[k - 1] >= b[k - 1] && a[k] < b[k];
    if (!up && !down) continue;
    const at = fill(k);
    if (open) {
      open.exit = at;
      open = null;
    }
    // Every golden cross opens a long; about half of the dead crosses open a short.
    if (up || rand() < 0.5) {
      open = { side: up ? 'long' : 'short', qty: +([1, 2, 5, 10][Math.floor(rand() * 4)] * unit).toPrecision(6), entry: at };
      out.push(open);
    }
  }
  return out;
}
