/**
 * Advanced chart (an embeddable component).
 *
 * It only builds toolbars, menus and dialogs and calls the public Chart API; it never touches chart internals.
 * Menus list the registries (seriesTypes / indicators / drawingTools) directly,
 * so types and tools added by plugins show up automatically.
 *
 *   <kiseki-advanced-chart symbol="FABLE" timeframe="1h" theme="dark"></kiseki-advanced-chart>
 *   createAdvancedChart(element, { symbol: 'FABLE', timeframe: '1h' })
 *
 * Options (attributes of the same name on the custom element; multi-word ones are kebab-case):
 *   symbol, timeframe, type        initial symbol, timeframe and chart type
 *   theme ('light'|'dark'|'auto'), scheme ('wa'|'intl'|'sumi'), lang ('ja'|'en')
 *   indicators                     ids of the initial indicators ('sma,rsi'; empty for none)
 *   live ('false' to stop), speed  live playback speed
 *   hide                           parts to hide: mast (header) / strip (controls) / dock (drawing tools) / brand
 *   symbol-change ('false' forbids switching symbols)
 *   persist                        localStorage key for saving settings (nothing is saved when omitted)
 *   sample-trades ('true' shows synthetic trade markers, for demos; your own go through `api.chart.trades.set()`)
 *   feed                           data feed (only when created from JavaScript; the shared one by default)
 */
import { Chart } from '../core/Chart.js';
import { indicators, drawingTools, seriesTypes } from '../core/Registry.js';
import * as format from '../core/format.js';
import { getLocale, t } from '../core/i18n.js';
import { candleSchemes, themes } from '../core/theme.js';
import { decodeText, parseCsv } from '../data/csv.js';
import { sampleTrades } from '../data/sample-trades.js';
import { TIMEFRAMES, timeframeById } from '../data/timeframes.js';
import * as ui from './dom.js';
import { ICON, h, menuItem, svg } from './dom.js';
import { flag, getFeed, list, mountWidget, onLocaleChange, setWidgetLocale } from './shared.js';

const DAY = 86_400_000;

