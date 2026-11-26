import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BarData } from '../src/core/BarData.js';
import { Pane } from '../src/core/Pane.js';
import { sampleTrades } from '../src/data/sample-trades.js';
import { TradeMarkers, barIndexAt, groupFills, normalizeTrades, positionOf, tradeResult } from '../src/trades/TradeMarkers.js';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5, 9);

/** Hourly bars with an overnight gap after every 6th bar (a market that closes). */
function bars(n) {
  const d = new BarData();
  let t = T0;
  for (let i = 0; i < n; i++) {
    const base = 100 + Math.sin(i / 3) * 5;
    d.push(t, base, base + 2, base - 2, base + 1, 10);
    t += (i + 1) % 6 === 0 ? 19 * HOUR : HOUR;
  }
  return d;
}

/** The little of a chart that TradeMarkers needs when nothing is drawn. */
function stubChart(data) {
  const events = [];
  return { data, events, emit: (type, payload) => events.push([type, payload]), invalidate() {} };
}

test('barIndexAt: a fill lands on the bar that contains its time', () => {
  const d = bars(12);
  assert.equal(barIndexAt(d, d.time[3]), 3); // exactly at a bar's start
  assert.equal(barIndexAt(d, d.time[3] + 1), 3);
  assert.equal(barIndexAt(d, d.time[4] - 1), 3); // the last instant of the bar
  // after the close, before the next open: the last bar of the session, not a point between two bars
  assert.equal(barIndexAt(d, d.time[5] + 5 * HOUR), 5);
  assert.equal(barIndexAt(d, d.time[6]), 6);
});

test('barIndexAt: outside the data the index is extrapolated by the bar interval', () => {
  const d = bars(12);
  const last = d.time[11];
  assert.equal(barIndexAt(d, last + HOUR - 1), 11); // still inside the last bar
  assert.equal(barIndexAt(d, last + HOUR), 12);
  assert.equal(barIndexAt(d, last + 2.5 * HOUR), 13);
  assert.equal(barIndexAt(d, T0 - 1), -1);
  assert.equal(barIndexAt(d, T0 - 2 * HOUR), -2);
  assert.ok(Number.isNaN(barIndexAt(new BarData(), T0)));
});

test('barIndexAt: ticks sharing a timestamp resolve to the first of them', () => {
  const d = BarData.ticks();
  for (const [t, p] of [[0, 1], [10, 2], [10, 3], [10, 4], [25, 5]]) d.push(t, p, p, p, p, 1);
  assert.equal(barIndexAt(d, 10), 1);
  assert.equal(barIndexAt(d, 24), 3);
});

test('normalizeTrades: fills and round trips, sorted by time, bad entries skipped', () => {
  const src = [
    { time: 300, price: 12, side: 'sell', qty: 5, label: 'TP' },
    { id: 'rt', side: 'short', qty: 2, entry: { time: 200, price: 20 }, exit: { time: 400, price: 15, label: 'cover' }, label: 'fade', note: 'n' },
    { time: 100, price: 10, side: 'buy' },
    { time: 'soon', price: 10 }, // not a time
    { time: 500, price: NaN },
    { side: 'long', entry: { time: 600 } }, // an entry without a price
    null,
    { time: new Date(50), price: '9.5', side: 'in' }, // Dates and numeric strings are fine; 'in' / 'out' are aliases
    { side: 'long', entry: { time: 700, price: 30 } }, // still open
  ];
  const { items, fills, trades } = normalizeTrades(src);
  assert.equal(items.length, 5);
  assert.deepEqual(fills.map((f) => f.time), [50, 100, 200, 300, 400, 700]);
  assert.deepEqual(fills.map((f) => f.buy), [true, true, false, false, true, true]);
  assert.deepEqual(fills.map((f) => f.role), [null, null, 'entry', null, 'exit', 'entry']);
  assert.equal(fills[0].price, 9.5);
  assert.equal(fills[1].qty, null);
  // a round trip keeps its id on both legs; the trade's label goes to the entry, the exit keeps its own
  const [short, open] = trades;
  assert.equal(short.long, false);
  assert.deepEqual([short.entry.id, short.exit.id, short.entry.label, short.exit.label], ['rt', 'rt', 'fade', 'cover']);
  assert.deepEqual([short.entry.qty, short.exit.qty, short.exit.note], [2, 2, 'n']);
  assert.equal(open.exit, null);
  assert.equal(new Set(items.map((it) => it.id)).size, 5); // generated ids are unique
  assert.deepEqual(normalizeTrades(undefined).fills, []);
});

