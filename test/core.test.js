import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BarData } from '../src/core/BarData.js';
import { formatCompact, formatDuration } from '../src/core/format.js';
import { setLocale } from '../src/core/i18n.js';
import { MinMaxIndex } from '../src/core/MinMaxIndex.js';
import { PriceScale, linearTicks, niceStep } from '../src/core/PriceScale.js';
import { TimeMarks, markWeight } from '../src/core/TimeMarks.js';
import { TimeScale } from '../src/core/TimeScale.js';

const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

test('MinMaxIndex: any range matches brute force', () => {
  const rand = rng(1);
  const n = 70_000;
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lo[i] = rand() * 100;
    hi[i] = lo[i] + rand() * 5;
    if (i % 97 === 0) lo[i] = hi[i] = NaN;
  }
  const idx = new MinMaxIndex();
  idx.update(lo, hi, 0, n);
  for (let k = 0; k < 400; k++) {
    const a = Math.floor(rand() * n);
    const b = Math.min(n - 1, a + Math.floor(rand() * rand() * n));
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = a; i <= b; i++) {
      if (lo[i] < mn) mn = lo[i];
      if (hi[i] > mx) mx = hi[i];
    }
    const r = idx.query(lo, hi, a, b);
    if (mn > mx) assert.equal(r, null);
    else assert.deepEqual(r, { min: mn, max: mx });
  }
});

test('MinMaxIndex: appends and tail updates are applied incrementally', () => {
  const rand = rng(2);
  const cap = 5000;
  const v = new Float64Array(cap);
  const idx = new MinMaxIndex();
  let n = 0;
  for (let step = 0; step < 300; step++) {
    const from = Math.max(0, n - 1);
    if (n) v[n - 1] = rand() * 10; // update of the forming bar
    const add = Math.floor(rand() * 30);
    for (let k = 0; k < add && n < cap; k++) v[n++] = rand() * 10;
    idx.update(v, v, from, n);
  }
  const full = new MinMaxIndex();
  full.update(v, v, 0, n);
  for (let k = 0; k < 200; k++) {
    const a = Math.floor(rand() * n);
    const b = Math.min(n - 1, a + Math.floor(rand() * 800));
    assert.deepEqual(idx.query(v, v, a, b), full.query(v, v, a, b));
  }
});

test('MinMaxIndex.forEachAbove: finds every element at or above the threshold, in order', () => {
  const rand = rng(9);
  for (const n of [5, 300, 70_000]) {
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = rand() ** 6 * 1000;
    const idx = new MinMaxIndex();
    idx.update(v, v, 0, n);
    for (let k = 0; k < 40; k++) {
      const a = Math.floor(rand() * n);
      const b = Math.min(n - 1, a + Math.floor(rand() * n));
      const threshold = rand() * 900;
      const expected = [];
      for (let i = a; i <= b; i++) if (v[i] >= threshold) expected.push(i);
      const got = [];
      idx.forEachAbove(v, a, b, threshold, (i) => void got.push(i));
      assert.deepEqual(got, expected);
    }
    // stops when cb returns false
    const few = [];
    idx.forEachAbove(v, 0, n - 1, 0, (i) => few.push(i) < 3);
    assert.equal(few.length, Math.min(3, n));
  }
});

test('BarData: keeps contents when growing and answers range queries', () => {
  const d = new BarData(16);
  for (let i = 0; i < 1000; i++) d.push(i * 60_000, i, i + 2, i - 1, i + 1, 10);
  assert.equal(d.length, 1000);
  assert.deepEqual(d.bar(999), { time: 999 * 60_000, open: 999, high: 1001, low: 998, close: 1000, volume: 10 });
  assert.deepEqual(d.range(100, 200), { min: 99, max: 202 });
  d.setLast(999, 5000, -5, 1000, 11);
  assert.deepEqual(d.range(0, 999), { min: -5, max: 5000 });
  assert.equal(d.lowerBound(500 * 60_000), 500);
  assert.equal(d.lowerBound(500 * 60_000 + 1), 501);
  assert.equal(d.interval, 60_000);
});

test('BarData.ticks: O/H/L/C share one array', () => {
  const t = BarData.ticks(4);
  for (let i = 0; i < 100; i++) t.push(i, 5, 5, 5, 100 + i, 1);
  assert.equal(t.open, t.close);
  assert.equal(t.high[42], 142);
  assert.deepEqual(t.range(10, 20), { min: 110, max: 120 });
  const c = t.clone();
  assert.equal(c.low, c.close);
  assert.equal(c.close[99], 199);
});

