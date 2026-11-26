import assert from 'node:assert/strict';
import { test } from 'node:test';
import { figureTypes, markTypes } from '../src/core/Registry.js';
import { resolveColor, resolveTheme } from '../src/core/theme.js';
import { hitTest } from '../src/figures/hit.js';
import { placeBoxes, placeTickLabels, spreadLabels, stackValues } from '../src/figures/layout.js';
import { bandScale, linearScale, makeScale, niceDomain, timeScale, timeTicks } from '../src/figures/scales.js';
import { directionOf, sparklineMarks } from '../src/figures/sparkline.js';

const DAY = 86_400_000;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not near ${b}`);

/* ───────────── scales ───────────── */

test('linearScale: maps both ways, reverse flips, a flat domain sits in the middle', () => {
  const s = linearScale({ domain: [0, 10], range: [100, 0] });
  assert.equal(s.scale(0), 100);
  assert.equal(s.scale(10), 0);
  near(s.invert(25), 7.5);
  const r = linearScale({ domain: [0, 10], range: [100, 0], reverse: true });
  assert.equal(r.scale(0), 0);
  assert.equal(linearScale({ domain: [5, 5], range: [0, 10] }).scale(5), 5);
  assert.deepEqual(s.ticks(5), [0, 2, 4, 6, 8, 10]);
});

test('bandScale: equal bands with the gap split to both sides, keys in order, reverse flips', () => {
  const s = bandScale({ domain: ['a', 'b', 'c', 'd'], range: [0, 100], padding: 0.2 });
  assert.equal(s.step, 25);
  assert.equal(s.bandwidth, 20);
  near(s.scale('a'), 2.5);
  near(s.pos('a'), 12.5);
  near(s.scale('d'), 77.5);
  assert.ok(Number.isNaN(s.scale('zzz')));
  assert.equal(s.invert(30), 'b');
  const r = bandScale({ domain: ['a', 'b'], range: [0, 100], reverse: true, padding: 0 });
  assert.equal(r.scale('a'), 50);
  assert.equal(r.scale('b'), 0);
  assert.deepEqual(s.ticks(), ['a', 'b', 'c', 'd']);
});

test('timeTicks: month starts aligned to multiples of k, the smallest k that fits; evenly spaced days for short spans', () => {
  const lo = Date.UTC(2025, 0, 15);
  const hi = Date.UTC(2025, 11, 20);
  const iso = (list) => list.map((v) => new Date(v).toISOString().slice(0, 10));
  assert.deepEqual(iso(timeTicks(lo, hi, 6)), ['2025-03-01', '2025-05-01', '2025-07-01', '2025-09-01', '2025-11-01']);
  assert.deepEqual(timeTicks(lo, hi, 4).map((v) => new Date(v).getUTCMonth()), [3, 6, 9]); // Apr, Jul, Oct
  const short = timeTicks(Date.UTC(2025, 0, 1), Date.UTC(2025, 0, 31), 4);
  assert.equal(short.length, 4);
  assert.equal(short[0], Date.UTC(2025, 0, 1));
  assert.equal(short.at(-1), Date.UTC(2025, 0, 31));
  assert.ok(short.every((v) => v % DAY === 0));
  assert.deepEqual(timeTicks(5, 5, 4), [5]);
  // with an offset the month starts are local ones
  const off = 9 * 3_600_000;
  assert.equal(timeTicks(lo, hi, 12, off)[0], Date.UTC(2025, 1, 1) - off);
  // too many for any step: the two ends
  assert.deepEqual(timeTicks(Date.UTC(2000, 0, 1), Date.UTC(2100, 0, 1), 1), [Date.UTC(2000, 0, 1), Date.UTC(2100, 0, 1)]);
});

test('makeScale: domain from the marks, padding of a flat one, nice rounding, band keys in order of appearance', () => {
  const s = makeScale({ scale: 'time' }, [Date.UTC(2025, 0, 1), Date.UTC(2025, 6, 1)], [0, 100]);
  assert.equal(s.type, 'time');
  assert.equal(s.scale(Date.UTC(2025, 6, 1)), 100);
  assert.equal(makeScale({}, [0, 0], [0, 10]).scale(0), 5);
  assert.deepEqual(makeScale({ nice: true }, [0.3, 9.4], [0, 1]).domain, [0, 10]);
  assert.deepEqual(makeScale({ include: [0] }, [3, 5], [0, 1]).domain, [0, 5]);
  assert.deepEqual(makeScale({ scale: 'band' }, ['x', 'y', 'x', 'z'], [0, 30]).domain, ['x', 'y', 'z']);
  assert.deepEqual(makeScale({ domain: [0, 1] }, [5], [0, 1]).domain, [0, 1]);
  assert.deepEqual(makeScale({}, [], [0, 1]).domain, [0, 1]);
  assert.deepEqual(niceDomain(0.3, 9.4, 5), [0, 10]);
  assert.equal(timeScale({ domain: [0, 10], range: [0, 1] }).type, 'time');
});

/* ───────────── layout ───────────── */

test('spreadLabels: untouched when apart, symmetric when two collide, chains and edges stay inside', () => {
  assert.deepEqual(spreadLabels([10, 40], { gap: 15 }), [10, 40]);
  assert.deepEqual(spreadLabels([50, 54], { gap: 15 }), [44.5, 59.5]);
  assert.deepEqual(spreadLabels([54, 50], { gap: 15 }), [59.5, 44.5], 'the order of the input is kept');
  const three = spreadLabels([50, 51, 52], { gap: 10 });
  near(three[1] - three[0], 10);
  near(three[2] - three[1], 10);
  near((three[0] + three[2]) / 2, 51);
  assert.deepEqual(spreadLabels([2, 3, 4], { gap: 10, min: 0 }), [0, 10, 20]);
  assert.deepEqual(spreadLabels([98, 99, 100], { gap: 10, max: 100 }), [80, 90, 100]);
  assert.deepEqual(spreadLabels([]), []);
  const many = spreadLabels([5, 5, 5, 6, 30, 31, 31], { gap: 12, min: 0, max: 100 });
  const sorted = [...many].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 12 - 1e-9);
  assert.ok(sorted[0] >= 0 && sorted.at(-1) <= 100);
});

test('placeTickLabels: centred, shifted inwards at the edges, a label too close to the previous one is dropped', () => {
  const kept = placeTickLabels([{ x: 5, w: 40 }, { x: 60, w: 40 }, { x: 70, w: 40 }, { x: 200, w: 40 }], 0, 220, 8);
  assert.deepEqual(kept.map((t) => t.left), [0, 50, 180]);
  assert.deepEqual(placeTickLabels([{ x: 10, w: 50 }], 0, 30, 8).map((t) => t.left), [0], 'a label wider than the room starts at the minimum');
});

test('placeBoxes: a label avoids the ones placed before it, and hangs to the left near the edge', () => {
  const out = placeBoxes([{ id: 'a', x: 10, y: 20, w: 30 }, { id: 'b', x: 12, y: 21, w: 30 }], { h: 14, gap: 9 });
  assert.equal(out.get('a').y, 20);
  assert.ok(Math.abs(out.get('b').y - out.get('a').y) >= 14);
  assert.deepEqual(placeBoxes([{ id: 'c', x: 95, y: 5, w: 20 }], { maxX: 100 }).get('c'), { x: 86, y: 5, side: 'end' });
  const bounded = placeBoxes([{ id: 'd', x: 0, y: 3, w: 10 }, { id: 'e', x: 0, y: 4, w: 10 }], { h: 14, minY: 0, maxY: 40 });
  assert.ok(bounded.get('e').y - 7 >= 0);
});

test('stackValues: positives stack up and negatives down from zero, percent scales each category to 100', () => {
  const s = stackValues([[1, -2, 0], [2, -1, NaN], [3, 4, undefined]]);
  assert.deepEqual(s[0][0], { from: 0, to: 1 });
  assert.deepEqual(s[1][0], { from: 1, to: 3 });
  assert.deepEqual(s[2][0], { from: 3, to: 6 });
  assert.deepEqual(s[0][1], { from: 0, to: -2 });
  assert.deepEqual(s[1][1], { from: -2, to: -3 });
  assert.deepEqual(s[2][1], { from: 0, to: 4 });
  assert.deepEqual(s[1][2], { from: 0, to: 0 });
  const p = stackValues([[1, 0], [3, 0]], 'percent');
  assert.deepEqual([p[0][0].to, p[1][0].to], [25, 100]);
  assert.deepEqual(p[1][1], { from: 0, to: 0 });
});

/* ───────────── hit testing ───────────── */

test('hitTest: inside a box or circle, near a path, topmost first, nearest within the slop', () => {
  const marks = [
    { id: 'box', kind: 'rect', x: 10, y: 10, w: 20, h: 20 },
    { id: 'dot', kind: 'circle', cx: 20, cy: 20, r: 4, x: 16, y: 16, w: 8, h: 8 },
    { id: 'line', kind: 'path', runs: [[{ x: 0, y: 50 }, { x: 100, y: 50 }], [{ x: 0, y: 80 }]], tol: 7, x: 0, y: 50, w: 100, h: 30 },
  ];
  assert.equal(hitTest(marks, 20, 20).id, 'dot', 'the later (upper) mark wins');
  assert.equal(hitTest(marks, 11, 11).id, 'box');
  assert.equal(hitTest(marks, 50, 56).id, 'line');
  assert.equal(hitTest(marks, 50, 58), null);
  assert.equal(hitTest(marks, 50, 58, 2).id, 'line');
  assert.equal(hitTest(marks, 3, 83).id, 'line', 'a one-point run counts as a point');
  assert.equal(hitTest(marks, 200, 200), null);
});

/* ───────────── sparkline ───────────── */

test('sparklineMarks: baseline at the first value by default, end dot by direction, non-finite values dropped, under two leaves nothing', () => {
  assert.equal(sparklineMarks([1]), null);
  assert.equal(sparklineMarks([1, NaN, undefined]), null);
  const up = sparklineMarks([1, NaN, 3, 2, 4]);
  assert.equal(up.direction, 'up');
  assert.deepEqual(up.xDomain, [0, 3]);
  assert.deepEqual(up.marks.map((m) => m.type), ['rule', 'line', 'dot']);
  assert.equal(up.marks[0].y, 1);
  assert.equal(up.marks[2].color, 'up');
  assert.deepEqual(up.marks[1].points.map((p) => p.y), [1, 3, 2, 4]);
  const down = sparklineMarks([5, 4, 3], { baseline: 10, colors: { down: 3 } });
  assert.equal(down.marks[0].y, 10);
  assert.deepEqual(down.yInclude, [10]);
  assert.equal(down.marks[2].color, 3);
  const plain = sparklineMarks([1, 2], { baseline: null, tone: 'plain' });
  assert.deepEqual(plain.marks.map((m) => m.type), ['line', 'dot']);
  assert.equal(plain.marks[1].color, 'series');
  assert.equal(sparklineMarks([2, 2]).direction, 'flat');
  assert.equal(directionOf(-0.1), 'down');
});

/* ───────────── theme roles and registries ───────────── */

test('resolveColor: the neutral roles figures need, palette indices and plain CSS colors', () => {
  const th = resolveTheme('dark');
  assert.equal(resolveColor(th, 'grid'), th.grid);
  assert.equal(resolveColor(th, 'axis'), th.axisLine);
  assert.equal(resolveColor(th, 'faint'), th.textFaint);
  assert.equal(resolveColor(th, 'surface'), th.surface);
  assert.equal(resolveColor(th, 1), th.palette[1]);
  assert.equal(resolveColor(th, 9), th.palette[1], 'palette indices wrap');
  assert.equal(resolveColor(th, '#123456'), '#123456');
});

test('registries: the figures and marks built in, and an unknown id is an error', async () => {
  await import('../src/index.js');
  for (const id of ['cartesian', 'sparkline']) assert.ok(figureTypes.has(id), id);
  for (const id of ['line', 'area', 'bar', 'dot', 'rule', 'region', 'cell', 'text', 'arrow']) assert.ok(markTypes.has(id), id);
  assert.throws(() => markTypes.get('nope'), /Unknown mark type: nope/);
});
