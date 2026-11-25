/**
 * Mini chart: a card with the symbol's price, the change over a period, and a small chart.
 * Hovering the chart shows the value and time at that point in the numbers above.
 * The bar underneath shows where the price sits between the period low and high.
 *
 *   <kiseki-mini-chart symbol="FABLE" range="1M"></kiseki-mini-chart>
 *
 * Options: symbol, range ('1D'|'1W'|'1M'|'3M'|'1Y'|'ALL'), theme, scheme, lang, live ('false' to stop)
 */
import { Chart } from '../core/Chart.js';
import { formatDateTime, formatPercent, formatPrice, formatSigned } from '../core/format.js';
import { t } from '../core/i18n.js';
import { h } from './dom.js';
import { loadRange, rangeById, rangeStats } from './ranges.js';
import { flag, getFeed, mountWidget, onLocaleChange, setWidgetLocale } from './shared.js';

export function createMiniChart(container, options = {}) {
  const feed = options.feed ?? getFeed();
  if (options.lang) setWidgetLocale(options.lang);
  const mount = mountWidget(container, 'kw-card kw-mini', options);
  const symbol = feed.symbol(options.symbol) ? options.symbol : feed.symbols[0].id;
  const info = feed.symbol(symbol);
  const range = rangeById(options.range);
  const utcOffset = -new Date().getTimezoneOffset() * 60_000;

  const el = {
    desc: h('span', { class: 'desc' }),
    when: h('span', { class: 'when' }),
    last: h('span', { class: 'last' }, '—'),
    chg: h('span', { class: 'chg' }),
    plot: h('div', { class: 'plot' }),
    low: h('span'),
    high: h('span'),
    dot: h('span', { class: 'dot' }),
  };
  mount.root.append(
    h('div', { class: 'head' }, h('span', { class: 'sym' }, symbol), el.desc, el.when),
    h('div', { class: 'price' }, el.last, el.chg),
    el.plot,
    h('div', { class: 'band' }, el.low, h('span', { class: 'track' }, el.dot), el.high),
  );

  const chart = new Chart(el.plot, {
    theme: mount.theme,
    type: 'area',
    legend: false,
    priceAxis: false,
    timeAxis: false,
    grid: false,
    interactive: false,
    crosshair: 'vertical',
    priceLine: false,
    rightOffset: 0,
    utcOffset,
    series: { width: 1.5, markers: false },
  });
  chart.setSymbol({ name: symbol, precision: info.precision });

  let data = null;
  let from = -Infinity;
  let stats = null;
  let hover = null;
  let unsubscribe = null;
  let dead = false;
  let queued = false;
  const price = (v) => formatPrice(v, info.precision);

  function render() {
    queued = false;
    el.desc.textContent = t(info.description);
    if (!stats) return;
    // While hovering, show the value at that point and the change from the start of the period up to it.
    const value = hover ? hover.close : stats.last;
    const change = value - stats.ref;
    el.last.textContent = price(value);
    // Narrow cards show only the percentage (CSS hides .abs).
    el.chg.replaceChildren(h('span', { class: 'abs' }, `${formatSigned(change, info.precision)} `), `(${formatPercent(stats.ref ? (change / stats.ref) * 100 : 0)})`);
    el.chg.className = `chg ${change >= 0 ? 'up' : 'down'}`;
    el.when.textContent = hover ? formatDateTime(hover.time, utcOffset, data.interval) : t(range.label);
    el.low.textContent = price(stats.low);
    el.high.textContent = price(stats.high);
    el.dot.style.left = `${stats.high > stats.low ? ((value - stats.low) / (stats.high - stats.low)) * 100 : 50}%`;
    el.low.title = t('Range low');
    el.high.title = t('Range high');
  }

  function refresh() {
    stats = rangeStats(data, from);
    if (stats) chart.setSeriesOptions({ color: stats.change >= 0 ? 'up' : 'down' });
    if (!queued) {
      queued = true;
      requestAnimationFrame(render);
    }
  }

  (async () => {
    const loaded = await loadRange(feed, symbol, range);
    if (dead) return;
    ({ data, from } = loaded);
    chart.setData(data);
    chart.fitTimeRange(from);
    refresh();
    if (flag(options.live)) {
      unsubscribe = feed.subscribe(
        symbol,
        loaded.tf,
        (bar, isNew) => {
          if (isNew) chart.append(bar);
          else chart.update(bar);
          refresh();
        },
        data,
      );
    }
  })();

  chart.on('crosshair', (c) => {
    hover = c?.bar ?? null;
    render();
  });
  mount.onAuto((theme) => chart.setTheme(theme));
  const offLocale = onLocaleChange(() => {
    chart.refreshLocale();
    render();
  });
  render();

  return {
    chart,
    destroy() {
      dead = true;
      unsubscribe?.();
      offLocale();
      chart.destroy();
      mount.destroy();
    },
  };
}
