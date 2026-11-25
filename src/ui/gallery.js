/**
 * Widget gallery page. All four widgets run live; change their settings and copy the code to paste.
 * The page is ordinary HTML and the widgets are just <kiseki-…> tags
 * (exactly how they are used on a host page).
 */
import { addMessages, getLocale, t } from '../core/i18n.js';
import { applyThemeVars } from '../core/styles.js';
import { resolveTheme } from '../core/theme.js';
import { TIMEFRAMES } from '../data/timeframes.js';
import { RANGES, WIDGETS, getFeed, onLocaleChange, setWidgetLocale } from '../widgets/index.js';

addMessages('ja', {
  'Kiseki widgets': 'Kiseki ウィジェット',
  'Chart widgets you can drop into any web page': 'Web ページに置けるチャート部品',
  'Load one script, write a tag, and it works. Styles never mix with the host page, and the data source can be swapped. Change the settings below and the code to paste updates as you go.': 'スクリプトを 1 行読み込み、タグを書くだけで動きます。見た目は埋め込み先のページと混ざらず、データ供給元も差し替えられます。下で設定を変えると、貼り付け用のコードがその場で変わります。',
  'Open the full chart': 'チャート全体を開く',
  'Auto': '自動',
  'Ticker tape': 'ティッカーテープ',
  'A moving strip of prices and daily changes. Hover or press the button on the right to pause; click a symbol to switch the overview and chart below.': '現在値と前日比が横に流れる帯。マウスを載せるか右端のボタンで止まり、銘柄を押すと下の概要とチャートが切り替わります。',
  'Mini chart': 'ミニチャート',
  'A card with the price, the change over a period, and a small chart. Hover the chart to read past values; the bar underneath shows where the price sits between the period low and high.': '現在値・期間の変化・小さなチャートのカード。チャートに触れるとその時点の値が読め、下の帯で「期間の安値〜高値のどこにいるか」が分かります。',
  'Symbol overview': 'シンボル概要',
  'A chart with selectable periods plus the period high, low, spread and volume. Multiple symbols become tabs.': '期間を切り替えられるチャートと、期間の高値・安値・値幅・出来高。複数の銘柄はタブで切り替えます。',
  'Advanced chart': '高機能チャート',
  'The full chart with timeframes, chart types, indicators and drawing tools. Hide the parts you do not need to fit the space.': '時間足・チャート型・指標・描画ツールがそろった本体。隠す部分を選んで、置く場所に合わせられます。',
  'Symbol': '銘柄',
  'Symbols': '銘柄(複数可)',
  'Range': '表示期間',
  'Type': '種類',
  'Timeframe': '時間足',
  'Speed': '速さ',
  'Slower': 'ゆっくり',
  'Normal': 'ふつう',
  'Faster': 'はやい',
  'Motion': '動き',
  'Scrolling': '流れる',
  'Static (laid out in a row)': '流さない(横に並べる)',
  'Hidden parts': '隠す部分',
  'Header': '見出し',
  'Controls': '操作列',
  'Embed as a tag': 'タグで埋め込む',
  'Embed as an iframe': 'iframe で埋め込む',
  'Copy': 'コピー',
  'Copied': 'コピーしました',
  'How to embed': '埋め込み方',
  'Load embed.js once anywhere on the page (type="module").': 'ページのどこかで embed.js を 1 回読み込みます(type="module")。',
  'Write the tag where you want the widget. Size it with ordinary CSS width / height.': '出したい場所にタグを書きます。大きさは CSS の width / height でそのまま変えられます。',
  'Where scripts are not allowed, use the iframe code instead.': 'スクリプトを置けないページでは、iframe 用のコードを使います。',
  'The data shown here is synthetic. To use real data, call setFeed(yourFeed) before placing widgets (see the README).': '表示しているのは合成データです。実データを使うときは、ウィジェットを置く前に setFeed(自前の供給元) を呼びます(README 参照)。',
  'To react when a symbol is clicked, use the ticker tape\'s target attribute (a CSS selector) or listen for the kiseki:symbol event.': '銘柄を押したときの連動は、ティッカーテープの target 属性(CSS セレクタ)か、kiseki:symbol イベントで受け取れます。',
  'Drawing tools': '描画ツール',
});

const feed = getFeed();
const params = new URLSearchParams(location.search);
const base = new URL('.', location.href).href;
const symbols = feed.symbols.filter((s) => !s.static).map((s) => s.id);

// Follow the language chosen in the main chart (saved), if any.
let savedLang = null;
try {
  savedLang = JSON.parse(localStorage.getItem('kiseki:v2') ?? 'null')?.lang ?? null;
} catch {
  /* if it cannot be read, keep the page language */
}
const settings = { theme: params.get('theme') ?? 'auto', lang: setWidgetLocale(params.get('lang') ?? savedLang ?? getLocale()) };

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

/**
 * Each widget's blurb and its adjustable settings.
 * control: { attr, label, kind: 'select' | 'symbols' | 'parts', options }
 */
