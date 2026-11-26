import { BarData } from '../core/BarData.js';
import { t } from '../core/i18n.js';
import { seriesTypes } from '../core/Registry.js';
import { conflatedOhlc, drawColumns, fillArea, strokeLine } from '../core/plots.js';
import { resolveColor, withAlpha } from '../core/theme.js';
import { Series } from './Series.js';

/* ───────────── Candlesticks ───────────── */

export class CandlestickSeries extends Series {
  static id = 'candlestick';
  static label = 'Candlestick';
  static icon = 'M8 3v3M8 16v5M5.5 6h5v10h-5zM16 5v4M16 15v4M13.5 9h5v6h-5z';
  static ohlc = true;
  static defaults = { hollow: false };

  /** The OHLC used for drawing (Heikin-Ashi overrides this). */
  source() {
    return this.data;
  }

  range(a, b) {
    return this.source().range(a, b);
  }

  draw(v) {
    if (v.b < v.a) return;
    const d = this.source();
    const { ctx, dpr, bs, x0, y, theme } = v;
    const px = bs * dpr;
    const up = new Path2D();
    const dn = new Path2D();
    v.bitmap();
    if (px < 2) {
      conflatedOhlc(v, d, up, dn);
    } else {
      // Match the parity of the wick and body widths so the wick sits in the middle of the body.
      const ww = px >= 10 ? Math.max(1, Math.floor(dpr)) : 1;
      let bw = Math.max(ww, Math.floor(px * 0.72));
      if ((bw - ww) & 1) bw = Math.max(ww, bw - 1);
      const hb = bw >> 1;
      const hw = ww >> 1;
      const lw = Math.max(1, Math.floor(dpr));
      const hollow = this.options.hollow && bw >= 5 * lw;
      const O = d.open;
      const H = d.high;
      const L = d.low;
      const C = d.close;
      for (let i = v.a; i <= v.b; i++) {
        const o = O[i];
        const c = C[i];
        const X = Math.round((x0 + i * bs) * dpr);
        const yo = Math.round(y(o) * dpr);
        const yc = Math.round(y(c) * dpr);
        const yh = Math.round(y(H[i]) * dpr);
        const yl = Math.round(y(L[i]) * dpr);
        const top = Math.min(yo, yc);
        const hgt = Math.max(1, Math.abs(yc - yo));
        const isUp = c >= o;
        const p = isUp ? up : dn;
        if (hollow && isUp && hgt > 2 * lw) {
          if (top > yh) p.rect(X - hw, yh, ww, top - yh);
          if (yl > top + hgt) p.rect(X - hw, top + hgt, ww, yl - top - hgt);
          p.rect(X - hb, top, bw, lw);
          p.rect(X - hb, top + hgt - lw, bw, lw);
          p.rect(X - hb, top + lw, lw, hgt - 2 * lw);
          p.rect(X - hb + bw - lw, top + lw, lw, hgt - 2 * lw);
        } else {
          p.rect(X - hw, yh, ww, Math.max(1, yl - yh));
          p.rect(X - hb, top, bw, hgt);
        }
      }
    }
    ctx.fillStyle = theme.up;
    ctx.fill(up);
    ctx.fillStyle = theme.down;
    ctx.fill(dn);
    ctx.restore();
  }
}

export class HollowCandleSeries extends CandlestickSeries {
  static id = 'hollow';
  static label = 'Hollow candles';
  static icon = 'M8 3v3M8 16v5M5.5 6h5v10h-5zM16 5v4M16 15v4M13.5 9h5v6h-5zM14.5 10h3v4h-3z';
  static defaults = { hollow: true };
}

/** Heikin-Ashi: derive smoothed OHLC from the source data and draw it like candlesticks. */
export class HeikinAshiSeries extends CandlestickSeries {
  static id = 'heikinashi';
  static label = 'Heikin-Ashi';
  static icon = 'M6 6v12M4 9h4v6H4zM12 4v12M10 7h4v6h-4zM18 3v10M16 5h4v5h-4z';

  #ha = new BarData(256);

  source() {
    return this.#ha;
  }

  onData(from) {
    const d = this.data;
    const ha = this.#ha;
    const n = d.length;
    ha.ensure(n);
    for (let i = Math.max(0, from); i < n; i++) {
      const o = d.open[i];
      const h = d.high[i];
      const l = d.low[i];
      const c = d.close[i];
      const hc = (o + h + l + c) / 4;
      const ho = i === 0 ? (o + c) / 2 : (ha.open[i - 1] + ha.close[i - 1]) / 2;
      ha.time[i] = d.time[i];
      ha.open[i] = ho;
      ha.close[i] = hc;
      ha.high[i] = Math.max(h, ho, hc);
      ha.low[i] = Math.min(l, ho, hc);
    }
    ha.length = n;
    ha.touch(Math.max(0, from));
  }

