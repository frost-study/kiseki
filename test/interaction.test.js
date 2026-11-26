import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Interaction } from '../src/core/Interaction.js';

/** A chart that only records what Interaction asks of it, with a root that keeps its listeners. */
function fixture() {
  const handlers = new Map();
  const calls = [];
  const chart = {
    options: { interactive: false },
    root: {
      addEventListener: (type, fn) => handlers.set(type, fn),
      removeEventListener() {},
      style: {},
    },
    trades: { hover: null, pointer: (...a) => calls.push(['trades.pointer', ...a]) },
    markers: { hover: null, pointer: (...a) => calls.push(['markers.pointer', ...a]) },
    clearCrosshair: () => calls.push(['clearCrosshair']),
  };
  const interaction = new Interaction(chart);
  return { chart, calls, fire: (type, e = {}) => handlers.get(type)?.(e), interaction };
}

test('Interaction: a mouse that leaves the chart closes the marker details; a lifted finger leaves them open', () => {
  const f = fixture();
  f.fire('pointerleave', { pointerType: 'mouse' });
  assert.deepEqual(f.calls.filter((c) => c[0] === 'trades.pointer'), [['trades.pointer', null]]);
  f.calls.length = 0;
  // a touch cannot hover: the details a tap opened stay until the next tap
  f.fire('pointerleave', { pointerType: 'touch' });
  assert.deepEqual(f.calls, [['clearCrosshair']]);
  f.fire('pointerleave', { pointerType: 'pen' });
  assert.deepEqual(f.calls.filter((c) => c[0] === 'trades.pointer'), [['trades.pointer', null]]);
});