test('TimeScale: coordinates, indices and times round-trip', () => {
  const d = new BarData();
  for (let i = 0; i < 500; i++) d.push(1_700_000_000_000 + i * 60_000, 1, 1, 1, 1);
  const ts = new TimeScale();
  ts.setData(d, 0);
  ts.setWidth(800);
  ts.rightIndex = ts.realtimeIndex;
  for (const i of [0, 123, 499, 510]) assert.ok(Math.abs(ts.indexAt(ts.x(i)) - i) < 1e-9);
  assert.equal(ts.x(ts.rightIndex), 800 - ts.barSpacing / 2);
  // zooming keeps the bar under the cursor in place
  const anchor = ts.indexAt(300);
  ts.zoomAt(300, 1.7);
  assert.ok(Math.abs(ts.indexAt(300) - anchor) < 1e-9);
  // mapping to time (extrapolated outside the data)
  assert.equal(ts.timeToIndex(d.time[77]), 77);
  assert.equal(ts.timeToIndex(d.time[77] + 30_000), 77.5);
  assert.equal(ts.indexToTime(505), d.time[499] + 6 * 60_000);
  assert.equal(ts.timeToIndex(ts.indexToTime(-12)), -12);
});

test('TimeScale: follows new bars while the latest bar is in view', () => {
  const d = new BarData();
  for (let i = 0; i < 100; i++) d.push(i * 1000, 1, 1, 1, 1);
  const ts = new TimeScale();
  ts.setData(d, 0);
  ts.setWidth(400);
  ts.rightIndex = ts.realtimeIndex;
  d.push(100_000, 1, 1, 1, 1);
  ts.sync();
  assert.equal(ts.rightIndex, 100 + ts.rightOffset);
  ts.rightIndex = 50; // not moved while looking at the past
  d.push(101_000, 1, 1, 1, 1);
  ts.sync();
  assert.equal(ts.rightIndex, 50);
});

test('TimeMarks: boundary weights and non-overlapping tick selection', () => {
  const t = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(markWeight(t, t - 60_000, 0), 70); // the year changes
  assert.equal(markWeight(Date.UTC(2026, 1, 1), Date.UTC(2026, 0, 31, 23), 0), 60);
  assert.equal(markWeight(Date.UTC(2026, 1, 2), Date.UTC(2026, 1, 1, 23), 0), 50);
  assert.equal(markWeight(t + 12 * 3_600_000, t + 11 * 3_600_000, 0), 44);
  assert.equal(markWeight(t + 30 * 60_000, t + 29 * 60_000, 0), 34);
  assert.equal(markWeight(t + 5000, t + 4000, 0), 22);
  assert.equal(markWeight(t + 5200, t + 5100, 0), 10);
  // in Japan, 15:00 UTC is where the date changes
  assert.equal(markWeight(Date.UTC(2026, 5, 10, 15), Date.UTC(2026, 5, 10, 14), 9 * 3_600_000), 50);

  const d = new BarData();
  for (let i = 0; i < 20_000; i++) d.push(t + i * 60_000, 1, 1, 1, 1);
  const marks = new TimeMarks();
  marks.rebuild(d, 0);
  const picked = marks.select(d, 0, 19_999, 0, 0.05, 1000, 80).sort((a, b) => a.x - b.x);
  assert.ok(picked.length >= 5);
  for (let i = 1; i < picked.length; i++) assert.ok(picked[i].x - picked[i - 1].x >= 80);
  assert.ok(picked.every((m) => m.level >= 41), 'over a wide range only day and hour boundaries are chosen');
});

test('PriceScale: values and coordinates round-trip in every mode', () => {
  for (const mode of ['linear', 'log', 'percent']) {
    const s = new PriceScale();
    s.setMode(mode);
    s.base = 120;
    s.setHeight(500);
    s.fit(80, 200);
    for (const v of [80, 100, 137.5, 200]) assert.ok(Math.abs(s.value(s.y(v)) - v) < 1e-9, mode);
    assert.ok(Math.abs(s.y(200) - 50) < 1e-9, 'the maximum sits at the top margin');
    assert.ok(Math.abs(s.y(80) - 450) < 1e-9);
    const ticks = s.ticks();
    assert.ok(ticks.length >= 3 && ticks.length <= 14, `${mode}: ${ticks.length}`);
    for (const t of ticks) assert.ok(Math.abs(s.y(t.value) - t.y) < 1e-6);
  }
});

