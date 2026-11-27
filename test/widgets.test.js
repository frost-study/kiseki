import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BarData } from '../src/core/BarData.js';
import { DemoFeed } from '../src/data/feed.js';
import { quoteFrom, quotesFor } from '../src/widgets/quotes.js';
import { RANGES, loadRange, pickTimeframe, rangeById, rangeStats } from '../src/widgets/ranges.js';
import { sparkPath } from '../src/widgets/ticker-tape.js';

const DAY = 86_400_000;

test('rangeStats: change is measured from the close just before the period', () => {
  const d = new BarData();
  // closes 10, 11, 12, … (one bar per day)
  for (let i = 0; i < 30; i++) d.push(i * DAY, 10 + i - 0.5, 10 + i + 1, 10 + i - 1, 10 + i, 100);
  const s = rangeStats(d, 20 * DAY);
  assert.equal(s.index, 20);
  assert.equal(s.ref, 29); // close of bar 19
  assert.equal(s.last, 39);
  assert.equal(s.change, 10);
  assert.ok(Math.abs(s.pct - (10 / 29) * 100) < 1e-9);
  assert.deepEqual([s.low, s.high, s.volume], [29, 40, 1000]);
  // when the period starts before the data, the first open is the reference
  const all = rangeStats(d, -Infinity);
  assert.deepEqual([all.index, all.ref], [0, 9.5]);
  assert.equal(rangeStats(new BarData(), 0), null);
});

test('timeframe selection per period', async () => {
  const feed = new DemoFeed({ ticks: 5000, fineDays: 3 });
  assert.equal(rangeById('1y').id, '1Y');
  assert.equal(rangeById('???').id, '1M');
  for (const range of RANGES) assert.equal(pickTimeframe(feed, 'FABLE', range.tf), range.tf);
  const { data, from, tf } = await loadRange(feed, 'FABLE', rangeById('1Y'));
  assert.equal(tf, '1D');
  assert.ok(data.length > 300 && data.lastTime - from === 365 * DAY);
  // imported daily data has no intraday bars, so the finest available timeframe is used
  const daily = new BarData();
  for (let i = 0; i < 400; i++) daily.push(i * DAY, 1, 2, 1, 2, 1);
  feed.addStatic('CSV', daily);
  assert.equal(pickTimeframe(feed, 'CSV', '5m'), '1D');
  assert.equal(pickTimeframe(feed, 'CSV', '1W'), '1W');
});

test('quotes: last price, daily change, and sharing between watchers', async () => {
  const d = new BarData();
  d.push(0, 9, 11, 9, 10, 1);
  d.push(DAY, 10, 13, 10, 12, 1);
  assert.deepEqual(quoteFrom(d), { last: 12, prev: 10, change: 2, pct: 20, time: DAY });
  assert.equal(quoteFrom(new BarData()), null);

  const feed = new DemoFeed({ ticks: 5000, fineDays: 2 });
  feed.speed = 600;
  const quotes = quotesFor(feed);
  assert.equal(quotesFor(feed), quotes);
  const a = [];
  const b = [];
  const offA = quotes.watch('MYTH/USD', (q) => a.push(q.last));
  const offB = quotes.watch('MYTH/USD', (q) => b.push(q.last));
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(a.length >= 2, 'live updates arrive after the first value');
  assert.equal(a.at(-1), b.at(-1));
  offA();
  const count = a.length;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(a.length, count, 'nothing arrives after unsubscribing');
  assert.ok(b.length > 0);
  offB();
  const countB = b.length;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(b.length, countB, 'the feed stops once everyone has unsubscribed');
});

test('sparkPath: a small polyline', () => {
  assert.equal(sparkPath([]), '');
  assert.equal(sparkPath([5]), '');
  assert.equal(sparkPath([1, 3, 2], 10, 10), 'M0.0 9.0L5.0 1.0L10.0 5.0');
  assert.ok(!sparkPath([4, 4, 4]).includes('NaN'));
});

test('quotes: calling an unsubscribe twice leaves a newer watcher of the same symbol alone', async () => {
  const feed = new DemoFeed({ ticks: 5000, fineDays: 2 });
  feed.speed = 600;
  const quotes = quotesFor(feed);
  const off = quotes.watch('FABLE', () => {});
  off();
  const seen = [];
  const offNew = quotes.watch('FABLE', (q) => seen.push(q.last));
  off();
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(seen.length >= 2, 'the newer watcher keeps receiving updates');
  offNew();
});

test('h: aria states are written as "true" / "false", and null children are left out', async () => {
  const saved = globalThis.document;
  globalThis.document = {
    createElement: (tag) => ({
      tag,
      attrs: {},
      kids: [],
      setAttribute(k, v) {
        this.attrs[k] = String(v);
      },
      addEventListener() {},
      append(...c) {
        this.kids.push(...c);
      },
    }),
  };
  try {
    const { h } = await import('../src/widgets/dom.js');
    const off = h('button', { 'aria-pressed': false, disabled: false, title: null }, null, 'x', false);
    assert.deepEqual(off.attrs, { 'aria-pressed': 'false' });
    assert.deepEqual(off.kids, ['x']);
    assert.equal(h('button', { 'aria-pressed': true, hidden: true }).attrs['aria-pressed'], 'true');
    assert.equal(h('button', { hidden: true }).attrs.hidden, '');
  } finally {
    globalThis.document = saved;
  }
});
