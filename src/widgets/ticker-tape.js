/**
 * Ticker tape: a strip where prices and daily changes scroll by.
 *
 *   <kiseki-ticker-tape symbols="MYTH/USD,FABLE,AUR/JPY,NOVA" target="#chart"></kiseki-ticker-tape>
 *
 * Moving content must be pausable, so it stops on hover, on keyboard focus, and with the button on the right.
 * For people who ask the OS to reduce motion it does not move and becomes a horizontally scrollable strip.
 * Direction is shown with ▲▼ as well as color. Each symbol carries a small line of its recent prices.
 *
 * Options:
 *   symbols  symbols to show (all when omitted)
 *   speed    scroll speed (px/s, default 40)
 *   mode     'static' lays the items out in a row without scrolling
 *   target   CSS selector of elements whose symbol attribute is set when an item is clicked (links other widgets)
 *   theme, scheme, lang
 */
import { formatPercent, formatPrice } from '../core/format.js';
import { t } from '../core/i18n.js';
import { ICON, h, svg } from './dom.js';
import { quotesFor } from './quotes.js';
import { pickTimeframe } from './ranges.js';
import { getFeed, list, mountWidget, onLocaleChange, setWidgetLocale } from './shared.js';

const SPARK_W = 56;
const SPARK_H = 18;

/** Turn a list of closes into a small polyline (an SVG path). */
export function sparkPath(values, width = SPARK_W, height = SPARK_H) {
  const n = values.length;
  if (n < 2) return '';
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * width;
    const y = 1 + (1 - (values[i] - lo) / span) * (height - 2);
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

export function createTickerTape(container, options = {}) {
  const feed = options.feed ?? getFeed();
  if (options.lang) setWidgetLocale(options.lang);
  const still = options.mode === 'static';
  const mount = mountWidget(container, 'kw-tape' + (still ? ' still' : ''), options);
  const root = mount.root;
  const wanted = list(options.symbols).filter((id) => feed.symbol(id));
  const symbols = wanted.length ? wanted : feed.symbols.filter((s) => !s.static).map((s) => s.id);
  const speed = Math.max(5, Number(options.speed) || 40);
  const quotes = quotesFor(feed);
  let dead = false;
  let paused = false;

  // For a seamless loop the same items are added twice and the track moves by half its width.
  const cells = new Map(symbols.map((id) => [id, []]));
  const makeCell = (id, copy) => {
    const parts = {
      last: h('span', { class: 'last' }, '—'),
      chg: h('span', { class: 'chg' }),
      path: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    };
    const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    spark.setAttribute('class', 'spark');
    spark.setAttribute('viewBox', `0 0 ${SPARK_W} ${SPARK_H}`);
    spark.setAttribute('aria-hidden', 'true');
    spark.append(parts.path);
    cells.get(id).push(parts);
    // The second copy is hidden from screen readers and keyboard focus (so nothing is announced twice).
    return h('button', { class: 'cell', 'aria-hidden': copy ? 'true' : null, tabindex: copy ? '-1' : null, onclick: () => choose(id) }, h('span', { class: 'sym' }, id), parts.last, parts.chg, spark);
  };
  const track = h('div', { class: 'track' }, symbols.map((id) => makeCell(id, false)), still ? null : symbols.map((id) => makeCell(id, true)));
  const view = h('div', { class: 'view' }, track);
  const toggle = h('button', { class: 'btn icon ctl', onclick: () => setPaused(!paused) });
  root.append(view);
  if (!still) root.append(toggle);

  function setPaused(on) {
    paused = on;
    root.classList.toggle('paused', on);
    toggle.innerHTML = svg(on ? ICON.play : ICON.pause);
    toggle.title = t(on ? 'Play' : 'Pause');
    toggle.setAttribute('aria-label', toggle.title);
  }

  function choose(id) {
    container.dispatchEvent(new CustomEvent('kiseki:symbol', { detail: { symbol: id }, bubbles: true, composed: true }));
    if (options.target) for (const el of document.querySelectorAll(options.target)) el.setAttribute('symbol', id);
  }

  /** Recompute the lap time so the speed stays the same when the width changes. */
  function measure() {
    if (still) return;
    const lap = track.scrollWidth / 2;
    if (lap > 0) track.style.setProperty('--kw-duration', `${(lap / speed).toFixed(1)}s`);
  }

  const latest = new Map();
  const closes = new Map();
  function paint(id) {
    const q = latest.get(id);
    if (!q) return;
    const precision = feed.symbol(id).precision;
    const up = q.change >= 0;
    const series = closes.get(id);
    const d = series ? sparkPath([...series, q.last]) : '';
    for (const parts of cells.get(id)) {
      parts.last.textContent = formatPrice(q.last, precision);
      parts.chg.textContent = `${up ? '▲' : '▼'} ${formatPercent(Math.abs(q.pct)).replace('+', '')}`;
      parts.chg.className = `chg ${up ? 'up' : 'down'}`;
      parts.chg.title = t(up ? 'Up from the previous close' : 'Down from the previous close');
      parts.path.setAttribute('d', d);
      parts.path.style.stroke = `var(--kc-${up ? 'up' : 'down'})`;
    }
    measure();
  }

  const offs = symbols.map((id) =>
    quotes.watch(id, (q) => {
      latest.set(id, q);
      paint(id);
    }),
  );
  // The small line comes from roughly the last two days of hourly bars.
  for (const id of symbols) {
    feed.history(id, pickTimeframe(feed, id, '1h')).then((bars) => {
      if (dead) return;
      const n = bars.length;
      closes.set(id, Array.from(bars.close.subarray(Math.max(0, n - 48), Math.max(0, n - 1))));
      paint(id);
    });
  }

  const resize = new ResizeObserver(measure);
  resize.observe(track);
  const offLocale = onLocaleChange(() => {
    setPaused(paused);
    for (const id of symbols) paint(id);
  });
  setPaused(false);

  return {
    setPaused,
    destroy() {
      dead = true;
      for (const off of offs) off();
      offLocale();
      resize.disconnect();
      mount.destroy();
    },
  };
}
