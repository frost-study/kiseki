import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../src/indicators/builtins.js';
import { computeHeatmap, computeVolumeProfile } from '../src/indicators/volume.js';
import { BarData } from '../src/core/BarData.js';
import { indicators } from '../src/core/Registry.js';
import { Indicator } from '../src/indicators/Indicator.js';
import { ema, sma, stdev, wma } from '../src/indicators/math.js';

const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const close = (a, b, eps = 1e-9) => (a !== a && b !== b) || Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

function randomBars(n, seed = 7) {
  const rand = rng(seed);
  const d = new BarData(8);
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = Math.max(1, p + (rand() - 0.5) * 4);
    const hi = Math.max(o, p) + rand() * 2;
    const lo = Math.min(o, p) - rand() * 2;
    d.push(i * 3_600_000, o, hi, lo, p, Math.round(rand() * 1000));
  }
  return d;
}

test('moving averages: known values', () => {
  const src = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const out = new Float64Array(10);
  sma(src, 3, out, 0, 10);
  assert.ok(Number.isNaN(out[1]));
  assert.deepEqual([...out.slice(2)], [2, 3, 4, 5, 6, 7, 8, 9]);
  ema(src, 3, out, 0, 10);
  assert.deepEqual([...out.slice(2, 5)], [2, 3, 4]); // an EMA of an arithmetic sequence also rises by 1 per step
  wma(src, 3, out, 0, 10);
  assert.ok(close(out[2], (1 * 1 + 2 * 2 + 3 * 3) / 6));
  stdev(Float64Array.from([2, 4, 4, 4, 5, 5, 7, 9]), 8, out, 0, 8);
  assert.ok(close(out[7], 2));
});

test('RSI: 100 when only rising, near 50 when oscillating', () => {
  const up = new BarData();
  for (let i = 0; i < 40; i++) up.push(i, i, i + 1, i, i + 1, 1);
  const rsi = new Indicator(indicators.get('rsi'));
  rsi.setData(up);
  assert.equal(rsi.out.value[39], 100);
  const zig = new BarData();
  for (let i = 0; i < 200; i++) zig.push(i, 10, 11, 10, i % 2 ? 11 : 10, 1);
  rsi.setData(zig);
  assert.ok(Math.abs(rsi.out.value[199] - 50) < 4);
});

test('all indicators: bar-by-bar incremental results equal a full recalculation', () => {
  const full = randomBars(600);
  for (const def of indicators.list()) {
    const batch = new Indicator(def);
    batch.setData(full);

    // feed the same data as "update the forming bar a few times → finalize → next bar"
    const live = new BarData(8);
    const inc = new Indicator(def);
    inc.setData(live);
    for (let i = 0; i < full.length; i++) {
      const b = full.bar(i);
      live.push(b.time, b.open, b.open, b.open, b.open, 0);
      inc.update(i);
      live.setLast(b.open, b.high, b.low, (b.open + b.close) / 2, b.volume / 2);
      inc.update(i);
      live.setLast(b.open, b.high, b.low, b.close, b.volume);
      inc.update(i);
    }
    for (const key of Object.keys(batch.out)) {
      for (let i = 0; i < full.length; i++) {
        assert.ok(close(batch.out[key][i], inc.out[key][i], 1e-7), `${def.id}.${key}[${i}]: ${batch.out[key][i]} vs ${inc.out[key][i]}`);
      }
    }
  }
});

test('indicator: range, legend and serialization', () => {
  const d = randomBars(300);
  const bb = new Indicator(indicators.get('bb'), { length: 10 });
  bb.setData(d);
  assert.equal(bb.title, 'BB 10 2');
  const r = bb.range(50, 150, 50, 150);
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 50; i <= 150; i++) {
    mn = Math.min(mn, bb.out.lower[i]);
    mx = Math.max(mx, bb.out.upper[i]);
  }
  assert.ok(close(r.min, mn) && close(r.max, mx));
  assert.equal(bb.legend(100, { palette: ['#000', '#111'] }).length, 3);
  assert.deepEqual(bb.serialize().inputs, { length: 10, mult: 2, source: 'close' });
  // leading spans are drawn shifted into the future, so the range can be queried with future indices
  const ichi = new Indicator(indicators.get('ichimoku'));
  ichi.setData(d);
  assert.ok(ichi.range(0, 299, 310, 320) !== null);
});

