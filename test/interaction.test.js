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
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    },
    plotWidth: 300,
    height: 200,
    timeAxisHeight: 28,
    panes: [{ rect: { x: 0, y: 0, w: 300, h: 172 } }],
    trades: { hover: null, pointer: (...a) => calls.push(['trades.pointer', ...a]), click: () => calls.push(['trades.click']) },
    markers: { hover: null, pointer: (...a) => calls.push(['markers.pointer', ...a]), click: () => calls.push(['markers.click']) },
    clearCrosshair: () => calls.push(['clearCrosshair']),
    setCrosshair: (...a) => calls.push(['setCrosshair', a[0], a[1]]),
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

test('Interaction (not interactive): markers show on press, and a click is reported on lift only if the press stayed put', () => {
  const f = fixture();
  const at = (type, x, y) => ({ type, pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y, target: { closest: () => null } });
  f.fire('pointerdown', at('pointerdown', 50, 60));
  assert.deepEqual(f.calls.filter((c) => c[0].endsWith('.pointer')), [['trades.pointer', 50, 60], ['markers.pointer', 50, 60]]);
  assert.equal(f.calls.some((c) => c[0].endsWith('.click')), false); // not yet
  f.fire('pointerup', at('pointerup', 51, 61));
  assert.deepEqual(f.calls.filter((c) => c[0].endsWith('.click')), [['trades.click'], ['markers.click']]);

  // a drag that starts on a marker is not a click
  f.calls.length = 0;
  f.fire('pointerdown', at('pointerdown', 50, 60));
  f.fire('pointerup', at('pointerup', 90, 60));
  assert.equal(f.calls.some((c) => c[0].endsWith('.click')), false);
  // a cancelled press is not a click either
  f.calls.length = 0;
  f.fire('pointerdown', at('pointerdown', 50, 60));
  f.fire('pointercancel', at('pointercancel', 50, 60));
  assert.equal(f.calls.some((c) => c[0].endsWith('.click')), false);
});
