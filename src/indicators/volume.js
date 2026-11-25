import { indicators } from '../core/Registry.js';
import { niceStep } from '../core/PriceScale.js';
import { formatCompact } from '../core/format.js';
import { t } from '../core/i18n.js';
import { contrastText, withAlpha } from '../core/theme.js';

/**
 * Indicators that look at volume from the price side.
 * Their shape depends on the visible range, so they are drawn with custom plots (type: 'custom').
 */

/**
 * Compute a volume profile.
 *
 * The volume of bars [a, b] is distributed over `rows` equal price rows spanning [lo, hi].
 * A bar that spans several rows is split in proportion to its high–low overlap with each row.
 * up / down is the breakdown by rising / falling bars (for ticks: above or below the previous trade).
 *
 * With very many visible bars it samples at even intervals and scales the result back (the shape barely changes).
 *
 * @returns {{ up: Float64Array, down: Float64Array, lo: number, hi: number, step: number,
 *            rows: number, total: number, max: number, poc: number, vaLow: number, vaHigh: number }}
 */
export function computeVolumeProfile(data, a, b, rows, { valueArea = 70, maxSamples = 250_000, out = null } = {}) {
  const r = data.range(a, b);
  if (!r || !(r.max > r.min) || rows < 1) return null;
  const lo = r.min;
  const hi = r.max;
  const step = (hi - lo) / rows;
  const up = out?.up?.length === rows ? out.up.fill(0) : new Float64Array(rows);
  const down = out?.down?.length === rows ? out.down.fill(0) : new Float64Array(rows);
  const { open, high, low, close, volume, aliased } = data;
  let rising = data.isUp(a);
  const stride = Math.max(1, Math.floor((b - a + 1) / maxSamples));
  const last = rows - 1;

  for (let i = a; i <= b; i += stride) {
    const vol = volume[i];
    if (!(vol > 0)) continue;
    // A tick at an unchanged price keeps the previous direction. We scan in order, so carrying the direction is enough.
    if (!aliased) rising = close[i] >= open[i];
    else if (i > 0 && close[i] !== close[i - 1]) rising = close[i] > close[i - 1];
    const side = rising ? up : down;
    const l = low[i];
    const h = high[i];
    const k0 = Math.min(last, Math.max(0, Math.floor((l - lo) / step)));
    const k1 = Math.min(last, Math.max(0, Math.floor((h - lo) / step)));
    if (k0 === k1) {
      side[k0] += vol;
      continue;
    }
    const per = vol / (h - l);
    for (let k = k0; k <= k1; k++) {
      const overlap = Math.min(h, lo + (k + 1) * step) - Math.max(l, lo + k * step);
      if (overlap > 0) side[k] += per * overlap;
    }
  }

  let total = 0;
  let max = 0;
  let poc = 0;
  for (let k = 0; k < rows; k++) {
    up[k] *= stride;
    down[k] *= stride;
    const sum = up[k] + down[k];
    total += sum;
    if (sum > max) {
      max = sum;
      poc = k;
    }
  }

  // Value area: starting from the thickest row (POC), grow toward the thicker neighbour until valueArea % of the total is covered.
  let vaLow = poc;
  let vaHigh = poc;
  let covered = max;
  const target = (total * valueArea) / 100;
  while (covered < target && (vaLow > 0 || vaHigh < last)) {
    const below = vaLow > 0 ? up[vaLow - 1] + down[vaLow - 1] : -1;
    const above = vaHigh < last ? up[vaHigh + 1] + down[vaHigh + 1] : -1;
    if (above >= below) covered += up[++vaHigh] + down[vaHigh];
    else covered += up[--vaLow] + down[vaLow];
  }
  return { up, down, lo, hi, step, rows, total, max, poc, vaLow, vaHigh };
}

