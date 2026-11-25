/**
 * Kiseki widgets: four components that can be embedded in a web page.
 *
 * Loading this file registers the custom elements, so writing a tag in HTML is all it takes:
 *
 *   <script type="module" src="…/embed.js"></script>
 *   <kiseki-ticker-tape symbols="MYTH/USD,FABLE"></kiseki-ticker-tape>
 *   <kiseki-mini-chart symbol="FABLE" range="1M"></kiseki-mini-chart>
 *   <kiseki-symbol-overview symbols="MYTH/USD,FABLE"></kiseki-symbol-overview>
 *   <kiseki-advanced-chart symbol="FABLE" timeframe="1h"></kiseki-advanced-chart>
 *
 * From JavaScript, call createXxx(element, options). Either way, destroy() cleans up.
 * For real data, call setFeed(yourFeed) before placing widgets.
 */
import '../series/builtins.js';
import '../indicators/builtins.js';
import '../indicators/volume.js';
import '../drawings/tools.js';
import { createAdvancedChart } from './advanced-chart.js';
import { createMiniChart } from './mini-chart.js';
import { defineElement } from './shared.js';
import { createSymbolOverview } from './symbol-overview.js';
import { createTickerTape } from './ticker-tape.js';

const COMMON = ['theme', 'scheme', 'lang'];

/** List of widgets (used e.g. by the page that generates embed code). */
export const WIDGETS = [
  { id: 'advanced-chart', tag: 'kiseki-advanced-chart', create: createAdvancedChart, attributes: ['symbol', 'timeframe', 'type', 'indicators', 'live', 'speed', 'hide', 'symbol-change', 'persist', ...COMMON] },
  { id: 'symbol-overview', tag: 'kiseki-symbol-overview', create: createSymbolOverview, attributes: ['symbols', 'symbol', 'range', 'type', 'live', ...COMMON] },
  { id: 'mini-chart', tag: 'kiseki-mini-chart', create: createMiniChart, attributes: ['symbol', 'range', 'live', ...COMMON] },
  { id: 'ticker-tape', tag: 'kiseki-ticker-tape', create: createTickerTape, attributes: ['symbols', 'speed', 'mode', 'target', ...COMMON] },
];

for (const w of WIDGETS) defineElement(w.tag, w.attributes, w.create);

export { createAdvancedChart, createMiniChart, createSymbolOverview, createTickerTape };
export { getFeed, setFeed, setWidgetLocale, onLocaleChange } from './shared.js';
export { RANGES } from './ranges.js';
export { quotesFor } from './quotes.js';
