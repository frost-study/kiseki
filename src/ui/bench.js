/**
 * Benchmark page (bench.html). Times the chart on synthetic data of growing size.
 *
 * Every dataset gets a fresh chart in the #stage box, and four things are measured:
 *   load        setData plus the first frame (series, index and indicators are built here)
 *   zoomed out  every point on screen at once
 *   panning     150 bars on screen, moved a little every frame
 *   live tick   the last bar changes, then one frame (indicators update incrementally)
 * A frame's figure is chart.stats.drawMs (what the demo's status bar shows): the main-thread time from the start of the
 * chart's frame to the end of drawing the series layer, including any data and indicator updates. Frames are real
 * animation frames, one per display refresh, because back-to-back synchronous redraws come out several times cheaper
 * than what a user actually gets. Browsers round the clock to about 0.1 ms, which is the resolution of the results.
 *
 * tools/bench.mjs drives this page in headless Chrome: it calls window.runBench() and reads the result.
 */
import { BarData } from '../core/BarData.js';
import { Chart } from '../core/Chart.js';
import { applyThemeVars } from '../core/styles.js';
import { resolveTheme } from '../core/theme.js';
import '../series/builtins.js';
import '../indicators/builtins.js';
import '../indicators/volume.js';

const WARMUP = 10;
const FRAMES = 90;

export const PRESETS = {
  quick: [
    { kind: 'bars', n: 10_000 },
    { kind: 'bars', n: 100_000 },
    { kind: 'bars', n: 1_000_000 },
    { kind: 'ticks', n: 1_000_000 },
  ],
  full: [
    { kind: 'bars', n: 10_000 },
    { kind: 'bars', n: 100_000 },
    { kind: 'bars', n: 1_000_000 },
    { kind: 'bars', n: 3_000_000 },
    { kind: 'ticks', n: 1_000_000 },
    { kind: 'ticks', n: 3_000_000 },
    { kind: 'ticks', n: 10_000_000 },
  ],
};

/** Small deterministic generator (xorshift32), so every run sees the same data. */
function random(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** One-minute OHLCV bars following a random walk. */
export function makeBars(n, seed = 7) {
  const rnd = random(seed);
  const d = new BarData(n);
  let t = Date.UTC(2020, 0, 1);
  let price = 100;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = Math.max(1, open * (1 + (rnd() - 0.5) * 0.004));
    const high = Math.max(open, close) * (1 + rnd() * 0.0015);
    const low = Math.min(open, close) * (1 - rnd() * 0.0015);
    d.push(t, open, high, low, close, 100 + Math.floor(rnd() * 900));
    price = close;
    t += 60_000;
  }
  return d;
}