test('volume profile: distributed volume sums to the total; POC and value area are sane', () => {
  const d = randomBars(500, 11);
  const p = computeVolumeProfile(d, 100, 399, 24);
  let total = 0;
  for (let i = 100; i <= 399; i++) total += d.volume[i];
  let sum = 0;
  let best = 0;
  for (let k = 0; k < 24; k++) {
    sum += p.up[k] + p.down[k];
    if (p.up[k] + p.down[k] > p.up[best] + p.down[best]) best = k;
  }
  assert.ok(close(sum, total, 1e-9));
  assert.ok(close(p.total, total, 1e-9));
  assert.equal(p.poc, best);
  assert.deepEqual([p.lo, p.hi], [d.range(100, 399).min, d.range(100, 399).max]);
  // the value area contains the POC and covers at least 70% of the total
  assert.ok(p.vaLow <= p.poc && p.poc <= p.vaHigh);
  let va = 0;
  for (let k = p.vaLow; k <= p.vaHigh; k++) va += p.up[k] + p.down[k];
  assert.ok(va >= total * 0.7 - 1e-9);

  // a single bar is spread evenly over its high–low range
  const one = new BarData();
  one.push(0, 10, 20, 10, 20, 100);
  const q = computeVolumeProfile(one, 0, 0, 10);
  assert.deepEqual([...q.up].map((x) => Math.round(x)), Array(10).fill(10));
  assert.equal(q.down.reduce((s, x) => s + x, 0), 0);

  // a tick (shared OHLC) lands in exactly one row; below the previous trade counts as down, unchanged keeps the previous direction
  const t = BarData.ticks();
  for (const [i, price] of [100, 101, 100.5, 100.5, 104].entries()) t.push(i, price, price, price, price, 5);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => t.isUp(i)), [true, true, false, false, true]);
  const r = computeVolumeProfile(t, 0, 4, 4);
  assert.deepEqual([...r.up], [5, 5, 0, 5]);
  assert.deepEqual([...r.down], [10, 0, 0, 0]);
});

test('custom plots: do not affect the value range and can keep state', () => {
  const d = randomBars(200, 5);
  const vp = new Indicator(indicators.get('vprofile'));
  vp.setData(d);
  assert.equal(vp.range(0, 199, 0, 199), null);
  assert.equal(vp.title, 'Volume Profile 24');
  assert.deepEqual(vp.legend(0, {}), []); // nothing has been drawn yet, so there are no values
  const bubbles = new Indicator(indicators.get('bubbles'));
  bubbles.setData(d);
  assert.equal(bubbles.range(0, 199, 0, 199), null);
  assert.equal(bubbles.legend(10, { textMuted: '#888' })[0].v, String(d.volume[10]));
});

test('volume heatmap: cells sum to the total volume and cell edges are pinned', () => {
  const d = randomBars(400, 21);
  const hm = computeHeatmap(d, 37, 311, 5, 2);
  let total = 0;
  for (let i = 37; i <= 311; i++) total += d.volume[i];
  assert.ok(close(hm.total, total, 1e-5));
  assert.equal(hm.col0, 7); // bar 37 falls in the column for bars 35–39
  assert.equal(hm.cols, Math.floor(311 / 5) - 7 + 1);
  assert.equal(hm.row0, Math.floor(d.range(37, 311).min / 2));

  // a single bar is distributed over the rows it spans, in proportion to the price overlap
  const one = new BarData();
  one.push(0, 11, 14, 11, 14, 90);
  const q = computeHeatmap(one, 0, 0, 1, 2);
  assert.deepEqual([q.cols, q.rows, q.row0], [1, 3, 5]);
  assert.deepEqual([...q.cells.slice(0, 3)].map(Math.round), [30, 60, 0]); // 11〜12 / 12〜14 / 14〜16

  // shifting the visible range leaves the same value in the same cell (the pattern does not change while scrolling)
  const a = computeHeatmap(d, 100, 199, 10, 5);
  const b = computeHeatmap(d, 110, 199, 10, 5);
  for (let k = 0; k < a.rows; k++) {
    const row = a.row0 + k - b.row0;
    if (row < 0 || row >= b.rows) continue;
    assert.ok(close(a.cells[5 * a.rows + k], b.cells[4 * b.rows + row], 1e-5));
  }
});