const SECTIONS = [
  {
    id: 'ticker-tape',
    title: 'Ticker tape',
    lead: 'A moving strip of prices and daily changes. Hover or press the button on the right to pause; click a symbol to switch the overview and chart below.',
    size: [null, 46],
    values: { symbols: symbols.join(','), speed: '40', mode: '', target: '.linked' },
    omit: ['target'],
    controls: [
      { attr: 'symbols', label: 'Symbols', kind: 'symbols' },
      { attr: 'speed', label: 'Speed', kind: 'select', options: [['20', 'Slower'], ['40', 'Normal'], ['90', 'Faster']] },
      { attr: 'mode', label: 'Motion', kind: 'select', options: [['', 'Scrolling'], ['static', 'Static (laid out in a row)']] },
    ],
  },
  {
    id: 'mini-chart',
    title: 'Mini chart',
    lead: 'A card with the price, the change over a period, and a small chart. Hover the chart to read past values; the bar underneath shows where the price sits between the period low and high.',
    size: [320, 212],
    values: { symbol: symbols[1] ?? symbols[0], range: '1M' },
    // The preview shows a few cards with different symbols (the code is for one).
    extra: symbols.filter((_, i) => i !== 1).slice(0, 3),
    controls: [
      { attr: 'symbol', label: 'Symbol', kind: 'select', options: symbols.map((s) => [s, s]) },
      { attr: 'range', label: 'Range', kind: 'select', options: RANGES.map((r) => [r.id, r.label]) },
    ],
  },
  {
    id: 'symbol-overview',
    title: 'Symbol overview',
    lead: 'A chart with selectable periods plus the period high, low, spread and volume. Multiple symbols become tabs.',
    size: [null, 440],
    linked: true,
    values: { symbols: symbols.slice(0, 3).join(','), range: '3M', type: 'area' },
    controls: [
      { attr: 'symbols', label: 'Symbols', kind: 'symbols' },
      { attr: 'range', label: 'Range', kind: 'select', options: RANGES.map((r) => [r.id, r.label]) },
      { attr: 'type', label: 'Type', kind: 'select', options: [['area', 'Area'], ['candlestick', 'Candlestick']] },
    ],
  },
  {
    id: 'advanced-chart',
    title: 'Advanced chart',
    lead: 'The full chart with timeframes, chart types, indicators and drawing tools. Hide the parts you do not need to fit the space.',
    size: [null, 560],
    linked: true,
    values: { symbol: symbols[0], timeframe: '1h', hide: 'brand' },
    controls: [
      { attr: 'symbol', label: 'Symbol', kind: 'select', options: symbols.map((s) => [s, s]) },
      { attr: 'timeframe', label: 'Timeframe', kind: 'select', options: TIMEFRAMES.map((tf) => [tf.id, tf.label]) },
      { attr: 'hide', label: 'Hidden parts', kind: 'parts', options: [['mast', 'Header'], ['strip', 'Controls'], ['dock', 'Drawing tools']], always: ['brand'] },
    ],
  },
];

const page = document.getElementById('page');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 1800);
}

/** Build the attribute list from the current settings (skipping empty values and preview-only ones). */
function attributes(section, forCode) {
  const out = [];
  for (const [name, value] of Object.entries(section.values)) {
    if (!value || (forCode && section.omit?.includes(name))) continue;
    out.push([name, value]);
  }
  if (settings.theme !== 'auto') out.push(['theme', settings.theme]);
  if (forCode) out.push(['lang', settings.lang]);
  return out;
}

function tagCode(section) {
  const widget = WIDGETS.find((w) => w.id === section.id);
  const attrs = attributes(section, true).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  const [w] = section.size;
  const style = w ? ` style="width:${w}px"` : '';
  return `<script type="module" src="${base}embed.js"></script>\n<${widget.tag}${attrs}${style}></${widget.tag}>`;
}

function frameCode(section) {
  const query = new URLSearchParams([['widget', section.id], ...attributes(section, true)]);
  const [w, hgt] = section.size;
  return `<iframe src="${base}embed.html?${query}" width="${w ?? '100%'}" height="${hgt}" style="border:0" loading="lazy" title="Kiseki ${section.id}"></iframe>`;
}

