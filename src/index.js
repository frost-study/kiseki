/**
 * Kiseki Chart — a dependency-free charting engine.
 *
 * There are five registries for extension (the last two are for figures):
 *   seriesTypes.register(SeriesClass)   main series types
 *   indicators.register(def)            indicators
 *   drawingTools.register(def)          drawing tools
 *   figureTypes.register(FigureClass)   figures (charts that are not bar-indexed time series: sparkline, …)
 *   markTypes.register(def)             marks of the cartesian figure
 * Built-ins are registered through the same API (the imports below).
 *
 * Host data that is not a series goes through the chart itself: chart.trades (entries and exits at their
 * exact time and price) and chart.addPriceLine() (levels such as an average cost).
 */
import './series/builtins.js';
import './indicators/builtins.js';
import './indicators/volume.js';
import './drawings/tools.js';
import './figures/builtins.js';

export { Chart } from './core/Chart.js';
export { BarData } from './core/BarData.js';
export { MinMaxIndex } from './core/MinMaxIndex.js';
export { TimeScale } from './core/TimeScale.js';
export { PriceScale, linearTicks, niceStep } from './core/PriceScale.js';
export { seriesTypes, indicators, drawingTools, figureTypes, markTypes, Registry } from './core/Registry.js';
export { themes, candleSchemes, resolveTheme, resolveColor, withAlpha } from './core/theme.js';
export * as format from './core/format.js';
export { t, setLocale, getLocale, addMessages } from './core/i18n.js';
export * as plots from './core/plots.js';
export { Series } from './series/Series.js';
export { Indicator } from './indicators/Indicator.js';
export * as math from './indicators/math.js';
export { computeHeatmap, computeVolumeProfile } from './indicators/volume.js';
export { distToSegment } from './drawings/tools.js';
export { TradeMarkers, barIndexAt, groupFills, normalizeTrades, positionOf, tradeResult } from './trades/TradeMarkers.js';
export { Figure } from './figures/Figure.js';
export { CartesianFigure } from './figures/CartesianFigure.js';
export { SparklineFigure, sparklineMarks, directionOf } from './figures/sparkline.js';
export { createFigure } from './figures/create.js';
export { linearScale, timeScale, bandScale, makeScale, niceDomain, timeTicks } from './figures/scales.js';
export { spreadLabels, placeTickLabels, placeBoxes, stackValues } from './figures/layout.js';
export { hitTest, distanceTo } from './figures/hit.js';
export { sampleTrades } from './data/sample-trades.js';
export { TIMEFRAMES, timeframeById, bucketStart, resample, aggregateTicks, Aggregator } from './data/timeframes.js';
export { decodeText, parseCsv } from './data/csv.js';
export { DemoFeed, DEMO_SYMBOLS } from './data/feed.js';
