// Runs bench.html in headless Chrome and prints the results as a Markdown table (the one in the README).
//
//   node tools/bench.mjs           # the full set, up to 10 million ticks
//   node tools/bench.mjs quick     # up to 1 million
//
// Needs a local Chrome or Chromium (set CHROME if it is elsewhere). The chart is about 1090 × 420 CSS px at a device pixel ratio
// of 2, like a laptop screen. Headless Chrome may rasterize differently from a visible window, so treat the numbers as
// relative: how the cost grows with the data, not what a particular screen will show.
import { openPage, withChrome } from './chrome.mjs';

const PORT = 5198;
const preset = process.argv[2] ?? 'full';

const ms = (v) => (v < 100 ? v.toFixed(1) : v.toFixed(0));
const pair = (r) => `${ms(r.median)} / ${ms(r.p95)}`;
const count = new Intl.NumberFormat('en-US');

await withChrome(PORT, async (cdp, base) => {
  const page = await openPage(cdp, base, { width: 1132, height: 1200, scale: 2, userAgent: 'kiseki-bench' });
  await page.goto(`/bench.html?preset=${encodeURIComponent(preset)}`);
  await page.until('typeof window.runBench === "function"');
  // Runtime.evaluate has no timeout of its own; ten million ticks take a while to synthesize
  const results = await page.eval(`window.runBench(${JSON.stringify(preset)})`);
  const env = await page.eval('window.benchEnvironment()');
  const version = (await cdp.send('Browser.getVersion')).product;

  const lines = [
    '| Data | Points | Load (ms) | Zoomed out | Panning | Live tick |',
    '|---|--:|--:|--:|--:|--:|',
    ...results.map((r) => `| ${r.kind === 'ticks' ? 'Ticks (line)' : 'Bars + volume + EMA'} | ${count.format(r.n)} | ${ms(r.load)} | ${pair(r.zoomedOut)} | ${pair(r.panning)} | ${pair(r.live)} |`),
  ];
  console.log(lines.join('\n'));
  console.log(`\nFrame times in ms, median / 95th percentile. ${version}, headless, chart ${env.stage[0]}×${env.stage[1]} CSS px at devicePixelRatio ${env.devicePixelRatio}, ${env.cores ?? '?'} logical cores.`);
  await page.close();
});