/** Ticks a quarter of a second apart (open = high = low = close, one shared price column). */
export function makeTicks(n, seed = 11) {
  const rnd = random(seed);
  const d = BarData.ticks(n);
  let t = Date.UTC(2020, 0, 1);
  let price = 100;
  for (let i = 0; i < n; i++) {
    price = Math.max(1, price * (1 + (rnd() - 0.5) * 0.0004));
    d.push(t, price, price, price, price, 1 + Math.floor(rnd() * 10));
    t += 250;
  }
  return d;
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function summarize(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return { median: percentile(s, 0.5), p95: percentile(s, 0.95) };
}

/** Let the browser breathe between steps (paint the status, collect garbage). */
const pause = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

/** Let the chart draw in its own animation frames, calling `step(i)` before each, and summarize drawMs after a warm-up. */
async function frames(chart, step) {
  const out = [];
  for (let i = 0; i < WARMUP + FRAMES; i++) {
    step(i);
    chart.invalidate();
    // the chart's own frame callback was queued by invalidate(), so it runs before this one in the same frame
    await nextFrame();
    if (i >= WARMUP) out.push(chart.stats.drawMs);
  }
  return summarize(out);
}

async function measure(stage, { kind, n }) {
  const data = kind === 'ticks' ? makeTicks(n) : makeBars(n);
  stage.replaceChildren();
  const chart = new Chart(stage, { type: kind === 'ticks' ? 'line' : 'candlestick', theme: document.documentElement.dataset.theme, interactive: false });
  chart.setSymbol({ name: kind === 'ticks' ? 'TICKS' : 'BARS', precision: 2 }, kind === 'ticks' ? 'ticks' : '1 minute');
  if (kind === 'bars') {
    chart.addIndicator('volume');
    chart.addIndicator('ema', { length: 50 });
  }
  await pause(); // the chart learns its size from the first layout
  if (!chart.width) throw new Error('the chart has no size');

  const t0 = performance.now();
  chart.setData(data);
  chart.renderNow();
  const load = performance.now() - t0;

  const ts = chart.timeScale;
  Object.assign(ts, ts.fitTarget());
  const zoomedOut = await frames(chart, () => {});

  chart.showLastBars(150, false);
  const right = ts.rightIndex;
  const panning = await frames(chart, (i) => (ts.rightIndex = right - (i % 50) * 3));

  ts.rightIndex = right;
  const last = data.length - 1;
  const base = data.close[last];
  const live = await frames(chart, (i) => {
    const p = base * (1 + Math.sin(i) * 0.001);
    const open = data.open[last];
    chart.update({ time: data.time[last], open, high: Math.max(open, p, data.high[last]), low: Math.min(open, p, data.low[last]), close: p, volume: data.volume[last] + 1 });
  });

  chart.destroy();
  return { kind, n, load, zoomedOut, panning, live };
}

const ms = (v) => (v < 100 ? v.toFixed(1) : v.toFixed(0));
const cell = (r) => `${ms(r.median)} / ${ms(r.p95)}`;
const count = new Intl.NumberFormat('en-US');

/** Run a preset (or a list of { kind, n }) and return the results. `onResult` is called as each dataset finishes. */
export async function runBench(preset = 'full', onResult = () => {}, onStatus = () => {}) {
  const stage = document.getElementById('stage');
  const list = Array.isArray(preset) ? preset : PRESETS[preset];
  const results = [];
  for (const item of list) {
    onStatus(`${item.kind} × ${count.format(item.n)}…`);
    await pause();
    const r = await measure(stage, item);
    results.push(r);
    onResult(r);
    await pause();
  }
  stage.replaceChildren();
  onStatus('');
  return results;
}

export function environment() {
  return { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, cores: navigator.hardwareConcurrency ?? null, stage: [document.getElementById('stage').clientWidth, document.getElementById('stage').clientHeight] };
}

/* ───── The page ───── */

const dark = matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
applyThemeVars(document.documentElement, resolveTheme(dark ? 'dark' : 'light'));

const runButton = document.getElementById('run');
const presetSelect = document.getElementById('preset');
const status = document.getElementById('status');
const body = document.querySelector('#results tbody');
const env = document.getElementById('env');

function row(r) {
  const tr = document.createElement('tr');
  for (const text of [r.kind === 'ticks' ? 'Ticks (line)' : 'Bars + volume + EMA', count.format(r.n), `${ms(r.load)} ms`, cell(r.zoomedOut), cell(r.panning), cell(r.live)]) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.append(td);
  }
  body.append(tr);
}

async function start(preset) {
  runButton.disabled = true;
  body.replaceChildren();
  const e = environment();
  env.textContent = `${e.userAgent} · devicePixelRatio ${e.devicePixelRatio} · chart ${e.stage[0]}×${e.stage[1]} CSS px · frame times in ms, median / 95th percentile`;
  try {
    // Browsers stop animation frames in a hidden tab, so the run waits until the tab is visible again.
    let current = '';
    const show = () => (status.textContent = current && document.hidden ? `${current} (paused while this tab is hidden)` : current);
    document.addEventListener('visibilitychange', show);
    try {
      return await runBench(preset, row, (s) => ((current = s), show()));
    } finally {
      document.removeEventListener('visibilitychange', show);
    }
  } catch (err) {
    status.textContent = `Stopped: ${err.message}`;
    throw err;
  } finally {
    runButton.disabled = false;
  }
}

runButton.addEventListener('click', () => start(presetSelect.value));
const params = new URLSearchParams(location.search);
if (params.has('preset') && PRESETS[params.get('preset')]) presetSelect.value = params.get('preset');
if (params.has('autorun')) start(presetSelect.value);

// For tools/bench.mjs
window.runBench = start;
window.benchEnvironment = environment;
