/**
 * Symbol overview: last price, change over the chosen period, a chart and period statistics on one card.
 * Several symbols become tabs. Hovering the chart shows the value at that point in the numbers above.
 *
 *   <kiseki-symbol-overview symbols="MYTH/USD,FABLE" range="3M"></kiseki-symbol-overview>
 *
 * Options: symbols (or symbol), range, type ('area'|'candlestick'), theme, scheme, lang, live
 */
import { Chart } from '../core/Chart.js';
import { formatCompact, formatDateTime, formatPercent, formatPrice, formatSigned } from '../core/format.js';
import { t } from '../core/i18n.js';
import { ICON, h, svg } from './dom.js';
import { RANGES, loadRange, rangeById, rangeStats } from './ranges.js';
import { flag, getFeed, list, mountWidget, onLocaleChange, setWidgetLocale } from './shared.js';

export function createSymbolOverview(container, options = {}) {
  const feed = options.feed ?? getFeed();
  if (options.lang) setWidgetLocale(options.lang);
  const mount = mountWidget(container, 'kw-card kw-overview', options);
  const root = mount.root;
  const utcOffset = -new Date().getTimezoneOffset() * 60_000;
  const symbols = list(options.symbols ?? options.symbol).filter((id) => feed.symbol(id));
  // The symbol attribute is the currently selected symbol. If it is not in the list it is added at the front (so other widgets can drive it).
  if (options.symbols && options.symbol && feed.symbol(options.symbol) && !symbols.includes(options.symbol)) symbols.unshift(options.symbol);
  if (!symbols.length) symbols.push(feed.symbols[0].id);

  let symbol = symbols.includes(options.symbol) ? options.symbol : symbols[0];
  let range = rangeById(options.range);
  let type = options.type === 'candlestick' ? 'candlestick' : 'area';
  let data = null;
  let from = -Infinity;
  let stats = null;
  let hover = null;
  let unsubscribe = null;
  let token = 0;
  let dead = false;
  let queued = false;

  const el = {
    tabs: h('div', { class: 'tabs', role: 'tablist' }),
    sym: h('div', { class: 'sym' }),
    desc: h('div', { class: 'desc' }),
    last: h('span', { class: 'last' }, '—'),
    chg: h('span', { class: 'chg' }),
    when: h('span', { class: 'when' }),
    tools: h('div', { class: 'tools' }),
    plot: h('div', { class: 'plot' }),
    stats: h('dl', { class: 'stats' }),
  };
  if (symbols.length > 1) root.append(el.tabs);
  root.append(
    h('div', { class: 'head' }, h('div', { class: 'id' }, el.sym, el.desc), h('div', { class: 'price' }, el.last, el.chg, el.when), h('div', { class: 'spacer' }), el.tools),
    el.plot,
    el.stats,
  );

  const chart = new Chart(el.plot, {
    theme: mount.theme,
    type,
    legend: false,
    interactive: false,
    rightOffset: 0,
    grid: 'horizontal',
    utcOffset,
    series: { width: 1.75, markers: false },
  });

  const info = () => feed.symbol(symbol);
  const price = (v) => formatPrice(v, info().precision);

  /** Symbol tabs and the period / type switches (rebuilt when the language or the selection changes). */
  function renderControls() {
    el.tabs.replaceChildren(
      ...symbols.map((id) => h('button', { class: 'tab' + (id === symbol ? ' on' : ''), role: 'tab', 'aria-selected': id === symbol, onclick: () => select(id) }, id)),
    );
    el.tools.replaceChildren(
      h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': t('Visible range') },
        RANGES.map((r) => h('button', { class: 'btn' + (r === range ? ' on' : ''), 'aria-pressed': r === range, onclick: () => setRange(r.id) }, t(r.label))),
      ),
      h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': t('Chart type') },
        [['area', ICON.area, 'Area'], ['candlestick', ICON.candles, 'Candlestick']].map(([id, icon, label]) =>
          h('button', { class: 'btn icon' + (id === type ? ' on' : ''), title: t(label), 'aria-pressed': id === type, html: svg(icon), onclick: () => setType(id) }),
        ),
      ),
    );
  }

  function render() {
    queued = false;
    const meta = info();
    el.sym.textContent = symbol;
    el.desc.textContent = `${t(meta.description)} · ${t(meta.kind)}`;
    if (!stats) return;
    const value = hover ? hover.close : stats.last;
    const change = value - stats.ref;
    const pct = stats.ref ? (change / stats.ref) * 100 : 0;
    el.last.textContent = price(value);
    el.chg.textContent = `${formatSigned(change, meta.precision)} (${formatPercent(pct)})`;
    el.chg.className = `chg ${change >= 0 ? 'up' : 'down'}`;
    el.when.textContent = hover ? formatDateTime(hover.time, utcOffset, data.interval) : t('change over {range}', { range: t(range.label) });
    const spread = stats.low ? ((stats.high - stats.low) / stats.low) * 100 : 0;
    el.stats.replaceChildren(
      ...[
        ['Range high', price(stats.high)],
        ['Range low', price(stats.low)],
        ['Spread', `${price(stats.high - stats.low)} (${spread.toFixed(1)}%)`],
        ['Volume', formatCompact(stats.volume)],
      ].map(([label, value]) => h('div', null, h('dt', null, t(label)), h('dd', null, value))),
    );
  }

  function refresh() {
    stats = data ? rangeStats(data, from) : null;
    if (stats && type === 'area') chart.setSeriesOptions({ color: stats.change >= 0 ? 'up' : 'down' });
    if (!queued) {
      queued = true;
      requestAnimationFrame(render);
    }
  }

  async function load() {
    const mine = ++token;
    unsubscribe?.();
    unsubscribe = null;
    hover = null;
    const loaded = await loadRange(feed, symbol, range);
    if (dead || mine !== token) return;
    ({ data, from } = loaded);
    chart.setSymbol({ name: symbol, precision: info().precision });
    chart.setType(type);
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
  }

  function select(id) {
    if (id === symbol || !symbols.includes(id)) return;
    symbol = id;
    renderControls();
    load();
    container.dispatchEvent(new CustomEvent('kiseki:symbol', { detail: { symbol: id }, bubbles: true, composed: true }));
  }

  function setRange(id) {
    range = rangeById(id);
    renderControls();
    load();
  }

  function setType(id) {
    type = id;
    chart.setType(id);
    renderControls();
    refresh();
  }

  chart.on('crosshair', (c) => {
    hover = c?.bar ?? null;
    render();
  });
  mount.onAuto((theme) => chart.setTheme(theme));
  const offLocale = onLocaleChange(() => {
    chart.refreshLocale();
    renderControls();
    render();
  });
  renderControls();
  render();
  load();

  return {
    chart,
    select,
    setRange,
    setType,
    destroy() {
      dead = true;
      unsubscribe?.();
      offLocale();
      chart.destroy();
      mount.destroy();
    },
  };
}