indicators.register({
  id: 'vprofile',
  name: 'Volume Profile',
  title: 'Volume Profile',
  category: 'Volume',
  overlay: true,
  precision: 'inherit',
  inputs: {
    rows: { type: 'int', label: 'Rows', default: 24, min: 4, max: 200 },
    width: { type: 'int', label: 'Width (% of pane)', default: 30, min: 5, max: 80, inTitle: false },
    valueArea: { type: 'int', label: 'Value area (%)', default: 70, min: 10, max: 100, inTitle: false },
    side: { type: 'select', label: 'Side', default: 'left', options: [['left', 'Left'], ['right', 'Right']] },
    poc: { type: 'select', label: 'POC line', default: 'on', options: [['on', 'Show'], ['off', 'Hide']] },
  },
  plots: [
    {
      type: 'custom',
      back: true,
      draw(v, { data, inputs }, self) {
        const st = self.state;
        st.profile = v.b >= v.a ? computeVolumeProfile(data, v.a, v.b, inputs.rows, { valueArea: inputs.valueArea, out: st.profile }) : null;
        const p = st.profile;
        if (!p || !(p.max > 0)) return;
        const { ctx, theme } = v;
        const maxW = (v.width * inputs.width) / 100;
        const right = inputs.side === 'right';
        const k2px = maxW / p.max;

        for (let k = 0; k < p.rows; k++) {
          const sum = p.up[k] + p.down[k];
          if (!(sum > 0)) continue;
          // Leave 1px between rows so neighbours do not look joined.
          const yTop = Math.round(v.y(p.lo + (k + 1) * p.step));
          const yBot = Math.round(v.y(p.lo + k * p.step));
          const h = Math.max(1, yBot - yTop - 1);
          const inArea = k >= p.vaLow && k <= p.vaHigh;
          const alpha = k === p.poc ? 0.62 : inArea ? 0.38 : 0.17;
          const wUp = p.up[k] * k2px;
          const wDown = p.down[k] * k2px;
          ctx.fillStyle = withAlpha(theme.up, alpha);
          ctx.fillRect(right ? v.width - wUp : 0, yTop, wUp, h);
          ctx.fillStyle = withAlpha(theme.down, alpha);
          ctx.fillRect(right ? v.width - wUp - wDown : wUp, yTop, wDown, h);
        }

      },
    },
    {
      // Line and label across the POC (the price with the most volume). Drawn in front so candles do not hide it.
      type: 'custom',
      draw(v, { inputs }, self) {
        const p = self.state.profile;
        if (inputs.poc !== 'on' || !p || !(p.max > 0)) return;
        const { ctx, theme } = v;
        const right = inputs.side === 'right';
        const k2px = (v.width * inputs.width) / 100 / p.max;
        const price = p.lo + (p.poc + 0.5) * p.step;
        const y = Math.round(v.y(price)) + 0.5;
        const color = self.color(3);
        const x0 = right ? 0 : p.max * k2px;
        const x1 = right ? v.width - p.max * k2px : v.width;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.strokeStyle = withAlpha(color, 0.85);
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `10.5px ${theme.mono}`;
        const text = `POC ${self.format(price)}`;
        const tw = ctx.measureText(text).width + 10;
        const tx = right ? 6 : v.width - tw - 6;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(tx, y - 8.5, tw, 16, 2);
        ctx.fill();
        ctx.fillStyle = contrastText(color);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tx + 5, y + 0.5);
      },
    },
  ],
  legend(_ctx, _i, theme, self) {
    const p = self.state.profile;
    if (!p) return [];
    return [
      { k: 'POC', v: self.format(p.lo + (p.poc + 0.5) * p.step), color: self.color(3) },
      { k: 'VA', v: `${self.format(p.lo + p.vaLow * p.step)} – ${self.format(p.lo + (p.vaHigh + 1) * p.step)}` },
      { k: t('Total'), v: formatCompact(p.total), color: theme.textMuted },
    ];
  },
  calc() {},
});

const picked = [];