function render() {
  const theme = resolveTheme(settings.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme);
  applyThemeVars(document.documentElement, theme);
  document.documentElement.style.colorScheme = theme.name;
  document.documentElement.lang = settings.lang;
  document.title = t('Kiseki widgets');

  const seg = (label, options, current, onPick) =>
    h('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(([value, text]) => h('button', { 'aria-pressed': String(value === current), onclick: () => onPick(value) }, text)));

  page.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h('span', { class: 'name' }, 'Kiseki'),
      h('a', { href: './' }, t('Open the full chart')),
      h('span', { class: 'grow' }),
      seg(t('Theme'), [['auto', t('Auto')], ['light', t('Paper')], ['dark', t('Ink')]], settings.theme, (v) => ((settings.theme = v), render())),
      seg('言語 / Language', [['ja', '日本語'], ['en', 'English']], settings.lang, (v) => setWidgetLocale(v)),
    ),
    h('h1', null, t('Chart widgets you can drop into any web page')),
    h('p', { class: 'lead' }, t('Load one script, write a tag, and it works. Styles never mix with the host page, and the data source can be swapped. Change the settings below and the code to paste updates as you go.')),
    ...SECTIONS.map(renderSection),
    h(
      'div',
      { class: 'how' },
      h('h2', null, t('How to embed')),
      h(
        'ol',
        null,
        h('li', null, t('Load embed.js once anywhere on the page (type="module").')),
        h('li', null, t('Write the tag where you want the widget. Size it with ordinary CSS width / height.')),
        h('li', null, t('Where scripts are not allowed, use the iframe code instead.')),
      ),
      h('p', { class: 'note' }, t('To react when a symbol is clicked, use the ticker tape\'s target attribute (a CSS selector) or listen for the kiseki:symbol event.')),
      h('p', { class: 'note' }, t('The data shown here is synthetic. To use real data, call setFeed(yourFeed) before placing widgets (see the README).')),
    ),
  );
}

function renderSection(section) {
  const widget = WIDGETS.find((w) => w.id === section.id);
  const make = (overrides = {}) => {
    const el = document.createElement(widget.tag);
    if (section.linked) el.className = 'linked';
    for (const [name, value] of attributes(section, false)) el.setAttribute(name, overrides[name] ?? value);
    return el;
  };
  const main = make();
  const preview = h('div', { class: 'preview' + (section.extra ? ' cards' : '') }, main, (section.extra ?? []).map((symbol) => make({ symbol })));
  const tag = h('pre', { tabindex: '0' });
  const frame = h('pre', { tabindex: '0' });
  const refresh = () => {
    // Rewrite the preview's attributes (the widget recreates itself).
    const next = new Map(attributes(section, false));
    for (const name of widget.attributes) {
      if (next.has(name)) main.setAttribute(name, next.get(name));
      else if (name !== 'lang') main.removeAttribute(name);
    }
    tag.textContent = tagCode(section);
    frame.textContent = frameCode(section);
  };
  const copy = (pre) =>
    h('button', {
      class: 'copy',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(pre.textContent);
        } catch {
          // Where the clipboard is unavailable, select the text so it can be copied by hand.
          getSelection().selectAllChildren(pre);
        }
        toast(t('Copied'));
      },
    }, t('Copy'));

  const selects = new Map();
  // When a symbol is picked in the ticker tape, keep the linked previews' settings and code in sync.
  section.onLinked = (symbol) => {
    if (!section.linked) return;
    section.values.symbol = symbol;
    if (selects.has('symbol')) selects.get('symbol').value = symbol;
    refresh();
  };
  const controls = section.controls.map((c) => {
    if (c.kind === 'select') {
      const select = h('select', { onchange: () => ((section.values[c.attr] = select.value), refresh()) }, c.options.map(([value, label]) => h('option', { value, selected: section.values[c.attr] === value }, t(label))));
      selects.set(c.attr, select);
      return h('label', null, t(c.label), select);
    }
    // Multi-select controls (symbols, hidden parts).
    const options = c.kind === 'symbols' ? symbols.map((s) => [s, s]) : c.options;
    const chosen = new Set(String(section.values[c.attr] ?? '').split(',').filter(Boolean));
    const update = () => {
      const keep = options.map(([value]) => value).filter((value) => chosen.has(value));
      if (c.kind === 'symbols' && !keep.length) return; // at least one symbol
      section.values[c.attr] = [...(c.always ?? []), ...keep].join(',');
      refresh();
    };
    return h(
      'div',
      { class: 'row', role: 'group', 'aria-label': t(c.label) },
      t(c.label),
      h('div', { class: 'chips' }, options.map(([value, label]) => {
        const input = h('input', { type: 'checkbox', checked: chosen.has(value) });
        input.addEventListener('change', () => {
          if (input.checked) chosen.add(value);
          else if (c.kind === 'symbols' && chosen.size === 1) input.checked = true;
          else chosen.delete(value);
          update();
        });
        return h('label', { class: 'chip' }, input, h('span', null, t(label)));
      })),
    );
  });

  refresh();
  return h(
    'section',
    { id: section.id },
    h('h2', null, t(section.title)),
    h('p', null, t(section.lead)),
    preview,
    h(
      'div',
      { class: 'panel' },
      h('div', { class: 'ctl' }, controls),
      h('div', { class: 'code' }, h('div', { class: 'bar' }, h('strong', null, t('Embed as a tag')), h('span', { class: 'grow' }), copy(tag)), tag, h('div', { class: 'bar', style: 'margin-top:12px' }, h('strong', null, t('Embed as an iframe')), h('span', { class: 'grow' }), copy(frame)), frame),
    ),
  );
}

document.addEventListener('kiseki:symbol', (e) => {
  if (e.target.closest?.('#ticker-tape')) for (const section of SECTIONS) section.onLinked?.(e.detail.symbol);
});

onLocaleChange((lang) => {
  settings.lang = lang;
  render();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => settings.theme === 'auto' && render());
render();
