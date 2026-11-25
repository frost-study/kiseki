/**
 * Randomized stress test to run in the browser (for bug hunting).
 *
 * With the demo page open, call from the console:
 *   (await import('/tools/fuzz.browser.js')).run({ steps: 500, seed: 1 })
 * It hits the chart's public API in random order with extreme values, renders after every step, and checks that
 *   - no exception or promise rejection occurred
 *   - position, zoom and value ranges are finite and consistent
 *   - no NaN / undefined shows up in the legend or the axis labels
 *
 * Auto-saving is paused while it runs, so saved settings are left untouched.
 * The chart is left in a scrambled state; reload the page when done.
 */
import { BarData, TIMEFRAMES, drawingTools, indicators, seriesTypes } from '../src/index.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function run({ steps = 300, seed = 1, log = false } = {}) {
  const { chart, feed, state } = window.kiseki;
  // Pause auto-saving and never resume (the scrambled state must not be saved before a reload).
  window.kiseki.pauseSaving(true);
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (lo, hi) => lo + rand() * (hi - lo);
  const errors = [];
  const problems = [];
  const onError = (e) => errors.push(e.message ?? String(e.reason));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  const consoleError = console.error;
  console.error = (...args) => (errors.push(args.join(' ')), consoleError(...args));

  const symbols = feed.symbols.filter((s) => !s.static).map((s) => s.id);
  let symbol = state.symbol;
  const randomInputs = (def) => {
    const out = {};
    for (const [key, spec] of Object.entries(def.inputs ?? {})) {
      if (rand() < 0.5) continue;
      if (spec.type === 'int') out[key] = Math.round(between(spec.min ?? 1, Math.min(spec.max ?? 200, 300)));
      else if (spec.type === 'float') out[key] = +between(spec.min ?? 0.1, spec.max ?? 5).toFixed(3);
      else if (spec.type === 'source') out[key] = pick(['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4']);
      else if (spec.type === 'select') out[key] = pick(spec.options)[0];
    }
    return out;
  };

  const ops = {
    async timeframe() {
      const tf = pick(TIMEFRAMES);
      if (rand() < 0.3) symbol = pick(symbols);
      const data = await feed.history(symbol, tf.id);
      chart.setSymbol({ name: symbol, precision: feed.symbol(symbol).precision }, tf.label);
      chart.setData(data, { keepView: rand() < 0.5 });
      return `tf ${symbol} ${tf.id} n=${data.length}`;
    },
    tinyData() {
      // data with 0, 1 or just a few bars
      const n = pick([0, 1, 2, 3, 7]);
      const d = rand() < 0.5 ? new BarData() : BarData.ticks();
      let p = 100;
      for (let i = 0; i < n; i++) {
        const o = p;
        p = Math.max(0.5, p + between(-3, 3));
        d.push(1_700_000_000_000 + i * 60_000, o, Math.max(o, p) + rand(), Math.min(o, p) - rand(), p, Math.round(rand() * 100));
      }
      chart.setData(d);
      return `tiny n=${n}`;
    },
    flatData() {
      // no price movement, zero volume
      const d = new BarData();
      for (let i = 0; i < 50; i++) d.push(1_700_000_000_000 + i * 60_000, 42, 42, 42, 42, 0);
      chart.setData(d);
      return 'flat';
    },
    type() {
      const T = pick(seriesTypes.list());
      chart.setType(T.id);
      return `type ${T.id}`;
    },
    addIndicator() {
      if (chart.indicators.length >= 9) return ops.removeIndicator();
      const def = pick(indicators.list());
      chart.addIndicator(def.id, randomInputs(def));
      return `add ${def.id}`;
    },
    removeIndicator() {
      if (!chart.indicators.length) return 'remove (none)';
      const ind = pick(chart.indicators);
      chart.removeIndicator(ind);
      return `remove ${ind.def.id}`;
    },
    tweakIndicator() {
      if (!chart.indicators.length) return 'tweak (none)';
      const ind = pick(chart.indicators);
      if (rand() < 0.3) chart.setIndicatorVisible(ind, !ind.visible);
      else chart.updateIndicator(ind, randomInputs(ind.def), rand() < 0.3 ? { value: { color: '#336699' } } : null);
      return `tweak ${ind.def.id}`;
    },
    view() {
      const ts = chart.timeScale;
      const kind = Math.floor(rand() * 8);
      if (kind === 0) ts.zoomAt(between(0, chart.plotWidth), pick([0.001, 0.2, 0.7, 1.5, 6, 1000]));
      else if (kind === 1) ts.scrollPx(pick([-1e7, -500, -30, 30, 500, 1e7]));
      else if (kind === 2) chart.showLastBars(pick([1, 5, 80, 2000, 500000]), rand() < 0.5);
      else if (kind === 3) chart.fitContent();
      else if (kind === 4) chart.scrollToRealtime();
      else if (kind === 5) {
        const d = chart.data;
        if (d.length > 1) chart.setVisibleTimeRange(d.time[Math.floor(rand() * d.length)], d.time[Math.floor(rand() * d.length)], rand() < 0.5);
      } else if (kind === 6) ts.barSpacing = pick([1e-9, 0.01, 3, 500]);
      else ts.rightIndex = pick([-1e6, 0, chart.data.length / 2, chart.data.length + 1e6]);
      chart.invalidate();
      return `view ${kind}`;
    },
    scale() {
      const scale = pick(chart.panes).scale;
      const kind = Math.floor(rand() * 5);
      if (kind === 0) chart.setScaleMode(pick(['linear', 'log', 'percent']));
      else if (kind === 1) scale.zoom(pick([0.01, 0.5, 2, 50]));
      else if (kind === 2) scale.pan(pick([-5000, -40, 40, 5000]));
      else if (kind === 3) scale.auto = true;
      else chart.resizePanes(1 + Math.floor(rand() * Math.max(1, chart.panes.length - 1)), between(-400, 400));
      chart.invalidate();
      return `scale ${kind}`;
    },
    live() {
      const d = chart.data;
      const n = d.length;
      const lastT = n ? d.time[n - 1] : 1_700_000_000_000;
      const p = n ? d.close[n - 1] : 100;
      const count = pick([1, 1, 3, 40]);
      for (let k = 0; k < count; k++) {
        const price = Math.max(0.01, p * (1 + between(-0.01, 0.01)));
        const bar = { time: lastT + pick([-60_000, 0, 0, 1, 60_000]) * (k + 1 > 1 ? 1 : 1), open: p, high: Math.max(p, price), low: Math.min(p, price), close: price, volume: Math.round(rand() * 500) };
        if (rand() < 0.3) chart.append({ ...bar, time: Math.max(bar.time, lastT) });
        else chart.update(bar);
      }
      return `live x${count}`;
    },
    draw() {
      const dm = chart.drawings;
      const h = chart.panes[0].rect.h;
      const w = chart.plotWidth;
      const kind = Math.floor(rand() * 5);
      if (kind <= 1) {
        const def = pick(drawingTools.list());
        dm.setTool(def.id);
        for (let k = 0; k < def.points; k++) {
          const x = between(-50, w + 200);
          const y = between(-50, h + 50);
          dm.down(x, y);
          dm.move(x + 3, y + 3);
          dm.up(x, y);
        }
        return `draw ${def.id}`;
      }
      if (kind === 2 && dm.items.length) {
        const item = pick(dm.items);
        dm.select(item);
        const p = dm.toPx(item.points[0]);
        dm.down(p.x, p.y);
        dm.move(p.x + between(-300, 300), p.y + between(-300, 300));
        dm.up(p.x, p.y);
        return 'drag';
      }
      if (kind === 3 && dm.items.length) {
        dm.remove(pick(dm.items));
        return 'remove drawing';
      }
      if (kind === 4 && rand() < 0.3) dm.clear();
      dm.magnet = rand() < 0.5;
      return 'drawing misc';
    },
    crosshair() {
      if (rand() < 0.2) chart.clearCrosshair();
      else chart.setCrosshair(between(-20, chart.plotWidth + 20), between(0, chart.height), pick(chart.panes));
      return 'crosshair';
    },
    look() {
      const kind = Math.floor(rand() * 4);
      if (kind === 0) chart.setTheme(pick(['light', 'dark']), pick(['wa', 'intl', 'sumi']));
      else if (kind === 1) chart.root.parentElement.style.width = pick(['', '320px', '60px', '900px']);
      else if (kind === 2) chart.root.parentElement.style.height = pick(['', '90px', '300px']);
      else chart.toCanvas();
      return `look ${kind}`;
    },
    roundTrip() {
      const saved = JSON.parse(JSON.stringify(chart.serialize()));
      chart.restore(saved);
      const again = chart.serialize();
      if (JSON.stringify(again.indicators.map((i) => [i.id, i.inputs])) !== JSON.stringify(saved.indicators.map((i) => [i.id, i.inputs]))) {
        problems.push('indicators changed across serialize → restore');
      }
      return 'round trip';
    },
  };
  const names = Object.keys(ops);
  const weights = { timeframe: 2, view: 6, scale: 3, live: 4, draw: 3, crosshair: 2, addIndicator: 3, removeIndicator: 1, tweakIndicator: 3, type: 2, tinyData: 1, flatData: 0.5, look: 1.5, roundTrip: 0.5 };
  const total = names.reduce((s, n) => s + (weights[n] ?? 1), 0);
  const choose = () => {
    let r = rand() * total;
    for (const n of names) if ((r -= weights[n] ?? 1) <= 0) return n;
    return names[0];
  };

  const check = (what) => {
    const ts = chart.timeScale;
    const bad = (msg) => problems.push(`${what}: ${msg}`);
    if (!(ts.barSpacing > 0) || !Number.isFinite(ts.barSpacing)) bad(`barSpacing=${ts.barSpacing}`);
    if (!Number.isFinite(ts.rightIndex)) bad(`rightIndex=${ts.rightIndex}`);
    const n = chart.data.length;
    if (n > 0) {
      const [a, b] = chart.visibleBars();
      if (b < a) bad(`no bars in the visible range a=${a} b=${b} n=${n}`);
    }
    for (const pane of chart.panes) {
      for (const [id, s] of pane.scales) {
        if (!Number.isFinite(s.lo) || !Number.isFinite(s.hi) || !(s.hi > s.lo)) bad(`pane ${pane.id}/${id} value range lo=${s.lo} hi=${s.hi}`);
      }
      if (!(pane.rect.h > 0)) bad(`pane ${pane.id} height ${pane.rect.h}`);
      for (const t of pane.ticks) if (/NaN|undefined|Infinity/.test(t.label)) bad(`tick label "${t.label}"`);
    }
    const legend = chart.layer.textContent;
    if (/NaN|undefined|Infinity|\[object/.test(legend)) bad(`bad text in the legend: ${legend.match(/.{0,20}(NaN|undefined|Infinity|\[object).{0,20}/)[0]}`);
  };

  const history = [];
  for (let step = 0; step < steps; step++) {
    const name = choose();
    let what = name;
    const before = errors.length + problems.length;
    try {
      what = (await ops[name]()) ?? name;
      // Render synchronously instead of waiting for a frame (same result even when the tab is in the background).
      chart.renderNow();
      check(what);
      if (step % 25 === 0) await new Promise((r) => setTimeout(r, 0)); // yield to the browser now and then
    } catch (e) {
      errors.push(`${what}: ${e.stack ?? e}`);
    }
    history.push(what);
    if (log) console.log(step, what);
    if (errors.length + problems.length > before) {
      // keep the last few steps (a hint for reproducing)
      problems.push(`  ↑ step ${step}, preceding: ${history.slice(-6).join(' → ')}`);
    }
    if (errors.length + problems.length > 40) break;
  }

  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onError);
  console.error = consoleError;
  chart.root.parentElement.style.width = '';
  chart.root.parentElement.style.height = '';
  return { steps: history.length, errors: [...new Set(errors)].slice(0, 20), problems: problems.slice(0, 40) };
}
