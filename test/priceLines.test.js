import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceLineRange, spreadBoxes } from '../src/core/priceLines.js';

const own = { min: 100, max: 120 };

test('priceLineRange: true always counts, false never, and non-finite prices are skipped', () => {
  const lines = [{ price: 300, autoscale: true }, { price: 5, autoscale: false }, { price: NaN, autoscale: true }, { price: 90 }];
  assert.deepEqual(priceLineRange(lines, own), { min: 300, max: 300 });
  assert.equal(priceLineRange([{ price: 1 }], own), null);
});

test("priceLineRange: 'near' counts a line within one height of the visible bars, and no farther", () => {
  const near = (price) => priceLineRange([{ price, autoscale: 'near' }], own);
  assert.deepEqual(near(125), { min: 125, max: 125 }); // just above the highs
  assert.deepEqual(near(140), { min: 140, max: 140 }); // exactly one height (20) away
  assert.equal(near(141), null);
  assert.deepEqual(near(80), { min: 80, max: 80 });
  assert.equal(near(79), null);
  assert.equal(priceLineRange([{ price: 110, autoscale: 'near' }], null), null); // nothing to be near to
  // a flat series: reach is a tenth of its level
  assert.deepEqual(priceLineRange([{ price: 109, autoscale: 'near' }], { min: 100, max: 100 }), { min: 109, max: 109 });
  assert.equal(priceLineRange([{ price: 111, autoscale: 'near' }], { min: 100, max: 100 }), null);
});

test('priceLineRange: merges into an existing range', () => {
  const r = priceLineRange([{ price: 130, autoscale: true }, { price: 50, autoscale: 'near' }], own, { min: 95, max: 110 });
  assert.deepEqual(r, { min: 95, max: 130 });
});

test('spreadBoxes: neighbours keep their gap inside the bounds, in ascending order', () => {
  const boxes = [{ id: 'a', y: 50 }, { id: 'b', y: 52 }, { id: 'c', y: 54 }];
  const out = spreadBoxes(boxes, 19, 9, 200);
  assert.deepEqual(out.map((b) => b.id), ['a', 'b', 'c']);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].y - out[i - 1].y >= 19);
  // pushed up from the bottom edge
  const low = spreadBoxes([{ y: 195 }, { y: 199 }], 19, 9, 200);
  assert.deepEqual(low.map((b) => b.y), [181, 200]);
  assert.deepEqual(spreadBoxes([{ y: 2 }], 19, 9, 200).map((b) => b.y), [9]);
});
