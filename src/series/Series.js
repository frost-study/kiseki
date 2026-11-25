import { MinMaxIndex } from '../core/MinMaxIndex.js';
import { formatCompact, formatPercent, formatPrice, formatSigned } from '../core/format.js';
import { t } from '../core/i18n.js';

/**
 * Base class for main series. A new chart type extends it, implements draw(),
 * and registers itself with seriesTypes.register(Class).
 *
 * Required:
 *   static id / static label   registry id and display name
 *   draw(view)                 drawing (see core/plots.js for the contents of view)
 * Optional:
 *   static icon                menu icon (the d of a 24×24 SVG path)
 *   static defaults            default options
 *   static ohlc                true for types that show O/H/L/C individually (changes the legend)
 *   onData(from)               update derived data when [from, n) changed
 *   range(a, b)                value range over the visible range [a, b] (for autoscaling)
 */
export class Series {
  static id = 'series';
  static label = '';
  static icon = '';
  static defaults = {};
  static ohlc = false;

  constructor(options = {}) {
    this.options = { ...this.constructor.defaults, ...options };
    this.kind = 'series';
    this.visible = true;
    this.scaleId = 'right';
    this.precision = 2;
    /** @type {import('../core/BarData.js').BarData | null} */
    this.data = null;
    this.chart = null;
    this.pane = null;
    this.#closeIndex = new MinMaxIndex();
  }

  #closeIndex;

  get title() {
    return t(this.constructor.label);
  }

  attach(chart, pane) {
    this.chart = chart;
    this.pane = pane;
  }

  setData(data) {
    this.data = data;
    this.update(0);
  }

  /** The data changed in [from, n). */
  update(from) {
    const d = this.data;
    if (!d) return;
    if (!d.aliased) this.#closeIndex.update(d.close, d.close, Math.min(from, this.#closeIndex.n), d.length);
    this.onData(from);
  }

  onData(_from) {}

  /** LOD index over closes (used to draw line-style series and for their value range). */
  get closeIndex() {
    return this.data.aliased ? this.data.minmax() : this.#closeIndex;
  }

  /** Value range over the visible range. Defaults to low–high. */
  range(a, b) {
    return this.data.range(a, b);
  }

  closeRange(a, b) {
    const d = this.data;
    return this.closeIndex.query(d.close, d.close, a, b);
  }

  /** Base value for the percent scale. */
  baseValue(i) {
    return this.data.close[i];
  }

  /** Price text. A host can replace it with the chart option `formatPrice`. */
  format(v) {
    const custom = this.chart?.options?.formatPrice;
    return custom ? custom(v) : formatPrice(v, this.precision);
  }

  drawBack(_view) {}

  draw(_view) {}

  /** Legend values: [{k: label, v: value, color}] */
  legend(i, theme) {
    const d = this.data;
    if (!d || i < 0 || i >= d.length) return [];
    const o = d.open[i];
    const c = d.close[i];
    const prev = i > 0 ? d.close[i - 1] : o;
    const chg = c - prev;
    const chgColor = chg >= 0 ? theme.up : theme.down;
    const change = { v: `${formatSigned(chg, this.precision)} (${formatPercent(prev ? (chg / prev) * 100 : 0)})`, color: chgColor };
    if (d.aliased) {
      return [{ k: t('Price'), v: this.format(c), color: chgColor }, { k: t('Size'), v: formatCompact(d.volume[i]) }, change];
    }
    if (!this.constructor.ohlc) return [{ k: t('C'), v: this.format(c), color: chgColor }, change];
    const color = c >= o ? theme.up : theme.down;
    return [
      { k: t('O'), v: this.format(o), color },
      { k: t('H'), v: this.format(d.high[i]), color },
      { k: t('L'), v: this.format(d.low[i]), color },
      { k: t('C'), v: this.format(c), color },
      change,
    ];
  }

  /** Last-value labels for the price axis: [{value, color, line}] */
  lastValues(theme) {
    const d = this.data;
    const n = d ? d.length : 0;
    if (!n) return [];
    const c = d.close[n - 1];
    const ref = this.constructor.ohlc && !d.aliased ? d.open[n - 1] : n > 1 ? d.close[n - 2] : c;
    return [{ value: c, color: c >= ref ? theme.up : theme.down, line: true }];
  }
}
