/**
 * Kiseki widgets: four components that can be embedded in a web page.
 *
 * Loading this file registers the custom elements, so writing a tag in HTML is all it takes:
 *
 *   <script type="module" src="…/embed.js"></script>
 *   <kiseki-ribbon symbols="MYTH/USD,FABLE"></kiseki-ribbon>
 *   <kiseki-price-card symbol="FABLE" range="1M"></kiseki-price-card>
 *   <kiseki-summary symbols="MYTH/USD,FABLE"></kiseki-summary>
 *   <kiseki-chart symbol="FABLE" timeframe="1h"></kiseki-chart>
 *
 * From JavaScript, call createXxx(element, options). Either way, destroy() cleans up.
 * For real data, call setFeed(yourFeed) before placing widgets.
 */
import '../series/builtins.js';
import '../indicators/builtins.js';
import '../indicators/volume.js';
import '../drawings/tools.js';
import { createChartWidget } from './chart.js';
import { createPriceCardWidget } from './price-card.js';
import { defineElement } from './shared.js';
import { createSummaryWidget } from './summary.js';
import { createRibbonWidget } from './ribbon.js';

const COMMON = ['theme', 'scheme', 'lang'];

/** List of widgets (used e.g. by the page that generates embed code). */
export const WIDGETS = [
  { id: 'chart', tag: 'kiseki-chart', create: createChartWidget, attributes: ['symbol', 'timeframe', 'type', 'indicators', 'live', 'speed', 'hide', 'symbol-change', 'persist', 'sample-trades', ...COMMON] },
  { id: 'summary', tag: 'kiseki-summary', create: createSummaryWidget, attributes: ['symbols', 'symbol', 'range', 'type', 'live', ...COMMON] },
  { id: 'price-card', tag: 'kiseki-price-card', create: createPriceCardWidget, attributes: ['symbol', 'range', 'live', ...COMMON] },
  { id: 'ribbon', tag: 'kiseki-ribbon', create: createRibbonWidget, attributes: ['symbols', 'speed', 'mode', 'target', ...COMMON] },
];

for (const w of WIDGETS) defineElement(w.tag, w.attributes, w.create);

export { createChartWidget, createPriceCardWidget, createSummaryWidget, createRibbonWidget };
export { getFeed, setFeed, setWidgetLocale, onLocaleChange } from './shared.js';
export { RANGES } from './ranges.js';
export { quotesFor } from './quotes.js';