export function createAdvancedChart(container, options = {}) {
  /* ───────────── State ───────────── */

  const storeKey = options.persist || null;

  function loadSaved() {
    if (!storeKey) return {};
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? 'null') ?? {};
    } catch {
      return {};
    }
  }

  const saved = loadSaved();
  const state = {
    symbol: 'MYTH/USD',
    tf: '1h',
    type: 'candlestick',
    tickType: 'line',
    theme: 'auto',
    scheme: 'wa',
    live: true,
    speed: 20,
    sampleTrades: false,
    layout: null,
    drawings: {},
    ...saved,
  };
  // Options from the caller take priority over saved settings.
  for (const [key, option] of [['symbol', 'symbol'], ['tf', 'timeframe'], ['type', 'type'], ['theme', 'theme'], ['scheme', 'scheme'], ['speed', 'speed']]) {
    if (options[option] !== undefined && options[option] !== null) state[key] = key === 'speed' ? Number(options[option]) || 20 : options[option];
  }
  if (options.live !== undefined) state.live = flag(options.live);
  if (options.sampleTrades !== undefined) state.sampleTrades = flag(options.sampleTrades);
  // The UI language is page-wide. Without a storage key (plain embeds) keep whatever the page already uses;
  // otherwise follow the browser language on a first visit.
  const fallbackLang = !storeKey ? getLocale() : navigator.language?.startsWith('ja') ? 'ja' : 'en';
  state.lang = setWidgetLocale(options.lang ?? state.lang ?? fallbackLang);

  const utcOffset = -new Date().getTimezoneOffset() * 60_000;
  const feed = options.feed ?? getFeed();
  feed.speed = state.speed;
  if (!feed.symbol(state.symbol)) state.symbol = feed.symbols[0].id;
  if (!timeframeById.has(state.tf)) state.tf = '1h';

  /* ───────────── Layout ───────────── */

  const hidden = new Set(list(options.hide));
  const mount = mountWidget(container, 'kw-workspace' + ['mast', 'strip', 'dock'].filter((part) => hidden.has(part)).map((part) => ` no-${part}`).join(''), { theme: state.theme, scheme: state.scheme });
  const root = mount.root;
  const mast = h('header', { class: 'mast' });
  const strip = h('nav', { class: 'strip', 'aria-label': t('View controls') });
  const stage = h('main', { class: 'stage' });
  const dock = h('footer', { class: 'dock' });
  const floatbar = h('div', { class: 'floatbar' });
  root.append(mast, strip, stage, dock);
  root.lang = state.lang;

  // Menus, dialogs and toasts are mounted inside this widget's root.
  const openMenu = (anchor, build) => ui.openMenu(root, anchor, build);
  const openDialog = (title, parts) => ui.openDialog(root, title, parts);
  const toast = (text) => ui.toast(root, text);

  const chart = new Chart(stage, { theme: mount.theme, scheme: state.scheme, type: state.type, utcOffset });
  stage.append(floatbar);
  stage.dataset.drop = t('Drop a CSV here to import it');
  mount.onAuto((theme) => {
    chart.setTheme(theme, state.scheme);
    renderTop();
    renderFloatbar();
  });

  if (state.layout) {
    chart.restore({ scaleMode: state.layout.scaleMode, indicators: state.layout.indicators });
  } else {
    // Initial indicators. Can be set like indicators="sma,rsi" (empty shows none).
    for (const id of options.indicators !== undefined ? list(options.indicators) : ['volume', 'sma', 'ema', 'rsi']) {
      if (indicators.has(id)) chart.addIndicator(id);
    }
  }

  let saveTimer = 0;
  let savingPaused = false;

  function saveNow() {
    clearTimeout(saveTimer);
    if (savingPaused || !storeKey) return;
    const { scaleMode, indicators: inds } = chart.serialize();
    state.layout = { scaleMode, indicators: inds };
    state.drawings[state.symbol] = chart.drawings.serialize();
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
    } catch {
      /* keep working even if saving fails */
    }
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }

  /* ───────────── Loading data and the live feed ───────────── */

  let unsubscribe = null;
  let loadToken = 0;

  const isRawTicks = () => timeframeById.get(state.tf).ticks === 1;

  // Synthetic trade markers for the demo. Markers set by the host (api.chart.trades.set) are left alone.
  let samplesShown = false;

  function applySampleTrades() {
    if (state.sampleTrades) chart.trades.set(sampleTrades(chart.data, { precision: chart.main.precision }));
    else if (samplesShown) chart.trades.clear();
    samplesShown = state.sampleTrades;
  }

  function setSampleTrades(on) {
    state.sampleTrades = !!on;
    applySampleTrades();
    save();
  }

  async function load({ keepView = false } = {}) {
    const token = ++loadToken;
    unsubscribe?.();
    unsubscribe = null;
    const sym = feed.symbol(state.symbol);
    const available = feed.timeframes(sym.id);
    if (!available.includes(state.tf)) state.tf = available.includes('1D') ? '1D' : available[0];
    const tf = timeframeById.get(state.tf);
    const data = await feed.history(sym.id, tf.id);
    if (token !== loadToken) return;
    // Raw ticks have no OHLC, so show them with a line-style type.
    chart.setType(isRawTicks() ? state.tickType : state.type);
    chart.setSymbol({ name: sym.id, description: t(sym.description), precision: sym.precision }, tf.label);
    chart.setData(data, { keepView });
    applySampleTrades();
    if (state.live && !sym.static) {
      unsubscribe = feed.subscribe(sym.id, tf.id, (bar, isNew) => (isNew ? chart.append(bar) : chart.update(bar)), data);
    }
    renderTop();
    save();
  }

  function setSymbol(id) {
    if (id === state.symbol || !feed.symbol(id)) return;
    state.drawings[state.symbol] = chart.drawings.serialize();
    state.symbol = id;
    chart.drawings.restore(state.drawings[id] ?? []);
    load();
    // Announce it so other widgets and the host page can follow.
    container.dispatchEvent(new CustomEvent('kiseki:symbol', { detail: { symbol: id }, bubbles: true, composed: true }));
  }

  function setTimeframe(id) {
    if (id === state.tf || !timeframeById.has(id)) return;
    state.tf = id;
    load({ keepView: true });
  }

  function setType(id) {
    if (isRawTicks()) state.tickType = id;
    else state.type = id;
    chart.setType(id);
    renderTop();
    save();
  }

  function setLive(on) {
    state.live = on;
    load({ keepView: true });
  }

  function setTheme(theme, scheme = state.scheme) {
    state.theme = theme;
    state.scheme = scheme;
    chart.setTheme(mount.setTheme(theme, scheme), scheme);
    renderTop();
    renderFloatbar();
    save();
  }

  /* ───────────── Header (symbol and quote) and control strip ───────────── */

  const QUICK_TF = ['tick', '1s', '1m', '5m', '15m', '1h', '4h', '1D', '1W'];
  const quote = { last: h('span', { class: 'last' }), chg: h('span', { class: 'chg' }), note: h('span', { class: 'note' }) };
  const scaleButtons = {};

  function renderTop() {
    ui.closeMenus();
    const sym = feed.symbol(state.symbol);
    const available = new Set(feed.timeframes(sym.id));
    const tf = timeframeById.get(state.tf);
    const Type = seriesTypes.get(chart.type);
    const caret = svg(ICON.caret, 'caret');
    const live = state.live && !sym.static;

    const symbolBtn = h(
      'button',
      { class: 'symbol', title: t('Switch symbol'), disabled: !flag(options.symbolChange), onclick: () => openMenu(symbolBtn, symbolMenu) },
      h('span', { class: 'sym' }, sym.id),
      h('span', { class: 'desc hide-narrow' }, `${t(sym.description)} · ${t(sym.kind)}`),
      h('span', { html: caret, style: 'display:contents' }),
    );
    const speedBtn = h('button', { class: 'btn num hide-narrow', title: t('Live playback speed'), html: `×${state.speed}${caret}`, disabled: sym.static, onclick: () => openMenu(speedBtn, speedMenu) });
    const settingsBtn = h('button', { class: 'btn icon', title: t('Settings'), html: svg(ICON.sliders), onclick: () => openMenu(settingsBtn, settingsMenu) });
    mast.replaceChildren(
      h('div', { class: 'brand hide-narrow', hidden: hidden.has('brand') }, 'Kiseki'),
      symbolBtn,
      h('div', { class: 'quote' }, quote.last, quote.chg, quote.note),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn live' + (live ? ' on' : ''), title: t('Start / stop the (synthetic) live feed'), 'aria-pressed': live, disabled: sym.static, onclick: () => setLive(!state.live) }, h('span', { class: 'dot' }), t('Live')),
      speedBtn,
      h('div', { class: 'sep hide-narrow' }),
      h('button', { class: 'btn icon hide-narrow', title: t('Save as image'), html: svg(ICON.camera), onclick: screenshot }),
      h('button', { class: 'btn icon hide-narrow', title: t('Switch theme (now: {name})', { name: t(chart.theme.label) }), html: svg(chart.theme.name === 'dark' ? ICON.sun : ICON.moon), onclick: () => setTheme(chart.theme.name === 'dark' ? 'light' : 'dark') }),
      settingsBtn,
    );

    const quick = QUICK_TF.includes(tf.id);
    const tfMore = h('button', {
      class: 'tab' + (quick ? '' : ' on'),
      title: t('All timeframes'),
      // When narrow, the quick tabs are hidden, so show the current timeframe here.
      html: `<span${quick ? ' class="show-narrow"' : ''}>${t(tf.short)}</span>${caret}`,
      onclick: () => openMenu(tfMore, timeframeMenu),
    });
    const typeBtn = h('button', { class: 'btn', title: t('Chart type'), html: `${svg(Type.icon)}<span class="hide-narrow">${t(Type.label)}</span>${caret}`, onclick: () => openMenu(typeBtn, typeMenu) });
    const rangeBtn = h('button', { class: 'btn', title: t('Visible range'), html: `<span>${t('Range')}</span>${caret}`, onclick: () => openMenu(rangeBtn, rangeMenu) });
    const mode = (id, label, title) => (scaleButtons[id] = h('button', { class: 'btn', title, onclick: () => setScale(id) }, label));
    strip.replaceChildren(
      ...QUICK_TF.map((id) => {
        const q = timeframeById.get(id);
        return h('button', { class: 'tab hide-narrow' + (id === tf.id ? ' on' : ''), title: t(q.label), disabled: !available.has(id), onclick: () => setTimeframe(id) }, t(q.short));
      }),
      tfMore,
      h('div', { class: 'sep' }),
      typeBtn,
      h('button', { class: 'btn', title: t('Add an indicator'), html: `${svg(ICON.wave)}<span>${t('Indicators')}</span>`, onclick: indicatorDialog }),
      rangeBtn,
      h('div', { class: 'spacer' }),
      h('span', { class: 'label hide-narrow' }, t('Scale')),
      h('div', { class: 'seg' }, mode('linear', t('Linear'), t('Plain values')), mode('log', t('Log'), t('Logarithmic scale')), mode('percent', '%', t('Change since the start of the visible range'))),
      h('div', { class: 'seg', style: 'margin-left:6px' }, mode('auto', t('Auto'), t('Fit the scale to the visible range'))),
    );
    updateQuote();
    updateStatus();
  }

  /** Last price and change in the header (vs the previous close for intraday, vs the previous bar for daily and up). */
  function updateQuote() {
    const d = chart.data;
    const n = d.length;
    const sym = feed.symbol(state.symbol);
    if (!n) {
      quote.last.textContent = '—';
      quote.chg.textContent = '';
      return;
    }
    const precision = chart.main.precision;
    const daily = (timeframeById.get(state.tf).ms ?? 0) >= DAY;
    let ref;
    if (daily) {
      ref = n > 1 ? d.close[n - 2] : d.open[0];
    } else {
      const dayStart = Math.floor((d.lastTime + utcOffset) / DAY) * DAY - utcOffset;
      const i = d.lowerBound(dayStart);
      ref = i > 0 ? d.close[i - 1] : d.open[0];
    }
    const last = d.close[n - 1];
    const chg = last - ref;
    quote.last.textContent = format.formatPrice(last, precision);
    // when narrow, show only the percentage
    quote.chg.replaceChildren(h('span', { class: 'hide-narrow' }, `${format.formatSigned(chg, precision)} `), `(${format.formatPercent(ref ? (chg / ref) * 100 : 0)})`);
    quote.chg.className = `chg ${chg >= 0 ? 'up' : 'down'}`;
    quote.note.textContent = `${daily ? t('vs previous bar') : t('vs previous close')} · ${sym.static ? t('imported data') : t('synthetic data')}`;
  }

  function symbolMenu(menu, close) {
    for (const s of feed.symbols) {
      menu.append(menuItem({ label: s.id, sub: `${t(s.description)} · ${t(s.kind)}`, on: s.id === state.symbol, onclick: () => (close(), setSymbol(s.id)) }));
    }
    menu.append(h('hr'), menuItem({ label: t('Import CSV…'), icon: ICON.upload, onclick: () => (close(), pickCsv()) }));
  }

  function timeframeMenu(menu, close) {
    const available = new Set(feed.timeframes(state.symbol));
    const groups = new Map();
    for (const tf of TIMEFRAMES) groups.set(tf.group, [...(groups.get(tf.group) ?? []), tf]);
    for (const [group, list] of groups) {
      menu.append(
        h('h6', null, t(group)),
        h('div', { class: 'row' }, list.map((tf) => h('button', { class: 'btn' + (tf.id === state.tf ? ' on' : ''), disabled: !available.has(tf.id), onclick: () => (close(), setTimeframe(tf.id)) }, t(tf.label)))),
      );
    }
  }

  function typeMenu(menu, close) {
    for (const Type of seriesTypes.list()) {
      menu.append(menuItem({ label: t(Type.label), icon: Type.icon, on: Type.id === chart.type, onclick: () => (close(), setType(Type.id)) }));
    }
  }

  const ranges = () => [[t('Last day'), DAY], [t('Last 5 days'), 5 * DAY], [t('Last month'), 30 * DAY], [t('Last 3 months'), 91 * DAY], [t('Last year'), 365 * DAY]];

  function rangeMenu(menu, close) {
    const show = (span) => {
      const d = chart.data;
      if (d.length) chart.showLastBars(Math.max(10, d.length - d.lowerBound(d.lastTime - span)));
    };
    for (const [label, span] of ranges()) menu.append(menuItem({ label, onclick: () => (close(), show(span)) }));
    menu.append(h('hr'), menuItem({ label: t('All data'), icon: ICON.fit, onclick: () => (close(), chart.fitContent()) }));
  }

  function speedMenu(menu, close) {
    menu.append(h('h6', null, t('Live playback speed')));
    for (const [speed, sub] of [[1, t('Real time')], [20, t('A 1-minute bar takes about 3 s')], [120, t('A 1-hour bar takes about 30 s')], [600, t('For stress testing')]]) {
      menu.append(
        menuItem({
          label: `×${speed}`,
          sub,
          on: state.speed === speed,
          onclick: () => {
            close();
            state.speed = feed.speed = speed;
            renderTop();
            save();
          },
        }),
      );
    }
  }

  function setLanguage(lang) {
    if (lang === state.lang) return;
    setWidgetLocale(lang); // reaches every widget on the page; onLocaleChange below re-renders
  }

  const offLocale = onLocaleChange((lang) => {
    state.lang = lang;
    root.lang = lang;
    strip.setAttribute('aria-label', t('View controls'));
    stage.dataset.drop = t('Drop a CSV here to import it');
    chart.refreshLocale();
    renderTop();
    renderTools();
    renderFloatbar();
    save();
  });

  function settingsMenu(menu, close) {
    menu.append(h('h6', null, '言語 / Language'));
    for (const [id, label] of [['ja', '日本語'], ['en', 'English']]) {
      menu.append(menuItem({ label, on: state.lang === id, onclick: () => (close(), setLanguage(id)) }));
    }
    menu.append(h('h6', null, t('Theme')));
    for (const [id, theme] of Object.entries(themes)) {
      menu.append(menuItem({ label: t(theme.label), on: state.theme === id, onclick: () => (close(), setTheme(id)) }));
    }
    menu.append(h('h6', null, t('Candle colors')));
    for (const [id, s] of Object.entries(candleSchemes)) {
      menu.append(menuItem({ label: t(s.label), on: state.scheme === id, onclick: () => (close(), setTheme(state.theme, id)) }));
    }
    menu.append(
      h('h6', null, t('Demo')),
      menuItem({ label: t('Sample trades'), sub: t('Synthetic entries and exits'), on: state.sampleTrades, onclick: () => (close(), setSampleTrades(!state.sampleTrades)) }),
      h('hr'),
      menuItem({ label: t('Save as image'), icon: ICON.camera, onclick: () => (close(), screenshot()) }),
      menuItem({ label: t('Import CSV…'), icon: ICON.upload, onclick: () => (close(), pickCsv()) }),
      menuItem({ label: t('Controls guide'), icon: ICON.help, onclick: () => (close(), guideDialog()) }),
      menuItem({
        label: t('Reset settings'),
        icon: ICON.reset,
        disabled: !storeKey,
        onclick: () => {
          clearTimeout(saveTimer);
          savingPaused = true;
          localStorage.removeItem(storeKey);
          location.reload();
        },
      }),
    );
  }

  /* ───────────── Indicators ───────────── */

  function indicatorDialog() {
    const list = h('div', { class: 'body' });
    const search = h('input', { class: 'search', type: 'search', placeholder: t('Search by name (e.g. moving average, RSI)'), 'aria-label': t('Search indicators') });
    const render = () => {
      const q = search.value.trim().toLowerCase();
      // Search both the source text and its translation, so it works in either language.
      const haystack = (d) => [d.id, d.name, d.title, d.category, t(d.name), t(d.title), t(d.category)].join(' ').toLowerCase();
      const defs = indicators.list().filter((d) => !q || haystack(d).includes(q));
      const groups = new Map();
      for (const d of defs) groups.set(d.category ?? t('Other'), [...(groups.get(d.category ?? t('Other')) ?? []), d]);
      list.replaceChildren();
      for (const [category, items] of groups) {
        list.append(h('h6', null, t(category)));
        for (const def of items) {
          const active = chart.indicators.filter((i) => i.def === def).length;
          list.append(
            h(
              'button',
              {
                class: 'item',
                onclick: () => {
                  chart.addIndicator(def.id);
                  toast(t('Added {name}', { name: t(def.title) }));
                  render();
                },
              },
              h('span', { class: 'grow' }, t(def.title), h('small', null, `${t(def.name)} · ${def.overlay ? t('overlay') : t('separate pane')}`)),
              active ? h('span', { class: 'badge' }, t('{n} active', { n: active })) : null,
            ),
          );
        }
      }
      if (!defs.length) list.append(h('div', { class: 'muted', style: 'padding:18px 12px' }, t('No matching indicators')));
    };
    search.addEventListener('input', render);
    render();
    openDialog(t('Indicators'), { body: h('div', { style: 'display:contents' }, search, list) });
    search.focus();
  }

  const sources = () => [['close', t({ en: 'Close', ja: '終値' })], ['open', t('Open')], ['high', t('High')], ['low', t('Low')], ['hl2', t('(H+L)/2')], ['hlc3', t('(H+L+C)/3')], ['ohlc4', t('(O+H+L+C)/4')]];

  function indicatorSettings(ind) {
    const def = ind.def;
    const form = h('div', { class: 'form' });
    const build = () => {
      form.replaceChildren();
      const inputs = Object.entries(def.inputs ?? {});
      if (inputs.length) form.append(h('h6', null, t('Parameters')));
      for (const [key, spec] of inputs) {
        let control;
        if (spec.type === 'int' || spec.type === 'float') {
          control = h('input', { type: 'number', min: spec.min, max: spec.max, step: spec.step ?? (spec.type === 'int' ? 1 : 'any'), value: ind.inputs[key] });
          control.addEventListener('input', () => {
            const v = spec.type === 'int' ? Math.round(Number(control.value)) : Number(control.value);
            if (!Number.isFinite(v) || v < (spec.min ?? -Infinity) || v > (spec.max ?? Infinity)) return;
            chart.updateIndicator(ind, { [key]: v });
          });
        } else if (spec.type === 'bool') {
          control = h('input', { type: 'checkbox', checked: ind.inputs[key] });
          control.addEventListener('change', () => chart.updateIndicator(ind, { [key]: control.checked }));
        } else {
          const choices = spec.type === 'source' ? sources() : spec.options;
          control = h('select', null, choices.map(([value, label]) => h('option', { value, selected: ind.inputs[key] === value }, t(label))));
          control.addEventListener('change', () => chart.updateIndicator(ind, { [key]: control.value }));
        }
        const id = `in-${key}`;
        control.id = id;
        form.append(h('label', { for: id }, spec.label ? t(spec.label) : key), h('div', { class: 'field' }, control));
      }
      const slots = ind.colorSlots(chart.theme);
      if (slots.length) form.append(h('h6', null, t('Colors')));
      for (const slot of slots) {
        const control = h('input', { type: 'color', value: slot.color, id: `c-${slot.key}` });
        control.addEventListener('input', () => chart.updateIndicator(ind, null, { [slot.key]: { color: control.value } }));
        form.append(h('label', { for: control.id }, slots.length > 1 ? slot.label : t('Line')), h('div', { class: 'field' }, control));
      }
      if (!inputs.length && !slots.length) form.append(h('div', { class: 'muted', style: 'grid-column:1/3;padding:6px 0' }, t('Nothing to configure')));
    };
    build();
    const dlg = openDialog(t('{name} settings', { name: t(def.title) }), {
      body: h('div', { class: 'body' }, form),
      footer: [
        h(
          'button',
          {
            class: 'btn outline',
            onclick: () => {
              ind.styles = {};
              chart.updateIndicator(ind, Object.fromEntries(Object.entries(def.inputs ?? {}).map(([k, s]) => [k, s.default])));
              build();
            },
          },
          t('Reset'),
        ),
        h('button', { class: 'btn outline', onclick: () => (dlg.close(), chart.removeIndicator(ind)) }, t('Remove')),
        h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Close')),
      ],
    });
  }

  /* ───────────── Drawing tools (bottom dock) ───────────── */

  const info = h('span', { class: 'info hide-narrow' });

  function renderTools() {
    const d = chart.drawings;
    dock.replaceChildren(
      h('button', { class: 'btn icon' + (d.tool ? '' : ' on'), title: t('Cursor (Esc)'), html: svg(ICON.cursor), onclick: () => d.setTool(null) }),
      ...drawingTools.list().map((def) => h('button', { class: 'btn icon' + (d.tool === def.id ? ' on' : ''), title: t(def.label), html: svg(def.icon), onclick: () => d.setTool(d.tool === def.id ? null : def.id) })),
      h('div', { class: 'sep' }),
      h('button', {
        class: 'btn icon' + (d.magnet ? ' on' : ''),
        title: t('Magnet (snap to OHLC)'),
        'aria-pressed': d.magnet,
        html: svg(ICON.magnet),
        onclick: () => {
          d.magnet = !d.magnet;
          renderTools();
        },
      }),
      h('button', {
        class: 'btn icon',
        title: t('Remove all drawings'),
        html: svg(ICON.trash),
        disabled: !d.items.length,
        onclick: () => {
          const n = d.items.length;
          d.clear();
          toast(t('{n} drawings removed', { n }));
        },
      }),
      // Only when there is something to show or hide.
      chart.trades.count
        ? h('button', {
            class: 'btn icon' + (chart.trades.visible ? ' on' : ''),
            title: t('Trade markers (show / hide)'),
            'aria-pressed': chart.trades.visible,
            html: svg(ICON.trades),
            onclick: () => (chart.trades.visible = !chart.trades.visible),
          })
        : null,
      h('div', { class: 'spacer' }),
      info,
    );
  }

  function renderFloatbar() {
    const d = chart.drawings;
    const item = d.selected;
    floatbar.classList.toggle('show', !!item);
    if (!item) return;
    // The first swatch is the default color. Storing null lets it follow theme changes.
    const colors = [null, ...chart.theme.palette.slice(0, 6)];
    floatbar.replaceChildren(
      ...colors.map((c) =>
        h('button', {
          class: 'swatch' + (c === (item.color ?? null) ? ' on' : ''),
          style: `background:${c ?? chart.theme.annotation}`,
          title: c ? t('Change color') : t('Default color'),
          'aria-label': c ? t('Color {c}', { c }) : t('Default color'),
          onclick: () => {
            d.setColor(item, c);
            renderFloatbar();
          },
        }),
      ),
      h('div', { class: 'sep' }),
      h('button', { class: 'btn icon', title: t('Remove (Delete)'), html: svg(ICON.trash), onclick: () => d.remove(item) }),
    );
  }

  /* ───────────── Price scale switches and status ───────────── */

  function setScale(id) {
    const scale = chart.panes[0].scale;
    if (id === 'auto') scale.auto = !scale.auto;
    else chart.setScaleMode(id);
    chart.invalidate();
    updateStatus();
    save();
  }

  const count = new Intl.NumberFormat('ja-JP');
  let lastStatus = 0;

  function updateStatus() {
    const scale = chart.panes[0].scale;
    for (const id of ['linear', 'log', 'percent']) scaleButtons[id]?.classList.toggle('on', scale.mode === id);
    scaleButtons.auto?.classList.toggle('on', scale.auto);
    const [a, b] = chart.visibleBars();
    const unit = isRawTicks() ? t('ticks') : t('bars');
    info.textContent = t('{n} {unit} · {v} visible · draw {ms} ms', { n: count.format(chart.data.length), unit, v: count.format(Math.max(0, b - a + 1)), ms: chart.stats.drawMs.toFixed(1) });
  }

  /* ───────────── Misc ───────────── */

  function screenshot() {
    chart.toCanvas().toBlob((blob) => {
      const a = h('a', { href: URL.createObjectURL(blob), download: `kiseki-${state.symbol.replace(/\W+/g, '')}-${state.tf}.png` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  function guideDialog() {
    const rows = [
      [[t('Drag')], t('Pan left and right (keeps gliding when released)')],
      [[t('Wheel'), t('Pinch')], t('Zoom around the cursor')],
      [[t('Drag the price axis')], t('Rescale prices (double-click to return to auto)')],
      [[t('Drag the time axis')], t('Rescale time (double-click to reset)')],
      [[t('Drag a pane border')], t('Resize panes')],
      [['←', '→'], t('Pan (hold Shift for bigger steps)')],
      [['↑', '↓'], t('Zoom in / out')],
      [['Home', 'End'], t('Oldest / latest bar')],
      [['Esc'], t('Cancel drawing / deselect')],
      [['Delete'], t('Remove the selected drawing')],
      [[t('Point at a trade marker')], t('Exact price, time and result of the trade')],
      [[t('Drop a CSV')], t('Import your own data (time, open, high, low, close, volume)')],
    ];
    openDialog(t('Controls guide'), {
      body: h('div', { class: 'body' }, h('div', { class: 'guide' }, rows.map(([keys, text]) => [h('span', null, keys.map((k) => h('kbd', null, k))), h('span', null, text)]))),
    });
  }

  async function importCsv(file) {
    try {
      const { data, precision } = parseCsv(decodeText(await file.arrayBuffer()));
      const id = file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'CSV';
      state.drawings[state.symbol] = chart.drawings.serialize();
      feed.addStatic(id, data, { description: file.name, precision });
      state.symbol = id;
      chart.drawings.restore([]);
      await load();
      toast(t('Imported {name} ({n} rows)', { name: file.name, n: count.format(data.length) }));
    } catch (e) {
      toast(t('Could not import: {msg}', { msg: e.message }));
    }
  }

  function pickCsv() {
    const input = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv' });
    input.addEventListener('change', () => input.files[0] && importCsv(input.files[0]));
    input.click();
  }

  stage.addEventListener('dragover', (e) => {
    e.preventDefault();
    stage.classList.add('drop');
  });
  stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('drop');
    const file = e.dataTransfer.files[0];
    if (file) importCsv(file);
  });

  /* ───────────── Event wiring ───────────── */

  chart.on('tool', renderTools);
  chart.on('drawings', () => {
    renderTools();
    save();
  });
  chart.on('drawing:select', renderFloatbar);
  chart.on('trades', renderTools);
  chart.on('indicators', save);
  chart.on('indicator:settings', indicatorSettings);
  chart.on('frame', () => {
    const now = performance.now();
    if (now - lastStatus < 250) return;
    lastStatus = now;
    updateStatus();
    updateQuote();
  });

  renderTools();
  chart.drawings.restore(state.drawings[state.symbol] ?? []);
  load();

  return {
    chart,
    feed,
    state,
    root,
    setSymbol,
    setTimeframe,
    setType,
    setTheme,
    setLanguage,
    setLive,
    setSampleTrades,
    /** Apply changed attributes (options) without recreating the widget. */
    update(next) {
      if (next.symbol && next.symbol !== state.symbol) setSymbol(next.symbol);
      if (next.timeframe && next.timeframe !== state.tf) setTimeframe(next.timeframe);
      if (next.type && next.type !== chart.type) setType(next.type);
      if ((next.theme && next.theme !== state.theme) || (next.scheme && next.scheme !== state.scheme)) setTheme(next.theme ?? state.theme, next.scheme ?? state.scheme);
      if (next.lang && next.lang !== state.lang) setLanguage(next.lang);
      if (next.live !== undefined && flag(next.live) !== state.live) setLive(flag(next.live));
      if (next.sampleTrades !== undefined && flag(next.sampleTrades) !== state.sampleTrades) setSampleTrades(flag(next.sampleTrades));
    },
    /** Pause / resume auto-saving (so tests that scramble the chart do not overwrite saved settings). */
    pauseSaving(on = true) {
      savingPaused = on;
      if (on) clearTimeout(saveTimer);
    },
    destroy() {
      clearTimeout(saveTimer);
      unsubscribe?.();
      offLocale();
      ui.closeMenus();
      chart.destroy();
      mount.destroy();
    },
  };
}
