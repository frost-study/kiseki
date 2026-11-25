import { indicators } from '../core/Registry.js';
import { ema, highest, lowest, midpoint, rma, sma, stdev, trueRange, wma } from './math.js';

const DAY = 86_400_000;
const length = (def, label = 'Length') => ({ type: 'int', label, default: def, min: 1, max: 2000 });
const source = { type: 'source', label: 'Source', default: 'close' };

/* ───────────── Overlays on the main pane ───────────── */

indicators.register({
  id: 'sma',
  name: 'SMA',
  title: 'Simple Moving Average',
  category: 'Trend',
  overlay: true,
  precision: 'inherit',
  inputs: { length: length(20), source },
  plots: [{ key: 'value', type: 'line', color: 0 }],
  calc({ src, inputs, out, from, n }) {
    sma(src(inputs.source), inputs.length, out.value, from, n);
  },
});

indicators.register({
  id: 'ema',
  name: 'EMA',
  title: 'Exponential Moving Average',
  category: 'Trend',
  overlay: true,
  precision: 'inherit',
  inputs: { length: length(50), source },
  plots: [{ key: 'value', type: 'line', color: 1 }],
  calc({ src, inputs, out, from, n }) {
    ema(src(inputs.source), inputs.length, out.value, from, n);
  },
});

indicators.register({
  id: 'wma',
  name: 'WMA',
  title: 'Weighted Moving Average',
  category: 'Trend',
  overlay: true,
  precision: 'inherit',
  inputs: { length: length(20), source },
  plots: [{ key: 'value', type: 'line', color: 4 }],
  calc({ src, inputs, out, from, n }) {
    wma(src(inputs.source), inputs.length, out.value, from, n);
  },
});

indicators.register({
  id: 'bb',
  name: 'BB',
  title: 'Bollinger Bands',
  category: 'Volatility',
  overlay: true,
  precision: 'inherit',
  inputs: {
    length: length(20),
    mult: { type: 'float', label: 'Deviations (σ)', default: 2, min: 0.1, max: 10, step: 0.1 },
    source,
  },
  buffers: ['dev'],
  plots: [
    { type: 'band', a: 'upper', b: 'lower', color: 0, opacity: 0.07 },
    { key: 'basis', type: 'line', color: 1, width: 1.25, label: 'Mid' },
    { key: 'upper', type: 'line', color: 0, width: 1.25, label: 'Upper' },
    { key: 'lower', type: 'line', color: 0, width: 1.25, label: 'Lower' },
  ],
  calc({ src, inputs, out, from, n }) {
    const s = src(inputs.source);
    sma(s, inputs.length, out.basis, from, n);
    stdev(s, inputs.length, out.dev, from, n);
    for (let i = from; i < n; i++) {
      const d = out.dev[i] * inputs.mult;
      out.upper[i] = out.basis[i] + d;
      out.lower[i] = out.basis[i] - d;
    }
  },
});

