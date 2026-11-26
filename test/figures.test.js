import assert from 'node:assert/strict';
import { test } from 'node:test';
import { figureTypes, markTypes } from '../src/core/Registry.js';
import { resolveColor, resolveTheme } from '../src/core/theme.js';
import { hitTest } from '../src/figures/hit.js';
import { donutSlices, sectorBounds, sectorOutline, unwrap } from '../src/figures/donut.js';
import { fadeOpacities, linkPoints } from '../src/figures/marks.js';
import { ellipsize, fitLines, squarify } from '../src/figures/treemap.js';
import { nextInDirection, placeBoxes, placeTickLabels, spreadLabels, stackValues } from '../src/figures/layout.js';
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
  for (const id of ['cartesian', 'sparkline', 'donut', 'treemap']) assert.ok(figureTypes.has(id), id);
  for (const id of ['line', 'area', 'bar', 'dot', 'rule', 'region', 'cell', 'text', 'arrow', 'link']) assert.ok(markTypes.has(id), id);
  assert.throws(() => markTypes.get('nope'), /Unknown mark type: nope/);
});

/* ───────────── treemap layout ───────────── */

test('squarify: the same tiles as d3-hierarchy treemapSquarify with paddingInner(2) and round(true), largest first', () => {
  const values = [30, 5, 12, 8, 20, 3, 22].map((value) => ({ value }));
  const tiles = squarify(values, { width: 400, height: 220, gap: 2 });
  assert.deepEqual(
    tiles.map((t) => [t.index, t.x0, t.y0, t.x1, t.y1]),
    [[0, 0, 0, 207, 126], [6, 0, 128, 207, 220], [4, 209, 0, 328, 146], [2, 330, 0, 400, 146], [3, 209, 148, 304, 220], [1, 306, 148, 364, 220], [5, 366, 148, 400, 220]],
  );
});

test('squarify: areas follow the values, no gap tiles the box exactly, bad values and boxes leave nothing', () => {
  const tiles = squarify([{ value: 6 }, { value: 3 }, { value: 1 }, { value: 0 }, { value: -2 }, { value: NaN }, null], { width: 100, height: 50, round: false });
  assert.deepEqual(tiles.map((t) => t.index), [0, 1, 2]);
  const area = (t) => (t.x1 - t.x0) * (t.y1 - t.y0);
  near(area(tiles[0]), 3000, 1e-6);
  near(area(tiles[1]), 1500, 1e-6);
  near(area(tiles[2]), 500, 1e-6);
  near(tiles.reduce((a, t) => a + area(t), 0), 5000, 1e-6);
  assert.ok(tiles.every((t) => t.x0 >= -1e-9 && t.y0 >= -1e-9 && t.x1 <= 100 + 1e-9 && t.y1 <= 50 + 1e-9));
  assert.deepEqual(squarify([], { width: 10, height: 10 }), []);
  assert.deepEqual(squarify([{ value: 1 }], { width: 0, height: 10 }), []);
  const one = squarify([{ value: 4 }], { width: 90, height: 40, gap: 2 });
  assert.deepEqual([one[0].x0, one[0].y0, one[0].x1, one[0].y1], [0, 0, 90, 40], 'a lone tile fills the box, the gap only lies between tiles');
});

test('fitLines: a tile shows its title, or its title and value, or nothing; a line that does not fit hides the ones after it', () => {
  const lines = [{ minW: 40, minH: 22 }, { minW: 76, minH: 44 }];
  assert.equal(fitLines(lines, 100, 60), 2);
  assert.equal(fitLines(lines, 60, 60), 1);
  assert.equal(fitLines(lines, 100, 30), 1);
  assert.equal(fitLines(lines, 39, 60), 0);
  assert.equal(fitLines([{ minW: 80 }, { minW: 10 }], 50, 50), 0, 'the second line does not show alone');
  assert.equal(fitLines(undefined, 50, 50), 0);
});

test('ellipsize: text that fits is kept, otherwise the longest prefix with an ellipsis that fits', () => {
  const measure = (s) => s.length * 10;
  assert.equal(ellipsize(measure, 'Energy', 60), 'Energy');
  assert.equal(ellipsize(measure, 'Technology', 60), 'Techn…');
  assert.equal(ellipsize(measure, 'Technology', 15), '…');
  assert.equal(ellipsize(measure, 'Technology', 5), '');
});

/* ───────────── donut geometry ───────────── */

test('donutSlices: proportional spans from 12 o\'clock, a gap per slice only with two or more, non-positive values leave no slice', () => {
  const s = donutSlices([{ value: 1 }, { value: 0 }, { value: 3 }], { padAngle: 0.1 });
  assert.deepEqual(s.map((x) => x.index), [0, 2]);
  near(s[0].a0, -Math.PI / 2);
  near(s[1].a1, -Math.PI / 2 + Math.PI * 2);
  near(s[0].a1, s[1].a0);
  const spans = s.map((x) => x.a1 - x.a0 - 0.1);
  near(spans[1] / spans[0], 3);
  near(s[0].share, 0.25);
  const one = donutSlices([{ value: 5 }], { padAngle: 0.1 });
  near(one[0].a1 - one[0].a0, Math.PI * 2);
  assert.deepEqual(donutSlices([], {}), []);
  assert.deepEqual(donutSlices([{ value: 0 }]), []);
});