test('ticks: nice steps and the minimum step', () => {
  assert.equal(niceStep(100, 10), 10);
  assert.equal(niceStep(87, 10), 10);
  assert.equal(niceStep(0.9, 5), 0.2);
  assert.deepEqual(linearTicks(0.03, 0.31, 6), [0.05, 0.1, 0.15, 0.2, 0.25, 0.3]);
  assert.deepEqual(linearTicks(3707.2, 3710.9, 10, 1), [3708, 3709, 3710]);
});

test('formatting hooks: tick labels, time marks and prices can come from the host', async () => {
  const { resolveTheme } = await import('../src/core/theme.js');
  const { Series } = await import('../src/series/Series.js');

  // PriceScale.formatTicks labels all ticks at once; a missing entry keeps the built-in text
  const scale = new PriceScale();
  scale.setHeight(400);
  scale.fit(100, 200);
  const plain = scale.ticks();
  scale.formatTicks = (values) => values.map((v, i) => (i === 0 ? undefined : `¥${v}`));
  const custom = scale.ticks();
  assert.deepEqual(custom.map((t) => t.value), plain.map((t) => t.value));
  assert.equal(custom[0].label, plain[0].label);
  assert.equal(custom[1].label, `¥${custom[1].value}`);
  scale.setMode('percent');
  scale.base = 100;
  scale.fit(100, 200);
  assert.ok(scale.ticks().every((t) => t.label.endsWith('%')), 'the percent scale keeps its own labels');

  // TimeMarks.format overrides labels; null / undefined falls back
  const d = new BarData();
  const DAY = 86_400_000;
  const t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 60; i++) d.push(t0 + i * DAY, 1, 1, 1, 1, 0);
  const marks = new TimeMarks();
  marks.rebuild(d, 0);
  const builtin = marks.select(d, 0, 59, 0, 12, 720).map((m) => m.label);
  marks.format = (time, level) => (level >= 60 ? `M${new Date(time).getUTCMonth() + 1}` : null);
  const mixed = marks.select(d, 0, 59, 0, 12, 720);
  assert.ok(mixed.some((m) => m.label === 'M2'));
  mixed.forEach((m, i) => {
    if (m.level < 60) assert.equal(m.label, builtin[i]);
  });

  // Series.format goes through the chart option formatPrice
  const s = new Series();
  s.precision = 1;
  assert.equal(s.format(1234.56), '1,234.6');
  s.attach({ options: { formatPrice: (v) => `${Math.round(v)} JPY` } }, null);
  assert.equal(s.format(1234.56), '1235 JPY');

  // resolveTheme accepts custom candle colors and keeps them when the theme changes
  const mine = { up: '#112233', down: '#445566' };
  const light = resolveTheme('light', mine);
  assert.equal(light.up, '#112233');
  assert.equal(light.down, '#445566');
  assert.equal(resolveTheme('dark', light.scheme).down, '#445566');
  assert.equal(resolveTheme('light', 'intl').up, resolveTheme({ name: 'light' }, 'intl').up);
});

test('formatCompact: a value that rounds up moves to the next unit', () => {
  assert.equal(formatCompact(12_345), '12.3K');
  assert.equal(formatCompact(999_999), '1.00M');
  assert.equal(formatCompact(-999_999), '-1.00M');
  assert.equal(formatCompact(999_996_000), '1.00B');
  assert.equal(formatCompact(1_234_567), '1.23M');
});

test('formatDuration: no 60s, 60m or 24h just below a boundary', () => {
  setLocale('en');
  assert.equal(formatDuration(999.7), '1.0s');
  assert.equal(formatDuration(59_960), '1m');
  assert.equal(formatDuration(7_170_000), '2h');
  assert.equal(formatDuration(5_400_000), '1h 30m');
  assert.equal(formatDuration(2 * 86_400_000 + 23.6 * 3_600_000), '3d');
  assert.equal(formatDuration(3 * 86_400_000 + 16 * 3_600_000), '3d 16h');
  assert.equal(formatDuration(9_960), '10s');
});