indicators.register({
  id: 'vwap',
  name: 'VWAP',
  title: 'Volume-Weighted Average Price',
  category: 'Volume',
  overlay: true,
  precision: 'inherit',
  inputs: {
    anchor: {
      type: 'select',
      label: 'Anchor',
      default: 'auto',
      options: [['auto', 'Auto'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month']],
    },
  },
  buffers: ['pv', 'vol'],
  plots: [{ key: 'value', type: 'line', color: 3 }],
  calc({ data, inputs, out, from, n, utcOffset, interval }) {
    let anchor = inputs.anchor;
    if (anchor === 'auto') anchor = interval < DAY ? 'day' : interval < 7 * DAY ? 'month' : 'year';
    const period = (t) => {
      const T = t + utcOffset;
      if (anchor === 'day') return Math.floor(T / DAY);
      if (anchor === 'week') return Math.floor((Math.floor(T / DAY) + 3) / 7);
      const d = new Date(T);
      return anchor === 'month' ? d.getUTCFullYear() * 12 + d.getUTCMonth() : d.getUTCFullYear();
    };
    const { time, high, low, close, volume } = data;
    let prev = from > 0 ? period(time[from - 1]) : NaN;
    for (let i = from; i < n; i++) {
      const p = period(time[i]);
      const tp = (high[i] + low[i] + close[i]) / 3;
      const fresh = i === 0 || p !== prev;
      out.pv[i] = (fresh ? 0 : out.pv[i - 1]) + tp * volume[i];
      out.vol[i] = (fresh ? 0 : out.vol[i - 1]) + volume[i];
      out.value[i] = out.vol[i] > 0 ? out.pv[i] / out.vol[i] : tp;
      prev = p;
    }
  },
});

indicators.register({
  id: 'ichimoku',
  name: 'Ichimoku',
  title: 'Ichimoku Cloud',
  category: 'Trend',
  overlay: true,
  precision: 'inherit',
  inputs: {
    tenkan: length(9, 'Conversion line'),
    kijun: length(26, 'Base line'),
    senkou: length(52, 'Leading span B'),
    shift: length(26, 'Displacement'),
  },
  plots: [
    { type: 'cloud', a: 'spanA', b: 'spanB', above: 2, below: 7, opacity: 0.13, offset: (i) => i.shift },
    { key: 'tenkan', type: 'line', color: 0, width: 1.25, label: 'Conv' },
    { key: 'kijun', type: 'line', color: 7, width: 1.25, label: 'Base' },
    { key: 'spanA', type: 'line', color: 2, width: 1, label: 'Span A', offset: (i) => i.shift, axisLabel: false },
    { key: 'spanB', type: 'line', color: 7, width: 1, label: 'Span B', offset: (i) => i.shift, axisLabel: false },
    { key: 'chikou', type: 'line', color: 5, width: 1, label: 'Lag', offset: (i) => -i.shift, axisLabel: false },
  ],
  calc({ data, inputs, out, from, n }) {
    const { high, low, close } = data;
    midpoint(high, low, inputs.tenkan, out.tenkan, from, n);
    midpoint(high, low, inputs.kijun, out.kijun, from, n);
    midpoint(high, low, inputs.senkou, out.spanB, from, n);
    for (let i = from; i < n; i++) {
      out.spanA[i] = (out.tenkan[i] + out.kijun[i]) / 2;
      out.chikou[i] = close[i];
    }
  },
});

indicators.register({
  id: 'sar',
  name: 'SAR',
  title: 'Parabolic SAR',
  category: 'Trend',
  overlay: true,
  precision: 'inherit',
  inputs: {
    start: { type: 'float', label: 'Start', default: 0.02, min: 0.001, max: 1, step: 0.01 },
    step: { type: 'float', label: 'Step', default: 0.02, min: 0.001, max: 1, step: 0.01 },
    max: { type: 'float', label: 'Maximum', default: 0.2, min: 0.01, max: 1, step: 0.01 },
  },
  buffers: ['dir', 'ep', 'af'],
  plots: [{ key: 'value', type: 'dots', color: 5 }],
  calc({ data, inputs, out, from, n }) {
    const { high, low } = data;
    const { value, dir, ep, af } = out;
    for (let i = from; i < n; i++) {
      if (i === 0) {
        value[0] = low[0];
        dir[0] = 1;
        ep[0] = high[0];
        af[0] = inputs.start;
        continue;
      }
      let sar = value[i - 1] + af[i - 1] * (ep[i - 1] - value[i - 1]);
      if (dir[i - 1] > 0) {
        sar = Math.min(sar, low[i - 1], i > 1 ? low[i - 2] : low[i - 1]);
        if (low[i] < sar) {
          dir[i] = -1;
          value[i] = ep[i - 1];
          ep[i] = low[i];
          af[i] = inputs.start;
        } else {
          dir[i] = 1;
          value[i] = sar;
          const higher = high[i] > ep[i - 1];
          ep[i] = higher ? high[i] : ep[i - 1];
          af[i] = higher ? Math.min(inputs.max, af[i - 1] + inputs.step) : af[i - 1];
        }
      } else {
        sar = Math.max(sar, high[i - 1], i > 1 ? high[i - 2] : high[i - 1]);
        if (high[i] > sar) {
          dir[i] = 1;
          value[i] = ep[i - 1];
          ep[i] = high[i];
          af[i] = inputs.start;
        } else {
          dir[i] = -1;
          value[i] = sar;
          const lower = low[i] < ep[i - 1];
          ep[i] = lower ? low[i] : ep[i - 1];
          af[i] = lower ? Math.min(inputs.max, af[i - 1] + inputs.step) : af[i - 1];
        }
      }
    }
  },
});

indicators.register({
  id: 'volume',
  name: 'Volume',
  title: 'Volume',
  category: 'Volume',
  overlay: true,
  behind: true,
  precision: 'volume',
  scale: { id: 'volume', top: 0.8, bottom: 0 },
  plots: [
    {
      key: 'volume',
      type: 'histogram',
      column: 'volume',
      colors: [['up', 0.38], ['down', 0.38]],
      // Bars are colored by up / down candle; ticks by whether they traded above or below the previous trade.
      colorOf: (i, { data }) => (data.isUp(i) ? 0 : 1),
    },
  ],
  calc() {},
});

/* ───────────── Indicators with their own pane ───────────── */

indicators.register({
  id: 'rsi',
  name: 'RSI',
  title: 'Relative Strength Index',
  category: 'Oscillators',
  precision: 2,
  inputs: { length: length(14), source },
  buffers: ['gain', 'loss'],
  plots: [{ key: 'value', type: 'line', color: 5 }],
  guides: [70, 30],
  zone: [30, 70],
  calc({ src, inputs, out, from, n }) {
    const s = src(inputs.source);
    const len = inputs.length;
    const { value, gain, loss } = out;
    for (let i = from; i < n; i++) {
      if (i < len) {
        value[i] = gain[i] = loss[i] = NaN;
        continue;
      }
      if (i === len) {
        let g = 0;
        let l = 0;
        for (let j = 1; j <= len; j++) {
          const ch = s[j] - s[j - 1];
          if (ch > 0) g += ch;
          else l -= ch;
        }
        gain[i] = g / len;
        loss[i] = l / len;
      } else {
        const ch = s[i] - s[i - 1];
        gain[i] = (gain[i - 1] * (len - 1) + (ch > 0 ? ch : 0)) / len;
        loss[i] = (loss[i - 1] * (len - 1) + (ch < 0 ? -ch : 0)) / len;
      }
      value[i] = loss[i] === 0 ? 100 : 100 - 100 / (1 + gain[i] / loss[i]);
    }
  },
});

indicators.register({
  id: 'macd',
  name: 'MACD',
  title: 'MACD',
  category: 'Oscillators',
  precision: 'inherit',
  inputs: { fast: length(12, 'Fast'), slow: length(26, 'Slow'), signal: length(9, 'Signal'), source },
  buffers: ['fastEma', 'slowEma'],
  plots: [
    {
      key: 'hist',
      type: 'histogram',
      label: 'Hist',
      colors: [['up', 0.9], ['up', 0.45], ['down', 0.45], ['down', 0.9]],
      colorOf: (i, { out }) => {
        const h = out.hist[i];
        const p = i > 0 ? out.hist[i - 1] : h;
        return h >= 0 ? (h >= p ? 0 : 1) : h < p ? 3 : 2;
      },
    },
    { key: 'macd', type: 'line', color: 0, label: 'MACD' },
    { key: 'signal', type: 'line', color: 1, label: 'Signal' },
  ],
  guides: [0],
  calc({ src, inputs, out, from, n }) {
    const s = src(inputs.source);
    ema(s, inputs.fast, out.fastEma, from, n);
    ema(s, inputs.slow, out.slowEma, from, n);
    for (let i = from; i < n; i++) out.macd[i] = out.fastEma[i] - out.slowEma[i];
    ema(out.macd, inputs.signal, out.signal, from, n);
    for (let i = from; i < n; i++) out.hist[i] = out.macd[i] - out.signal[i];
  },
});

indicators.register({
  id: 'stoch',
  name: 'Stoch',
  title: 'Stochastic',
  category: 'Oscillators',
  precision: 2,
  inputs: { k: length(14, '%K'), smooth: length(3, 'Smoothing'), d: length(3, '%D') },
  buffers: ['hh', 'll', 'raw'],
  plots: [
    { key: 'k', type: 'line', color: 0, label: '%K' },
    { key: 'd', type: 'line', color: 1, label: '%D' },
  ],
  guides: [80, 20],
  zone: [20, 80],
  calc({ data, inputs, out, from, n }) {
    highest(data.high, inputs.k, out.hh, from, n);
    lowest(data.low, inputs.k, out.ll, from, n);
    for (let i = from; i < n; i++) {
      const span = out.hh[i] - out.ll[i];
      out.raw[i] = span > 0 ? (100 * (data.close[i] - out.ll[i])) / span : span === 0 ? 50 : NaN;
    }
    sma(out.raw, inputs.smooth, out.k, from, n);
    sma(out.k, inputs.d, out.d, from, n);
  },
});

indicators.register({
  id: 'atr',
  name: 'ATR',
  title: 'Average True Range',
  category: 'Volatility',
  precision: 'inherit',
  inputs: { length: length(14) },
  buffers: ['tr'],
  plots: [{ key: 'value', type: 'line', color: 7 }],
  calc({ data, inputs, out, from, n }) {
    trueRange(data, out.tr, from, n);
    rma(out.tr, inputs.length, out.value, from, n);
  },
});

indicators.register({
  id: 'obv',
  name: 'OBV',
  title: 'On-Balance Volume',
  category: 'Volume',
  precision: 'volume',
  plots: [{ key: 'value', type: 'line', color: 6 }],
  calc({ data, out, from, n }) {
    const { close, volume } = data;
    for (let i = from; i < n; i++) {
      if (i === 0) out.value[0] = 0;
      else out.value[i] = out.value[i - 1] + (close[i] > close[i - 1] ? volume[i] : close[i] < close[i - 1] ? -volume[i] : 0);
    }
  },
});