test('indicator values match independent naive implementations', () => {
  const d = randomBars(400, 99);
  const n = d.length;
  const C = [...d.close.subarray(0, n)];
  const H = [...d.high.subarray(0, n)];
  const L = [...d.low.subarray(0, n)];
  const V = [...d.volume.subarray(0, n)];
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const smaRef = (src, len) => src.map((_, i) => (i < len - 1 || src.slice(i - len + 1, i + 1).some(Number.isNaN) ? NaN : mean(src.slice(i - len + 1, i + 1))));
  const emaRef = (src, len, alpha = 2 / (len + 1)) => {
    const out = [];
    let prev = NaN;
    src.forEach((x, i) => {
      if (Number.isNaN(prev)) {
        const w = src.slice(i - len + 1, i + 1);
        prev = i >= len - 1 && !w.some(Number.isNaN) ? mean(w) : NaN;
      } else prev += alpha * (x - prev);
      out.push(prev);
    });
    return out;
  };
  const same = (name, got, want, eps = 1e-8) => {
    for (let i = 0; i < n; i++) assert.ok(close(got[i], want[i], eps), `${name}[${i}]: ${got[i]} vs ${want[i]}`);
  };
  const run = (id, inputs) => {
    const ind = new Indicator(indicators.get(id), inputs);
    ind.setData(d);
    return ind.out;
  };

  // Bollinger Bands
  const bb = run('bb', { length: 20, mult: 2 });
  const basis = smaRef(C, 20);
  const dev = C.map((_, i) => (i < 19 ? NaN : Math.sqrt(mean(C.slice(i - 19, i + 1).map((x) => (x - basis[i]) ** 2)))));
  same('bb.basis', bb.basis, basis);
  same('bb.upper', bb.upper, basis.map((b, i) => b + 2 * dev[i]));
  same('bb.lower', bb.lower, basis.map((b, i) => b - 2 * dev[i]));

  // MACD
  const macd = run('macd', { fast: 12, slow: 26, signal: 9 });
  const line = emaRef(C, 12).map((f, i) => f - emaRef(C, 26)[i]);
  const signal = emaRef(line, 9);
  same('macd', macd.macd, line);
  same('macd.signal', macd.signal, signal);
  same('macd.hist', macd.hist, line.map((m, i) => m - signal[i]));

  // Stochastic
  const st = run('stoch', { k: 14, smooth: 3, d: 3 });
  const raw = C.map((c, i) => {
    if (i < 13) return NaN;
    const hh = Math.max(...H.slice(i - 13, i + 1));
    const ll = Math.min(...L.slice(i - 13, i + 1));
    return hh > ll ? (100 * (c - ll)) / (hh - ll) : 50;
  });
  same('stoch.k', st.k, smaRef(raw, 3));
  same('stoch.d', st.d, smaRef(smaRef(raw, 3), 3));

  // ATR (Wilder's smoothing)
  const tr = C.map((_, i) => (i === 0 ? H[0] - L[0] : Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1]))));
  same('atr', run('atr', { length: 14 }).value, emaRef(tr, 14, 1 / 14));

  // RSI (Wilder): the first value comes from the simple average of 14 bars of gains and losses
  const rsi = [];
  let g = 0;
  let l = 0;
  for (let i = 0; i < n; i++) {
    const ch = i ? C[i] - C[i - 1] : 0;
    if (i >= 1 && i <= 14) {
      g += Math.max(ch, 0) / 14;
      l += Math.max(-ch, 0) / 14;
    } else if (i > 14) {
      g = (g * 13 + Math.max(ch, 0)) / 14;
      l = (l * 13 + Math.max(-ch, 0)) / 14;
    }
    rsi.push(i < 14 ? NaN : l === 0 ? 100 : 100 - 100 / (1 + g / l));
  }
  same('rsi', run('rsi', { length: 14 }).value, rsi);

  // OBV
  let obv = 0;
  same('obv', run('obv').value, C.map((c, i) => (obv += i === 0 ? 0 : c > C[i - 1] ? V[i] : c < C[i - 1] ? -V[i] : 0)));

  // VWAP (resets every day; randomBars is hourly, so 24 bars make a day)
  let pv = 0;
  let vv = 0;
  same('vwap', run('vwap', { anchor: 'day' }).value, C.map((c, i) => {
    if (i % 24 === 0) pv = vv = 0;
    const tp = (H[i] + L[i] + c) / 3;
    pv += tp * V[i];
    vv += V[i];
    return vv > 0 ? pv / vv : tp;
  }));

  // Ichimoku
  const mid = (len) => C.map((_, i) => (i < len - 1 ? NaN : (Math.max(...H.slice(i - len + 1, i + 1)) + Math.min(...L.slice(i - len + 1, i + 1))) / 2));
  const ichi = run('ichimoku');
  same('tenkan', ichi.tenkan, mid(9));
  same('kijun', ichi.kijun, mid(26));
  same('spanA', ichi.spanA, mid(9).map((t, i) => (t + mid(26)[i]) / 2));
  same('spanB', ichi.spanB, mid(52));

  // Parabolic SAR: check the properties it must satisfy rather than exact values
  const sar = run('sar');
  for (let i = 1; i < n; i++) {
    const rising = sar.dir[i] > 0;
    assert.ok(rising ? sar.value[i] <= L[i] + 1e-9 || sar.dir[i - 1] < 0 : sar.value[i] >= H[i] - 1e-9 || sar.dir[i - 1] > 0, `sar[${i}] lies inside the bar`);
  }
});
