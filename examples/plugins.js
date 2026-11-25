/**
 * Plugin examples: one of each extension point (indicator / series type / drawing tool).
 * Nothing in the core is modified; passing a definition to a registry is enough for it to appear in the UI menus too.
 */
import { Series, addMessages, distToSegment, drawingTools, indicators, math, plots, seriesTypes, withAlpha } from '../src/index.js';

/* Japanese translations for the plugin strings. Definitions are written in English; only translations are added here. */
addMessages('ja', {
  'Plugin examples': 'プラグイン例',
  'Donchian Channel': 'ドンチャン・チャネル',
  'Supertrend': 'スーパートレンド',
  'ATR length': 'ATR 期間',
  'Multiplier': '倍率',
  'Up': '上昇',
  'Down': '下降',
  'HLC area (plugin example)': 'HLC エリア(プラグイン例)',
  'Arrow (plugin example)': '矢印(プラグイン例)',
});

/* ── 1. Indicator: Donchian Channel ──
   The highest high, lowest low and their midpoint over the last N bars: a declaration plus a few lines of incremental math. */
indicators.register({
  id: 'donchian',
  name: 'DC',
  title: 'Donchian Channel',
  category: 'Plugin examples',
  overlay: true,
  precision: 'inherit',
  inputs: { length: { type: 'int', label: 'Length', default: 20, min: 1, max: 500 } },
  plots: [
    { type: 'band', a: 'upper', b: 'lower', color: 6, opacity: 0.06 },
    { key: 'upper', type: 'line', color: 6, width: 1.25, label: 'Upper' },
    { key: 'lower', type: 'line', color: 6, width: 1.25, label: 'Lower' },
    { key: 'mid', type: 'line', color: 6, width: 1, dash: [3, 3], label: 'Mid', axisLabel: false },
  ],
  calc({ data, inputs, out, from, n }) {
    math.highest(data.high, inputs.length, out.upper, from, n);
    math.lowest(data.low, inputs.length, out.lower, from, n);
    for (let i = from; i < n; i++) out.mid[i] = (out.upper[i] + out.lower[i]) / 2;
  },
});

/* ── 2. Indicator: Supertrend ──
   A recursive indicator with state. It reads the previous bar's results (out) and continues from there,
   so a live tick costs constant time. Rising and falling stretches are separate lines with different colors. */
indicators.register({
  id: 'supertrend',
  name: 'ST',
  title: 'Supertrend',
  category: 'Plugin examples',
  overlay: true,
  precision: 'inherit',
  inputs: {
    length: { type: 'int', label: 'ATR length', default: 10, min: 1, max: 200 },
    mult: { type: 'float', label: 'Multiplier', default: 3, min: 0.5, max: 10, step: 0.1 },
  },
  buffers: ['tr', 'atr', 'ub', 'lb', 'dir'],
  plots: [
    { key: 'up', type: 'line', color: 'up', width: 2, label: 'Up' },
    { key: 'down', type: 'line', color: 'down', width: 2, label: 'Down' },
  ],
  calc({ data, inputs, out, from, n }) {
    const { high, low, close } = data;
    const { tr, atr, ub, lb, dir, up, down } = out;
    math.trueRange(data, tr, from, n);
    math.rma(tr, inputs.length, atr, from, n);
    for (let i = from; i < n; i++) {
      up[i] = down[i] = NaN;
      if (atr[i] !== atr[i]) {
        ub[i] = lb[i] = dir[i] = NaN;
        continue;
      }
      const mid = (high[i] + low[i]) / 2;
      let u = mid + inputs.mult * atr[i];
      let l = mid - inputs.mult * atr[i];
      const first = i === 0 || dir[i - 1] !== dir[i - 1];
      if (!first) {
        // a band never moves the unfavourable way until the close breaks it
        if (!(u < ub[i - 1] || close[i - 1] > ub[i - 1])) u = ub[i - 1];
        if (!(l > lb[i - 1] || close[i - 1] < lb[i - 1])) l = lb[i - 1];
      }
      ub[i] = u;
      lb[i] = l;
      dir[i] = first ? 1 : dir[i - 1] > 0 ? (close[i] < l ? -1 : 1) : close[i] > u ? 1 : -1;
      if (dir[i] > 0) up[i] = l;
      else down[i] = u;
    }
  },
});

/* ── 3. Series type: HLC area ──
   Fills the band between high and low and runs a line through the closes, using only the drawing primitives (plots). */
class HlcAreaSeries extends Series {
  static id = 'hlcarea';
  static label = 'HLC area (plugin example)';
  static icon = 'M3 9l5-3 4 2 4-4 5 3v9l-5-2-4 3-4-2-5 3zM3 13l5-3 4 2 4-4 5 3';

  draw(v) {
    const d = this.data;
    const color = v.theme.series;
    plots.fillBand(v, d.high, d.low, d.length, withAlpha(color, 0.16));
    plots.strokeLine(v, d.high, d.length, { color: withAlpha(color, 0.45), width: 1 });
    plots.strokeLine(v, d.low, d.length, { color: withAlpha(color, 0.45), width: 1 });
    plots.strokeLine(v, d.close, d.length, { color, width: 1.75, index: this.closeIndex });
  }

  lastValues(theme) {
    const d = this.data;
    return d.length ? [{ value: d.close[d.length - 1], color: theme.series, line: true }] : [];
  }
}
seriesTypes.register(HlcAreaSeries);

/* ── 4. Drawing tool: arrow ── */
drawingTools.register({
  id: 'arrow',
  label: 'Arrow (plugin example)',
  icon: 'M5 19L19 5M19 5h-7M19 5v7',
  points: 2,
  draw(ctx, p) {
    const [a, b] = p;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - 11 * Math.cos(ang - 0.42), b.y - 11 * Math.sin(ang - 0.42));
    ctx.lineTo(b.x - 11 * Math.cos(ang + 0.42), b.y - 11 * Math.sin(ang + 0.42));
    ctx.closePath();
    ctx.fill();
  },
  hit: (p, x, y) => distToSegment(x, y, p[0].x, p[0].y, p[1].x, p[1].y) < 6,
});