  legend(i, theme) {
    const ha = this.#ha;
    if (i < 0 || i >= ha.length) return [];
    const color = ha.close[i] >= ha.open[i] ? theme.up : theme.down;
    return [
      { k: t('O'), v: this.format(ha.open[i]), color },
      { k: t('H'), v: this.format(ha.high[i]), color },
      { k: t('L'), v: this.format(ha.low[i]), color },
      { k: t('C'), v: this.format(ha.close[i]), color },
    ];
  }
}

/* ───────────── Bars ───────────── */

export class BarSeries extends Series {
  static id = 'bars';
  static label = 'Bars (OHLC)';
  static icon = 'M8 4v16M5 8h3M8 15h3M16 6v13M13 16h3M16 9h3';
  static ohlc = true;

  draw(v) {
    if (v.b < v.a) return;
    const d = this.data;
    const { ctx, dpr, bs, x0, y, theme } = v;
    const px = bs * dpr;
    const up = new Path2D();
    const dn = new Path2D();
    v.bitmap();
    if (px < 3) {
      conflatedOhlc(v, d, up, dn);
    } else {
      const ww = Math.max(1, Math.round(Math.min(px * 0.14, 2 * dpr)));
      const hw = ww >> 1;
      const tick = Math.max(1, Math.floor(px * 0.36));
      for (let i = v.a; i <= v.b; i++) {
        const o = d.open[i];
        const c = d.close[i];
        const X = Math.round((x0 + i * bs) * dpr) - hw;
        const yh = Math.round(y(d.high[i]) * dpr);
        const yl = Math.round(y(d.low[i]) * dpr);
        const p = c >= o ? up : dn;
        p.rect(X, yh, ww, Math.max(1, yl - yh));
        p.rect(X - tick, Math.round(y(o) * dpr) - hw, tick, ww);
        p.rect(X + ww, Math.round(y(c) * dpr) - hw, tick, ww);
      }
    }
    ctx.fillStyle = theme.up;
    ctx.fill(up);
    ctx.fillStyle = theme.down;
    ctx.fill(dn);
    ctx.restore();
  }
}

/** Show the high–low range as a band. */
export class HighLowSeries extends Series {
  static id = 'highlow';
  static label = 'High–low range';
  static icon = 'M5 8h4v10H5zM10.5 5h4v9h-4zM16 9h4v8h-4z';
  static ohlc = true;

  draw(v) {
    if (v.b < v.a) return;
    const d = this.data;
    const { ctx, dpr, bs, x0, y, theme } = v;
    const px = bs * dpr;
    const up = new Path2D();
    const dn = new Path2D();
    v.bitmap();
    if (px < 2) {
      conflatedOhlc(v, d, up, dn);
    } else {
      const bw = Math.max(1, Math.floor(px * 0.72));
      const hb = bw >> 1;
      for (let i = v.a; i <= v.b; i++) {
        const X = Math.round((x0 + i * bs) * dpr);
        const yh = Math.round(y(d.high[i]) * dpr);
        const yl = Math.round(y(d.low[i]) * dpr);
        (d.close[i] >= d.open[i] ? up : dn).rect(X - hb, yh, bw, Math.max(1, yl - yh));
      }
    }
    ctx.fillStyle = theme.up;
    ctx.fill(up);
    ctx.fillStyle = theme.down;
    ctx.fill(dn);
    ctx.restore();
  }
}

/* ───────────── Line-style series ───────────── */

export class LineSeries extends Series {
  static id = 'line';
  static label = 'Line';
  static icon = 'M3 17l5-6 4 3 4-7 5 4';
  static defaults = { color: null, width: 1.75, step: false, markers: true };

  color(theme) {
    // The color can be '#rrggbb' or a role name such as 'up' / 'down' / 'accent'.
    return resolveColor(theme, this.options.color ?? 'series');
  }

  range(a, b) {
    return this.closeRange(a, b);
  }

  draw(v) {
    const d = this.data;
    const color = this.color(v.theme);
    strokeLine(v, d.close, d.length, { color, width: this.options.width, index: this.closeIndex, step: this.options.step });
    this.drawMarkers(v, color);
  }

  /** When zoomed in far enough, mark each point (individual ticks become visible). */
  drawMarkers(v, color) {
    if (!this.options.markers || v.bs < 9 || v.b < v.a) return;
    const { ctx, x0, bs, y } = v;
    const close = this.data.close;
    const r = Math.min(3, bs * 0.22);
    ctx.beginPath();
    for (let i = v.a; i <= v.b; i++) {
      const X = x0 + i * bs;
      const Y = y(close[i]);
      ctx.moveTo(X + r, Y);
      ctx.arc(X, Y, r, 0, 6.2832);
    }
    ctx.fillStyle = v.theme.bg;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }

