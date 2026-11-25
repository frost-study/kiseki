/**
 * Kiseki Chart — a dependency-free charting engine.
 *
 * There are three registries for extension:
 *   seriesTypes.register(SeriesClass)   main series types
 *   indicators.register(def)            indicators
 *   drawingTools.register(def)          drawing tools
 * Built-ins are registered through the same API (the imports below).
 */
import './series/builtins.js';
import './indicators/builtins.js';
import './indicators/volume.js';
import './drawings/tools.js';

export { Chart } from './core/Chart.js';
export { BarData } from './core/BarData.js';
export { MinMaxIndex } from './core/MinMaxIndex.js';
export { TimeScale } from './core/TimeScale.js';
export { PriceScale, linearTicks, niceStep } from './core/PriceScale.js';
export { seriesTypes, indicators, drawingTools, Registry } from './core/Registry.js';
export { themes, candleSchemes, resolveTheme, resolveColor, withAlpha } from './core/theme.js';
export * as format from './core/format.js';
export { t, setLocale, getLocale, addMessages } from './core/i18n.js';
export * as plots from './core/plots.js';
export { Series } from './series/Series.js';
export { Indicator } from './indicators/Indicator.js';
export * as math from './indicators/math.js';
export { computeHeatmap, computeVolumeProfile } from './indicators/volume.js';
export { distToSegment } from './drawings/tools.js';
export { TIMEFRAMES, timeframeById, bucketStart, resample, aggregateTicks, Aggregator } from './data/timeframes.js';
export { decodeText, parseCsv } from './data/csv.js';
export { DemoFeed, DEMO_SYMBOLS } from './data/feed.js';