test('tradeResult: gains are positive for both directions; open trades use the last price', () => {
  const [long, short, open] = normalizeTrades([
    { side: 'long', qty: 10, entry: { time: 1, price: 100 }, exit: { time: 2, price: 110 } },
    { side: 'short', entry: { time: 1, price: 100 }, exit: { time: 2, price: 110 } },
    { side: 'short', qty: 4, entry: { time: 1, price: 200 } },
  ]).trades;
  assert.deepEqual(tradeResult(long), { open: false, diff: 10, pct: 10, amount: 100 });
  assert.deepEqual(tradeResult(short), { open: false, diff: -10, pct: -10, amount: null });
  assert.deepEqual(tradeResult(open, 150), { open: true, diff: 50, pct: 25, amount: 200 });
  assert.equal(tradeResult(open), null);
});

test('groupFills: arrows of one side keep their distance; fills on one bar always share', () => {
  const at = (index, buy = true, price = 1) => ({ index, buy, price });
  const fills = [at(0), at(0, true, 3), at(0, false, 2), at(1), at(2), at(2, false), at(9), at(NaN)];
  // zoomed in: one group per bar and side
  const near = groupFills(fills, 0.5);
  assert.deepEqual(near.buy.map((g) => [g.first, g.last, g.fills.length]), [[0, 0, 2], [1, 1, 1], [2, 2, 1], [9, 9, 1]]);
  assert.deepEqual(near.sell.map((g) => [g.first, g.fills.length]), [[0, 1], [2, 1]]);
  assert.deepEqual([near.buy[0].lo, near.buy[0].hi], [1, 3]);
  // zoomed out: fills closer than the gap merge, starting from the first one
  const far = groupFills(fills, 2);
  assert.deepEqual(far.buy.map((g) => [g.first, g.last, g.fills.length]), [[0, 1, 3], [2, 2, 1], [9, 9, 1]]);
  for (const side of [far.buy, far.sell]) {
    for (let k = 1; k < side.length; k++) assert.ok(side[k].first - side[k - 1].first >= 2);
  }
});

test('positionOf: moving-average cost, realized results, and flipping to short', () => {
  const f = (buy, price, qty) => ({ buy, price, qty });
  let p = positionOf([f(true, 100, 10), f(true, 130, 20)]);
  assert.deepEqual([p.qty, p.avgPrice, p.realized], [30, 120, 0]);
  // selling part of it realizes against the average and leaves the average alone
  p = positionOf([f(true, 100, 10), f(true, 130, 20), f(false, 150, 10)]);
  assert.deepEqual([p.qty, p.avgPrice, p.realized, p.bought, p.sold], [20, 120, 300, 30, 10]);
  // selling more than is held closes it and opens a short at the fill's price
  p = positionOf([f(true, 100, 10), f(false, 90, 25)]);
  assert.deepEqual([p.qty, p.avgPrice, p.realized], [-15, 90, -100]);
  p = positionOf([f(true, 100, 10), f(false, 90, 25), f(true, 80, 15)]);
  assert.equal(p.qty, 0);
  assert.equal(p.realized, -100 + 150);
  assert.ok(Number.isNaN(p.avgPrice));
  // no quantity: one unit each
  assert.deepEqual(positionOf([{ buy: true, price: 10, qty: null }, { buy: true, price: 20, qty: null }]).avgPrice, 15);
});

test('TradeMarkers: list handling and the price range used for autoscaling', () => {
  const d = bars(30);
  const chart = stubChart(d);
  const tm = new TradeMarkers(chart);
  const a = { time: d.time[4] + 60_000, price: 80, side: 'buy', qty: 3 };
  const b = { id: 'b', side: 'long', entry: { time: d.time[10], price: 120 }, exit: { time: d.time[20] + 5, price: 95 } };
  tm.set([a, b]);
  assert.equal(tm.count, 3);
  assert.deepEqual(tm.items, [a, b]);
  assert.equal(chart.events.at(-1)[0], 'trades');
  // only the fills on the visible bars count
  assert.deepEqual(tm.range(0, 29), { min: 80, max: 120 });
  assert.deepEqual(tm.range(5, 15), { min: 120, max: 120 });
  assert.deepEqual(tm.range(18, 29), { min: 95, max: 95 });
  assert.equal(tm.range(11, 19), null);
  tm.visible = false;
  assert.equal(tm.range(0, 29), null);
  tm.visible = true;
  tm.setOptions({ autoscale: false });
  assert.equal(tm.range(0, 29), null);
  tm.setOptions({ autoscale: true });

  const id = tm.add({ time: d.time[25], price: 70, side: 'sell' });
  assert.equal(tm.count, 4);
  assert.equal(tm.add(null), null); // not an entry: nothing is added
  assert.deepEqual(tm.range(22, 29), { min: 70, max: 70 });
  tm.remove(id);
  tm.remove(a); // by the object that was passed in
  assert.deepEqual(tm.items, [b]);
  tm.remove('b');
  assert.equal(tm.count, 0);
  assert.equal(tm.range(0, 29), null);
});