indicators.register({
  id: 'bubbles',
  name: 'Volume Bubbles',
  title: 'Volume Bubbles',
  category: 'Volume',
  overlay: true,
  precision: 'volume',
  inputs: {
    size: { type: 'int', label: 'Largest radius (px)', default: 26, min: 4, max: 80 },
    min: { type: 'int', label: 'Minimum shown (% of max)', default: 10, min: 0, max: 95, inTitle: false },
    source: { type: 'source', label: 'Bubble position', default: 'close' },
  },
  plots: [
    {
      key: 'volume',
      type: 'custom',
      column: 'volume',
      legend: true,
      label: 'Size',
      color: 'muted',
      draw(v, { data, inputs, src }, self) {
        if (v.b < v.a) return;
        const vol = self.array;
        const index = self.index;
        const range = index.query(vol, vol, v.a, v.b);
        if (!range || !(range.max > 0)) return;
        const max = range.max;

        // Pick only the large volumes in the visible range. The LOD maxima prune the search,
        // so even with a million visible ticks the work is proportional to the number picked.
        // Too many overlapping circles are unreadable, so cap the count by the plot width.
        // When there are too many, raise the threshold and keep only the largest.
        const limit = Math.max(60, Math.min(400, Math.round(v.width / 5)));
        let threshold = (max * inputs.min) / 100;
        for (let attempt = 0; attempt < 16; attempt++) {
          picked.length = 0;
          index.forEachAbove(vol, v.a, v.b, threshold, (i) => picked.push(i) <= limit);
          if (picked.length <= limit) break;
          threshold = Math.max(threshold * 1.25, max * 0.02);
        }

        const { ctx, theme, x0, bs } = v;
        const price = src(inputs.source);
        const up = new Path2D();
        const down = new Path2D();
        // The radius follows the square root, so the area is proportional to volume.
        const scale = inputs.size / Math.sqrt(max);
        for (let k = 0; k < picked.length && k < limit; k++) {
          const i = picked[k];
          const r = Math.max(1.5, Math.sqrt(vol[i]) * scale);
          const X = x0 + i * bs;
          const Y = v.y(price[i]);
          const path = data.isUp(i) ? up : down;
          path.moveTo(X + r, Y);
          path.arc(X, Y, r, 0, 6.2832);
        }
        ctx.lineWidth = 1;
        for (const [path, color] of [[up, theme.up], [down, theme.down]]) {
          ctx.fillStyle = withAlpha(color, 0.2);
          ctx.fill(path);
          ctx.strokeStyle = withAlpha(color, 0.85);
          ctx.stroke(path);
        }
      },
    },
  ],
  calc({ src, inputs }) {
    src(inputs.source); // keep the cache of derived series (hl2 etc.) up to date
  },
});

/**
 * Compute a volume heatmap (traded volume per time × price cell).
 *
 * Cells are `group` bars wide and `step` in price tall. Cell edges are pinned to round positions
 * in index and price, so the pattern does not shimmer while scrolling.
 * A bar that spans several rows is distributed in proportion to its high–low overlap.
 *
 * @returns {{ cells: Float32Array, cols: number, rows: number, col0: number, row0: number,
 *            group: number, step: number, max: number, total: number } | null}
 */
export function computeHeatmap(data, a, b, group, step, { maxSamples = 300_000, maxRows = 600, out = null } = {}) {
  const r = data.range(a, b);
  if (!r || !(step > 0) || group < 1) return null;
  while ((r.max - r.min) / step > maxRows) step *= 2;
  const row0 = Math.floor(r.min / step);
  const rows = Math.floor(r.max / step) - row0 + 1;
  const col0 = Math.floor(a / group);
  const cols = Math.floor(b / group) - col0 + 1;
  const size = cols * rows;
  const cells = out?.cells?.length >= size ? out.cells.fill(0, 0, size) : new Float32Array(size);
  const { high, low, volume } = data;
  const stride = Math.max(1, Math.floor((b - a + 1) / maxSamples));
  const last = rows - 1;

  for (let i = a; i <= b; i += stride) {
    const vol = volume[i] * stride;
    if (!(vol > 0)) continue;
    const base = (Math.floor(i / group) - col0) * rows;
    const l = low[i];
    const h = high[i];
    const k0 = Math.min(last, Math.max(0, Math.floor(l / step) - row0));
    const k1 = Math.min(last, Math.max(0, Math.floor(h / step) - row0));
    if (k0 === k1) {
      cells[base + k0] += vol;
      continue;
    }
    const per = vol / (h - l);
    for (let k = k0; k <= k1; k++) {
      const overlap = Math.min(h, (row0 + k + 1) * step) - Math.max(l, (row0 + k) * step);
      if (overlap > 0) cells[base + k] += per * overlap;
    }
  }
  let max = 0;
  let total = 0;
  for (let j = 0; j < size; j++) {
    total += cells[j];
    if (cells[j] > max) max = cells[j];
  }
  return { cells, cols, rows, col0, row0, group, step, max, total };
}