test('sectorOutline: the corner circles touch both circles and the side lines; a whole ring has none; a sliver is dropped', () => {
  const o = sectorOutline({ cx: 0, cy: 0, r0: 54, r1: 80, a0: 0.2, a1: 1.5, gap: 2.4, corner: 2 });
  assert.equal(o.whole, false);
  assert.equal(o.corners.length, 4);
  const [outerStart, outerEnd, innerEnd, innerStart] = o.corners;
  // the corner circles of the outer edge sit r1 - cr from the centre, those of the inner edge r0 + cr
  for (const c of [outerStart, outerEnd]) near(Math.hypot(c.cx, c.cy), 78, 1e-9);
  for (const c of [innerEnd, innerStart]) near(Math.hypot(c.cx, c.cy), 56, 1e-9);
  // the first side is 1.2 px from the radius at its angle, and the corner circle's centre 1.2 + 2 from it
  const n0 = { x: -Math.sin(0.2), y: Math.cos(0.2) };
  near(outerStart.cx * n0.x + outerStart.cy * n0.y, 3.2, 1e-9);
  assert.deepEqual(o.start, { x: outerStart.cx - n0.x * 2, y: outerStart.cy - n0.y * 2 });
  // a convex shape drawn clockwise turns clockwise at every corner, by less than half a turn
  for (const c of o.corners) {
    const sweep = unwrap(c.from, c.to, false) - c.from;
    assert.ok(sweep > 0 && sweep < Math.PI, `corner sweep ${sweep}`);
  }
  const whole = sectorOutline({ r0: 54, r1: 80, a0: 0, a1: Math.PI * 2, gap: 0, corner: 2 });
  assert.equal(whole.whole, true);
  assert.equal(sectorOutline({ r0: 54, r1: 80, a0: 0, a1: 0.01, gap: 6, corner: 2 }), null, 'thinner than its gap');
  assert.equal(sectorOutline({ r0: 80, r1: 54, a0: 0, a1: 1 }), null);
  const sharp = sectorOutline({ r0: 54, r1: 80, a0: 0, a1: 1, gap: 0, corner: 0 });
  assert.equal(sharp.cr, 0);
});

test('sectorBounds: covers the arc ends and the extremes the sector sweeps over', () => {
  const b = sectorBounds({ cx: 100, cy: 100, r0: 20, r1: 50, a0: -0.1, a1: Math.PI / 2 + 0.1 });
  assert.ok(b.x + b.w >= 150 - 1e-9 && b.y + b.h >= 150 - 1e-9, 'reaches the outer circle on the right and at the bottom');
  assert.ok(b.x >= 100 - 50 * Math.sin(0.1) - 1e-9 && b.x <= 100);
});

test('hitTest: a ring sector is hit between its radii and angles, and by the distance to its sides outside them', () => {
  const arc = { id: 'a', kind: 'arc', cx: 50, cy: 50, r0: 20, r1: 40, a0: 0, a1: Math.PI / 2, x: 50, y: 50, w: 40, h: 40 };
  assert.equal(hitTest([arc], 50 + 30 * Math.cos(0.7), 50 + 30 * Math.sin(0.7))?.id, 'a');
  assert.equal(hitTest([arc], 50 + 10, 50 + 1), null, 'inside the hole');
  assert.equal(hitTest([arc], 50 + 45, 50 + 1), null, 'outside the ring');
  assert.equal(hitTest([arc], 50 - 30, 50), null, 'the other half');
  assert.equal(hitTest([arc], 50 + 30, 50 - 2, 3)?.id, 'a', 'just past the first side, within the slop');
});

/* ───────────── small pure helpers ───────────── */

test('nextInDirection: the nearest mark centre to centre, a mark off to the side counts double, null at the edge', () => {
  const grid = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) grid.push({ id: `${r}${c}`, x: c * 30, y: r * 30, w: 28, h: 28 });
  assert.equal(nextInDirection(grid, '11', 'right'), '12');
  assert.equal(nextInDirection(grid, '11', 'left'), '10');
  assert.equal(nextInDirection(grid, '11', 'up'), '01');
  assert.equal(nextInDirection(grid, '11', 'down'), '21');
  assert.equal(nextInDirection(grid, '02', 'right'), null);
  assert.equal(nextInDirection(grid, '00', 'up'), null);
  assert.equal(nextInDirection(grid, 'nope', 'up'), null);
  // a wide tile on top: from the small tile below its right half, up goes to it, not to a farther one
  const odd = [{ id: 'top', x: 0, y: 0, w: 100, h: 20 }, { id: 'a', x: 0, y: 30, w: 40, h: 20 }, { id: 'b', x: 60, y: 30, w: 40, h: 20 }];
  assert.equal(nextInDirection(odd, 'b', 'up'), 'top');
  assert.equal(nextInDirection(odd, 'a', 'right'), 'b');
});

test('fadeOpacities: from the first to the last segment, a lone segment is the last value; linkPoints: from one end to the other', () => {
  assert.deepEqual(fadeOpacities(0), []);
  assert.deepEqual(fadeOpacities(1), [0.9]);
  const f = fadeOpacities(5, { from: 0.1, to: 0.9 });
  near(f[0], 0.1);
  near(f[4], 0.9);
  near(f[2], 0.5);
  const h = linkPoints({ x: 0, y: 0 }, { x: 100, y: 40 }, 'h', 4);
  assert.deepEqual([h[0], h.at(-1)], [{ x: 0, y: 0 }, { x: 100, y: 40 }]);
  near(h[2].x, 50);
  near(h[2].y, 20);
  const v = linkPoints({ x: 0, y: 0 }, { x: 40, y: 100 }, 'v', 4);
  near(v[1].x, 40 * 0.15625, 1e-9); // 3 u^2 t * 0 + 3 u t^2 * x + t^3 * x at t = 1/4
});
