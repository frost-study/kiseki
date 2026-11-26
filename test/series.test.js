import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BarData } from '../src/core/BarData.js';
import { BaselineSeries } from '../src/series/builtins.js';

function closes(values) {
  const d = new BarData();
  values.forEach((c, i) => d.push(i * 60_000, c, c, c, c, 1));
  return d;
}

function series(values, options = {}, firstVisible = 0) {
  const s = new BaselineSeries(options);
  s.attach({ visibleBars: () => [firstVisible, values.length - 1] }, null);
  s.setData(closes(values));
  return s;
}

const theme = { up: '#0a0', down: '#a00', textFaint: '#999', palette: [] };

test('BaselineSeries: by default the baseline is the first visible close', () => {
  const s = series([100, 110, 90, 105], {}, 1);
  assert.deepEqual(s.range(0, 3), { min: 90, max: 110 });
  assert.deepEqual(s.lastValues(theme), [{ value: 105, color: '#a00', line: true }]); // below 110
  assert.equal(series([100, 110, 90, 105], {}, 0).lastValues(theme)[0].color, '#0a0'); // above 100
});

test('BaselineSeries: a fixed base stays in the price range and decides the color of the last value', () => {
  const s = series([100, 110, 90, 105], { base: 0 });
  assert.deepEqual(s.range(0, 3), { min: 0, max: 110 }); // zero is part of the picture
  assert.deepEqual(s.range(1, 1), { min: 0, max: 110 });
  assert.equal(s.lastValues(theme)[0].color, '#0a0');
  const loss = series([-5, -2, -8, -3], { base: 0 });
  assert.deepEqual(loss.range(0, 3), { min: -8, max: 0 });
  assert.equal(loss.lastValues(theme)[0].color, '#a00');
  assert.equal(series([1, 2], { base: NaN }).range(0, 1).min, 1); // not a number: the first-close rule
});

test('BaselineSeries: the baseline is drawn at the fixed value, in its own color', () => {
  const s = series([100, 110, 90, 105], { base: 100, baseColor: '#00f' });
  const moves = [];
  let stroke = null;
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    fill() {},
    stroke() {
      stroke = this.strokeStyle;
    },
    setLineDash() {},
    moveTo: (x, y) => moves.push([x, y]),
    lineTo() {},
    closePath() {},
  };
  const view = { ctx, dpr: 1, theme, width: 300, height: 200, x0: 5, bs: 10, a: 0, b: 3, ra: 0, rb: 3, y: (v) => 200 - v };
  s.draw(view);
  assert.ok(moves.some(([x, y]) => x === 0 && y === 100.5)); // y(100) = 100, snapped to the pixel grid
  assert.equal(stroke, '#00f');
});
