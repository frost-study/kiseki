import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv } from '../src/data/csv.js';
import { DemoFeed } from '../src/data/feed.js';
import { MarketSim, bridgePath, mulberry32 } from '../src/data/simulator.js';
import { Aggregator, aggregateTicks, bucketStart, resample, timeframeById } from '../src/data/timeframes.js';

const HOUR = 3_600_000;

test('bucketStart: days, weeks and months follow the time zone', () => {
  const jst = 9 * HOUR;
  const t = Date.UTC(2026, 10, 25, 20, 30); // Thu 26 Nov 05:30 in Japan
  assert.equal(bucketStart(t, timeframeById.get('1h')), Date.UTC(2026, 10, 25, 20));
  assert.equal(bucketStart(t, timeframeById.get('1D'), jst), Date.UTC(2026, 10, 25, 15));
  assert.equal(bucketStart(t, timeframeById.get('1W'), jst), Date.UTC(2026, 10, 22, 15)); // Monday 00:00 JST
  assert.equal(bucketStart(t, timeframeById.get('1M'), jst), Date.UTC(2026, 9, 31, 15));
});

test('synthetic data: ticks, 1-minute and hourly bars are mutually consistent', async () => {
  const feed = new DemoFeed({ utcOffset: 9 * HOUR, ticks: 60_000, fineDays: 5 });
  for (const sym of feed.symbols) {
    const h1 = await feed.history(sym.id, '1h');
    const m1 = await feed.history(sym.id, '1m');
    const ticks = await feed.history(sym.id, 'tick');
    assert.ok(h1.length > 5000 && m1.length > 1000 && ticks.length > 30_000, sym.id);

    // re-aggregating 1-minute bars into hours gives back the OHLC of the hourly bars
    const back = resample([m1], timeframeById.get('1h'));
    const off = h1.length - back.length;
    for (let i = 0; i < back.length; i++) {
      const a = h1.bar(off + i);
      const b = back.bar(i);
      assert.deepEqual([b.time, b.open, b.high, b.low, b.close], [a.time, a.open, a.high, a.low, a.close], `${sym.id} 1h[${i}]`);
    }
    // re-aggregating ticks into minutes gives back the OHLC of the 1-minute bars
    const m1b = resample([ticks], timeframeById.get('1m'));
    const off2 = m1.length - m1b.length;
    for (let i = 0; i < m1b.length; i++) {
      const a = m1.bar(off2 + i);
      const b = m1b.bar(i);
      assert.deepEqual([b.time, b.open, b.high, b.low, b.close], [a.time, a.open, a.high, a.low, a.close], `${sym.id} 1m[${i}]`);
    }
    for (let i = 1; i < ticks.length; i++) assert.ok(ticks.time[i] >= ticks.time[i - 1]);
  }
});

test('synthetic data: the past is identical across reloads', async () => {
  const a = await new DemoFeed({ ticks: 10_000, fineDays: 2 }).history('FABLE', '1D');
  const b = await new DemoFeed({ ticks: 10_000, fineDays: 2 }).history('FABLE', '1D');
  for (let i = 0; i < a.length - 2; i++) assert.deepEqual(a.bar(i), b.bar(i));
});

test('bridgePath: satisfies OHLC exactly', () => {
  const rand = mulberry32(3);
  const sim = new MarketSim({ seed: 3 });
  const round = (p) => Math.round(p * 100) / 100;
  for (let k = 0; k < 3000; k++) {
    const l = 50;
    const h = round(l + rand() * 5);
    const o = round(l + rand() * (h - l));
    const c = round(l + rand() * (h - l));
    const count = 5 + Math.floor(rand() * 200);
    const p = bridgePath(o, h, l, c, count, () => sim.gauss(), round);
    assert.equal(p.length, count);
    assert.equal(p[0], o);
    assert.equal(p[count - 1], c);
    assert.equal(Math.max(...p), Math.max(h, o, c));
    assert.equal(Math.min(...p), l);
  }
});

test('tick bars and the Aggregator', () => {
  const feedTicks = [];
  for (let i = 0; i < 25; i++) feedTicks.push([1000 + i * 10, 100 + (i % 7), 1]);
  const tf = timeframeById.get('10t');
  const agg = new Aggregator(tf);
  const bars = [];
  for (const [t, p, s] of feedTicks) {
    const { bar, isNew } = agg.add(t, p, s);
    if (isNew) bars.push({ ...bar });
    else Object.assign(bars[bars.length - 1], bar);
  }
  assert.equal(bars.length, 3);
  assert.deepEqual(bars.map((b) => b.volume), [10, 10, 5]);
  assert.deepEqual([bars[0].open, bars[0].high, bars[0].low, bars[0].close], [100, 106, 100, 102]);

  // time buckets: continue from the last bar of the history
  const sec = new Aggregator(timeframeById.get('1s'), 0, { time: 5000, open: 1, high: 2, low: 1, close: 2, volume: 3 });
  assert.equal(sec.add(5400, 3, 1).isNew, false);
  assert.deepEqual(sec.bar, { time: 5000, open: 1, high: 3, low: 1, close: 3, volume: 4 });
  assert.equal(sec.add(6001, 2.5, 2).isNew, true);
  assert.equal(sec.bar.time, 6000);
});

