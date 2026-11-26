import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BarData } from '../src/core/BarData.js';
import { BarMarkers, normalizeMarkers } from '../src/markers/BarMarkers.js';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5, 9);

function bars(n) {
  const d = new BarData();
  for (let i = 0; i < n; i++) d.push(T0 + i * HOUR, 100, 110, 90, 100, 10);
  return d;
}

/** The little of a chart that BarMarkers needs: 10 px per bar, the price scale is y = 200 - price. */
function stubChart(data, height = 200) {
  const events = [];
  return {
    data,
    events,
    theme: { mono: 'monospace', accent: '#00f', up: '#0a0' },
    timeScale: { visibleRange: () => [0, data.length - 1], x: (i) => 5 + i * 10 },
    panes: [{ rect: { y: 20, h: height }, scale: { y: (v) => 200 - v } }],
    emit: (type, payload) => events.push([type, payload]),
    invalidate() {},
  };
}

/** A canvas context that records the fill colors and the text it was asked for. */
function stubContext() {
  const log = { fills: [], texts: [] };
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    arc() {},
    rect() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {
      log.fills.push(this.fillStyle);
    },
    fillText(text, x, y) {
      log.texts.push([text, x, y]);
    },
  };
  return { ctx, log };
}

test('normalizeMarkers: sorted by time, defaults filled in, bad entries skipped', () => {
  const a = { time: 300, text: 'later' };
  const b = { time: 100, position: 'below', shape: 'square', color: 'up', text: 7, id: 'b' };
  const c = { time: 100, shape: 'star' };
  const list = normalizeMarkers([a, null, { time: NaN }, { time: '' }, { text: 'no time' }, b, c]);
  assert.deepEqual(list.map((m) => m.source), [b, c, a]); // equal times keep the order given
  assert.deepEqual([list[0].above, list[0].shape, list[0].color, list[0].text, list[0].id], [false, 'square', 'up', '7', 'b']);
  assert.deepEqual([list[1].above, list[1].shape, list[1].color, list[1].text, list[1].id], [true, 'circle', 'accent', '', null]);
  assert.deepEqual(normalizeMarkers(undefined), []);
});

test('BarMarkers: list handling, events and removal by id or object', () => {
  const chart = stubChart(bars(10));
  const bm = new BarMarkers(chart);
  const a = { time: T0 + 2 * HOUR, id: 'a' };
  const b = { time: T0 + 4 * HOUR };
  bm.set([a, b]);
  assert.equal(bm.count, 2);
  assert.deepEqual(bm.items, [a, b]);
  assert.equal(chart.events.at(-1)[0], 'markers');
  bm.remove('a');
  assert.deepEqual(bm.items, [b]);
  bm.remove(b);
  assert.equal(bm.count, 0);
  bm.add(a);
  bm.clear();
  assert.equal(bm.count, 0);
});

test('BarMarkers: a marker sits just outside its bar, stacks, and keeps inside the pane', () => {
  const d = bars(10);
  const chart = stubChart(d);
  const bm = new BarMarkers(chart);
  const t = T0 + 3 * HOUR + 60_000; // inside bar 3
  bm.set([
    { time: t, text: 'J', color: '#f00' },
    { time: t, text: 'J2' }, // same side: stacks above the first
    { time: t, position: 'below', text: 'D', color: '#0f0' },
  ]);
  const { ctx, log } = stubContext();
  bm.draw(ctx);
  assert.deepEqual(log.fills, ['#f00', '#00f', '#0f0']); // a role name ('accent') resolves through the theme
  const x = 35; // bar 3
  const at = Object.fromEntries(log.texts.map(([text, tx, ty]) => [text, [tx, ty]]));
  assert.equal(at.J[0], x);
  // above the high (110 → y 90): 5 px gap + half the shape, then the text above that
  assert.equal(at.J[1], 90 - (5 + 4.5) - (4.5 + 3));
  assert.equal(at.J2[1], at.J[1] - 27); // one step higher
  assert.equal(at.D[1], 110 + (5 + 4.5) + (4.5 + 3)); // below the low (90 → y 110)
  // a bar at the top edge: the shape is pulled back into the pane
  const edge = stubChart(d, 60);
  const em = new BarMarkers(edge);
  em.set([{ time: T0, text: 'X' }]);
  const c2 = stubContext();
  em.draw(c2.ctx);
  assert.ok(c2.log.texts[0][2] >= 0 && c2.log.texts[0][2] <= 60);
});

test('BarMarkers: only the bars in view are drawn, and markers outside the data are not', () => {
  const chart = stubChart(bars(10));
  chart.timeScale.visibleRange = () => [4, 6];
  const bm = new BarMarkers(chart);
  bm.set([2, 4, 5, 6, 8].map((i) => ({ time: T0 + i * HOUR, text: String(i) })));
  const { ctx, log } = stubContext();
  bm.draw(ctx);
  assert.deepEqual(log.texts.map((x) => x[0]), ['4', '5', '6']);
  // after the last bar: it follows the data, so it is not drawn while there is no such bar
  const far = new BarMarkers(chart);
  far.set([{ time: T0 + 40 * HOUR, text: 'far' }]);
  const c2 = stubContext();
  far.draw(c2.ctx);
  assert.equal(c2.log.texts.length, 0);
});

test('BarMarkers: hover and click report the marker under the pointer', () => {
  const chart = stubChart(bars(10));
  const bm = new BarMarkers(chart);
  const pin = { time: T0 + 3 * HOUR, id: 'pin', text: 'J' };
  bm.set([pin]);
  bm.draw(stubContext().ctx);
  const cy = 90 - (5 + 4.5); // pane coordinates of the shape's centre
  bm.pointer(35, cy + 3);
  assert.equal(chart.events.at(-1)[0], 'marker:hover');
  assert.deepEqual(chart.events.at(-1)[1], { items: [pin], x: 35, y: cy + 20 }); // y in chart pixels (the pane starts at 20)
  const count = chart.events.length;
  bm.pointer(36, cy); // still the same marker: no new event
  assert.equal(chart.events.length, count);
  bm.click();
  assert.equal(chart.events.at(-1)[0], 'marker:click');
  assert.deepEqual(chart.events.at(-1)[1].items, [pin]);
  bm.pointer(80, cy); // away
  assert.equal(chart.events.at(-1)[0], 'marker:hover');
  assert.equal(chart.events.at(-1)[1], null);
  assert.equal(bm.hover, null);
  const before = chart.events.length;
  bm.click(); // nothing hovered: no click
  assert.equal(chart.events.length, before);
  // hidden markers are neither drawn nor hit
  bm.visible = false;
  const { ctx, log } = stubContext();
  bm.draw(ctx);
  assert.equal(log.fills.length, 0);
});