const HEAT_LEVELS = 20;

indicators.register({
  id: 'heatmap',
  name: 'Volume Heatmap',
  title: 'Volume Heatmap',
  category: 'Volume',
  overlay: true,
  precision: 'inherit',
  inputs: {
    cell: { type: 'int', label: 'Cell height (px)', default: 9, min: 3, max: 40, inTitle: false },
    column: { type: 'int', label: 'Cell width (px, at least)', default: 7, min: 2, max: 60, inTitle: false },
    strength: { type: 'int', label: 'Strength (%)', default: 80, min: 20, max: 100, inTitle: false },
    curve: { type: 'select', label: 'Shading', default: 'sqrt', options: [['sqrt', 'Standard (keeps small values visible)'], ['linear', 'Proportional (emphasizes large values)']] },
  },
  plots: [
    {
      type: 'custom',
      back: true,
      draw(v, { data, inputs }, self) {
        const st = self.state;
        st.heat = null;
        if (v.b < v.a) return;
        const { ctx, dpr, x0, bs, scale } = v;
        // Cell size: a whole number of bars wide; the height is "value per px × cell height" rounded to a nice value.
        const group = Math.max(1, Math.ceil(inputs.column / bs));
        const perPx = Math.abs(scale.value(0) - scale.value(v.height)) / v.height;
        const step = Math.max(niceStep(perPx * inputs.cell, 1), self.tickSize);
        const hm = (st.heat = computeHeatmap(data, v.a, v.b, group, step, { out: st.grid }));
        if (!hm || !(hm.max > 0)) return;
        st.grid = hm;

        // Shade with a single hue (more volume is simply darker). Colors are quantized into levels and filled in batches.
        const paths = Array.from({ length: HEAT_LEVELS }, () => new Path2D());
        const linear = inputs.curve === 'linear';
        v.bitmap();
        const ys = new Int32Array(hm.rows + 1);
        for (let k = 0; k <= hm.rows; k++) ys[k] = Math.round(v.y((hm.row0 + k) * hm.step) * dpr);
        for (let c = 0; c < hm.cols; c++) {
          const X0 = Math.round((x0 + ((hm.col0 + c) * group - 0.5) * bs) * dpr);
          const X1 = Math.round((x0 + ((hm.col0 + c + 1) * group - 0.5) * bs) * dpr);
          const base = c * hm.rows;
          for (let k = 0; k < hm.rows; k++) {
            const val = hm.cells[base + k];
            if (!(val > 0)) continue;
            const t = linear ? val / hm.max : Math.sqrt(val / hm.max);
            const level = Math.min(HEAT_LEVELS - 1, Math.floor(t * HEAT_LEVELS));
            paths[level].rect(X0, ys[k + 1], X1 - X0, ys[k] - ys[k + 1]);
          }
        }
        const color = self.color('heat');
        const top = inputs.strength / 100;
        for (let level = 0; level < HEAT_LEVELS; level++) {
          ctx.fillStyle = withAlpha(color, (0.04 + 0.96 * ((level + 0.5) / HEAT_LEVELS)) * top);
          ctx.fill(paths[level]);
        }
        ctx.restore();
      },
    },
  ],
  legend(_ctx, _i, theme, self) {
    const hm = self.state.heat;
    if (!hm) return [];
    return [
      { k: t('Cell'), v: `${t('{n} bars', { n: hm.group })} × ${self.format(hm.step)}`, color: theme.textMuted },
      { k: t('Max'), v: formatCompact(hm.max), color: self.color('heat') },
    ];
  },
  calc() {},
});