test('aggregateTicks: groups every N ticks', async () => {
  const feed = new DemoFeed({ ticks: 5000, fineDays: 1 });
  const ticks = await feed.history('MYTH/USD', 'tick');
  const bars = aggregateTicks(ticks, 100);
  assert.equal(bars.length, Math.ceil(ticks.length / 100));
  let v = 0;
  for (let i = 0; i < 100; i++) v += ticks.volume[i];
  assert.ok(Math.abs(bars.volume[0] - v) < 1e-9);
  assert.equal(bars.open[0], ticks.close[0]);
  assert.equal(bars.close[0], ticks.close[99]);
});

test('parseCsv: finds columns from the header and sorts by time', () => {
  const { data, precision } = parseCsv('Date,Open,High,Low,Close,Volume\n2026-01-06,10.5,11,10,10.75,300\n2026-01-05,10,10.6,9.9,10.5,200\n');
  assert.equal(data.length, 2);
  assert.equal(precision, 2);
  assert.equal(data.time[0], new Date(2026, 0, 5).getTime());
  assert.deepEqual(data.bar(1), { time: new Date(2026, 0, 6).getTime(), open: 10.5, high: 11, low: 10, close: 10.75, volume: 300 });
  const jp = parseCsv('日付;終値\n1767571200;100\n1767657600;101\n');
  assert.equal(jp.data.time[0], 1767571200000);
  assert.equal(jp.data.open[1], 101);
  assert.throws(() => parseCsv('a,b\n1,2\n'));
});

test('parseCsv: quotes, thousands separators and assorted date formats', async () => {
  const { decodeText } = await import('../src/data/csv.js');
  // a shape common in Japanese broker exports (quoted cells, thousands separators, Japanese headers)
  const q = parseCsv('﻿"日付","始値","高値","安値","終値","出来高"\n"2026/01/05","1,234.5","1,250","1,200","1,240.5","12,000"\n');
  assert.deepEqual(q.data.bar(0), { time: new Date(2026, 0, 5).getTime(), open: 1234.5, high: 1250, low: 1200, close: 1240.5, volume: 12000 });
  assert.equal(q.precision, 1);
  // date-only, undelimited and date-time values are read as local time
  for (const [text, expected] of [
    ['20260105', new Date(2026, 0, 5)],
    ['2026-01-05', new Date(2026, 0, 5)],
    ['2026年1月5日', new Date(2026, 0, 5)],
    ['2026/1/5 9:30', new Date(2026, 0, 5, 9, 30)],
    ['2026-01-05T09:30:15.250', new Date(2026, 0, 5, 9, 30, 15, 250)],
    ['2026-01-05T00:00:00Z', new Date(Date.UTC(2026, 0, 5))],
    ['1767571200', new Date(1767571200000)],
  ]) {
    assert.equal(parseCsv(`time,close\n${text},1\n`).data.time[0], expected.getTime(), text);
  }
  // separators and "" inside quotes
  assert.equal(parseCsv('time,note,close\n2026-01-05,"a, ""b""",7\n').data.close[0], 7);
  // Shift_JIS files can be read too
  const sjis = Uint8Array.from([0x93, 0xfa, 0x95, 0x74, 0x2c, 0x8f, 0x49, 0x92, 0x6c, 0x0a, 0x32, 0x30, 0x32, 0x36, 0x30, 0x31, 0x30, 0x35, 0x2c, 0x35, 0x0a]); // the bytes spell: 日付,終値\n20260105,5\n ("date,close")
  assert.equal(parseCsv(decodeText(sjis.buffer)).data.close[0], 5);
});

test('live feed: several subscribers to one symbol share a single price stream', async () => {
  const feed = new DemoFeed({ ticks: 5000, fineDays: 1 });
  feed.speed = 600;
  const h1 = await feed.history('MYTH/USD', '1m');
  const h2 = await feed.history('MYTH/USD', '1h');
  const seenA = [];
  const seenB = [];
  const offA = feed.subscribe('MYTH/USD', '1m', (bar) => seenA.push(bar.close), h1);
  const offB = feed.subscribe('MYTH/USD', '1h', (bar) => seenB.push(bar.close), h2);
  await new Promise((r) => setTimeout(r, 400));
  offA();
  const countA = seenA.length;
  await new Promise((r) => setTimeout(r, 200));
  offB();
  const countB = seenB.length;
  await new Promise((r) => setTimeout(r, 150));
  // both see the same tick stream, so the sequences of closes match
  assert.ok(countA > 10);
  assert.deepEqual(seenB.slice(0, countA), seenA);
  // nothing arrives after unsubscribing; once everyone has left, the timer stops too
  assert.equal(seenA.length, countA);
  assert.ok(countB > countA);
  assert.equal(seenB.length, countB);
});