  lastValues(theme) {
    const d = this.data;
    const n = d ? d.length : 0;
    return n ? [{ value: d.close[n - 1], color: this.color(theme), line: true }] : [];
  }
}

export class StepLineSeries extends LineSeries {
  static id = 'step';
  static label = 'Step line';
  static icon = 'M3 17h4v-5h4v3h4V7h6';
  static defaults = { ...LineSeries.defaults, step: true };
}

export class AreaSeries extends LineSeries {
  static id = 'area';
  static label = 'Area';
  static icon = 'M3 17l5-6 4 3 4-7 5 4v8H3zM3 17l5-6 4 3 4-7 5 4';

  draw(v) {
    const d = this.data;
    const { ctx } = v;
    const color = this.color(v.theme);
    const g = ctx.createLinearGradient(0, 0, 0, v.height);
    g.addColorStop(0, withAlpha(color, 0.28));
    g.addColorStop(1, withAlpha(color, 0.02));
    fillArea(v, d.close, d.length, v.height, g, { index: this.closeIndex });
    strokeLine(v, d.close, d.length, { color, width: this.options.width, index: this.closeIndex });
    this.drawMarkers(v, color);
  }
}

/** Relative to the value at the left edge of the view, fill above in the up color and below in the down color. */
/**
 * A line filled towards a baseline: up-colored above it, down-colored below.
 * By default the baseline is the first visible close. Options: `base` (a fixed value such as 0, which then always stays
 * in the price range) and `baseColor` (a CSS color or role name for the baseline's own line).
 */
export class BaselineSeries extends LineSeries {
  static id = 'baseline';
  static label = 'Baseline';
  static icon = 'M3 12h18M3 15l4-7 4 5 4-8 6 9';
  static defaults = { ...LineSeries.defaults, base: null, baseColor: null };

  /** The value the line is measured from: the fixed `base`, else the first visible close. */
  #base() {
    const fixed = this.options.base;
    if (typeof fixed === 'number' && Number.isFinite(fixed)) return fixed;
    const d = this.data;
    const [a] = this.chart ? this.chart.visibleBars() : [0];
    return d.close[Math.min(d.length - 1, Math.max(0, a))];
  }

  range(a, b) {
    const r = super.range(a, b);
    const fixed = this.options.base;
    if (typeof fixed !== 'number' || !Number.isFinite(fixed)) return r;
    return r ? { min: Math.min(r.min, fixed), max: Math.max(r.max, fixed) } : { min: fixed, max: fixed };
  }

  draw(v) {
    const d = this.data;
    if (v.b < v.a) return;
    const { ctx, theme } = v;
    const baseY = Math.round(v.y(this.#base())) + 0.5;
    const half = (clipTop, clipH, color) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, clipTop, v.width, clipH);
      ctx.clip();
      fillArea(v, d.close, d.length, baseY, withAlpha(color, 0.16), { index: this.closeIndex });
      strokeLine(v, d.close, d.length, { color, width: this.options.width, index: this.closeIndex });
      ctx.restore();
    };
    half(0, baseY, theme.up);
    half(baseY, v.height - baseY, theme.down);
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(v.width, baseY);
    ctx.strokeStyle = this.options.baseColor ? resolveColor(theme, this.options.baseColor) : theme.textFaint;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  lastValues(theme) {
    const d = this.data;
    const n = d ? d.length : 0;
    if (!n) return [];
    return [{ value: d.close[n - 1], color: d.close[n - 1] >= this.#base() ? theme.up : theme.down, line: true }];
  }
}

/** Show closes as columns. */
export class ColumnSeries extends Series {
  static id = 'columns';
  static label = 'Columns';
  static icon = 'M4 20V11h3.5v9zM10.25 20V5h3.5v15zM16.5 20v-7H20v7z';

  range(a, b) {
    return this.closeRange(a, b);
  }

  draw(v) {
    const d = this.data;
    const close = d.close;
    drawColumns(v, close, d.length, {
      baseY: v.height,
      colors: [withAlpha(v.theme.up, 0.85), withAlpha(v.theme.down, 0.85)],
      colorOf: (i) => (i === 0 || close[i] >= close[i - 1] ? 0 : 1),
      index: this.closeIndex,
    });
  }
}

for (const type of [
  CandlestickSeries,
  HollowCandleSeries,
  HeikinAshiSeries,
  BarSeries,
  HighLowSeries,
  LineSeries,
  StepLineSeries,
  AreaSeries,
  BaselineSeries,
  ColumnSeries,
]) {
  seriesTypes.register(type);
}
