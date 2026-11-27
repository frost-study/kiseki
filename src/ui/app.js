/**
 * Entry point of the demo page: it just places the full chart widget full-screen.
 * The initial state can be set in the URL: ?symbol=FABLE&tf=tick&lang=en&ticks=3000000&trades=1
 */
import { DemoFeed } from '../data/feed.js';
import { createChartWidget, setFeed } from '../widgets/index.js';

const params = new URLSearchParams(location.search);
// For stress tests, ?ticks= raises the number of synthesized ticks.
if (params.get('ticks')) setFeed(new DemoFeed({ utcOffset: -new Date().getTimezoneOffset() * 60_000, ticks: Number(params.get('ticks')) || 1_200_000 }));

// Exposed for the console (window.kiseki.chart etc.).
window.kiseki = createChartWidget(document.getElementById('app'), {
  persist: 'kiseki:v2',
  symbol: params.get('symbol') ?? undefined,
  timeframe: params.get('tf') ?? undefined,
  lang: params.get('lang') ?? undefined,
  sampleTrades: params.get('trades') ?? undefined,
});
document.documentElement.lang = window.kiseki.state.lang;