test('TradeMarkers: fills follow the data as bars are appended or replaced', () => {
  const d = bars(12);
  const chart = stubChart(d);
  const tm = new TradeMarkers(chart);
  const last = d.time[11];
  // one fill inside the data, one three hours after the last bar
  tm.set([{ time: d.time[2], price: 50, side: 'buy' }, { time: last + 3 * HOUR + 60_000, price: 200, side: 'sell' }]);
  assert.deepEqual(tm.range(12, 20), { min: 200, max: 200 }); // extrapolated to bar 14
  assert.equal(tm.range(12, 13), null);
  // the market was closed in between: the next bars open later, and the fill belongs to the last bar before them
  d.push(last + 19 * HOUR, 1, 2, 0, 1, 1);
  d.push(last + 20 * HOUR, 1, 2, 0, 1, 1);
  assert.deepEqual(tm.range(11, 11), { min: 200, max: 200 });
  assert.equal(tm.range(12, 20), null);
  assert.deepEqual(tm.range(2, 2), { min: 50, max: 50 });
  // a different timeframe: same times, new indices
  const coarse = new BarData();
  for (let i = 0; i < 6; i++) coarse.push(T0 + i * 24 * HOUR, 1, 2, 0, 1, 1);
  chart.data = coarse;
  tm.dataChanged();
  assert.deepEqual(tm.range(0, 0), { min: 50, max: 50 });
  assert.deepEqual(tm.range(1, 1), { min: 200, max: 200 }); // the day it happened on
  assert.equal(tm.range(2, 5), null);
  // no data at all
  chart.data = new BarData();
  tm.dataChanged();
  assert.equal(tm.range(0, 10), null);
});

test('TradeMarkers.position: net position valued at the latest close', () => {
  const d = bars(8);
  const tm = new TradeMarkers(stubChart(d));
  tm.set([
    { time: d.time[1], price: 90, side: 'buy', qty: 10 },
    { time: d.time[3], price: 110, side: 'buy', qty: 10 },
    { time: d.time[5], price: 120, side: 'sell', qty: 5 },
  ]);
  const p = tm.position();
  const last = d.close[7];
  assert.deepEqual([p.qty, p.avgPrice, p.realized], [15, 100, 100]);
  assert.ok(Math.abs(p.unrealized - (last - 100) * 15) < 1e-9);
});

test('Pane.autoscale: extra values widen the visible scale only', () => {
  const pane = new Pane('main');
  const item = (scaleId, min, max) => ({ scaleId, visible: true, kind: 'indicator', precision: 2, format: String, range: () => ({ min, max }) });
  pane.add(item('right', 10, 20));
  pane.add(item('volume', 0, 1000));
  pane.layout({ x: 0, y: 0, w: 100, h: 100 });
  pane.autoscale(0, 9, 0, 9, { min: 5, max: 12 });
  assert.deepEqual([pane.scale.lo, pane.scale.hi], [5, 20]);
  assert.deepEqual([pane.scales.get('volume').lo, pane.scales.get('volume').hi], [0, 1000]);
  pane.autoscale(0, 9, 0, 9);
  assert.deepEqual([pane.scale.lo, pane.scale.hi], [10, 20]);
});

test('sampleTrades: deterministic, and every fill sits inside its bar', () => {
  const d = new BarData();
  let p = 500;
  let seed = 3;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 1500; i++) {
    const o = p;
    p = Math.max(50, p + (rand() - 0.5) * 12 + Math.sin(i / 40) * 2);
    d.push(T0 + i * HOUR, o, Math.max(o, p) + rand() * 3, Math.min(o, p) - rand() * 3, p, 100);
  }
  const trades = sampleTrades(d, { precision: 1 });
  assert.ok(trades.length > 10);
  assert.deepEqual(sampleTrades(d, { precision: 1 }), trades);
  for (const tr of trades) {
    assert.ok(tr.side === 'long' || tr.side === 'short');
    assert.ok(tr.qty > 0);
    for (const leg of [tr.entry, tr.exit].filter(Boolean)) {
      const i = barIndexAt(d, leg.time);
      assert.ok(leg.price >= d.low[i] - 0.05 && leg.price <= d.high[i] + 0.05, `price inside bar ${i}`);
      assert.equal(leg.price, +leg.price.toFixed(1));
    }
  }
  // only the last one may still be open, and each exit is the moment of a later cross
  assert.ok(trades.slice(0, -1).every((tr) => tr.exit && tr.exit.time > tr.entry.time));
  assert.deepEqual(sampleTrades(new BarData()), []);
});
