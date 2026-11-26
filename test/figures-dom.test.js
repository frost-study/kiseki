import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { CartesianFigure } from '../src/figures/CartesianFigure.js';
import { SparklineFigure } from '../src/figures/sparkline.js';
import { createFigure } from '../src/figures/create.js';
import '../src/figures/builtins.js';

/** Just enough DOM for a figure: elements with a style, a canvas whose context records every call, rAF and ResizeObserver. */
let env;

function makeContext(log) {
  const state = {};
  return new Proxy(state, {
    get(t, k) {
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k in t) return t[k];
      return (...args) => log.push([k, ...args]);
    },
    set(t, k, v) {
      t[k] = v;
      log.push(['set ' + k, v]);
      return true;
    },
  });
}

function element(tag) {
  const el = {
    tag,
    style: {},
    children: [],
    listeners: [],
    attrs: {},
    removed: false,
    rect: { left: 0, top: 0, width: 300, height: 120 },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    append(...c) {
      this.children.push(...c);
    },
    remove() {
      this.removed = true;
    },
    addEventListener(type, fn) {
      this.listeners.push(type);
      this['on' + type] = fn;
    },
    removeEventListener() {},
    getBoundingClientRect() {
      return this.rect;
    },
  };
  if (tag === 'canvas') {
    el.log = [];
    const ctx = makeContext(el.log);
    el.getContext = () => ctx;
  }
  return el;
}

beforeEach(() => {
  env = { frames: [], observers: [], saved: {} };
  for (const k of ['document', 'window', 'ResizeObserver', 'requestAnimationFrame']) env.saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  define('document', { createElement: element, fonts: undefined });
  define('window', { devicePixelRatio: 2 });
  define('ResizeObserver', class { constructor() { env.observers.push(this); } observe() {} disconnect() { this.gone = true; } });
  define('requestAnimationFrame', (fn) => env.frames.push(fn));
});

afterEach(() => {
  runFrames(); // the page-wide frame callback must have run, or the next test would wait for it
  for (const [k, d] of Object.entries(env.saved)) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete globalThis[k];
  }
});

const runFrames = () => {
  const list = env.frames.splice(0);
  for (const fn of list) fn();
  return list.length;
};
const calls = (fig, name) => fig.canvas.log.filter((c) => c[0] === name);

test('a figure with a fixed size observes nothing, sizes its canvas by the pixel ratio and never takes the wheel or touch', () => {
  const host = element('div');
  const fig = new SparklineFigure(host, { width: 80, height: 24 });
  assert.equal(env.observers.length, 0);
  assert.match(fig.root.style.cssText, /width:80px;height:24px/);
  assert.deepEqual([fig.canvas.width, fig.canvas.height, fig.canvas.style.width], [160, 48, '80px']);
  assert.equal(fig.canvas.attrs['aria-hidden'], 'true');
  assert.match(fig.canvas.style.cssText, /touch-action:auto/);
  assert.deepEqual(fig.canvas.listeners, [], 'no listeners at all until someone asks for hover or click');
  assert.equal(host.children[0], fig.root);
});

test('redraws are batched: many changes make one frame, and nothing is drawn before it', () => {
  const fig = new SparklineFigure(element('div'), { width: 80, height: 24 });
  fig.setData([1, 2, 3]);
  fig.setData([3, 2, 1]);
  fig.setOptions({ baseline: 5 });
  fig.setTheme('dark');
  assert.equal(env.frames.length, 1);
  assert.equal(calls(fig, 'stroke').length, 0);
  runFrames();
  assert.ok(calls(fig, 'stroke').length > 0);
  assert.equal(fig.direction, 'down');
  fig.renderNow();
  assert.equal(env.frames.length, 0);
});

test('one animation frame serves every figure on the page', () => {
  const figs = Array.from({ length: 50 }, () => new SparklineFigure(element('div'), { width: 60, height: 20 }));
  figs.forEach((f, i) => f.setData([i, i + 1, i]));
  assert.equal(env.frames.length, 1);
  runFrames();
  assert.ok(figs.every((f) => calls(f, 'arc').length === 1), 'every figure drew its end dot');
});

test('the sparkline draws a dashed baseline, a line and an end dot in the line geometry of the old SVG sparkline', () => {
  const fig = new SparklineFigure(element('div'), { width: 72, height: 22 });
  fig.setData([10, 12, 11, 14]);
  fig.renderNow();
  // y from 3 to 19 (pad 3), x from 3 to 69: the end dot sits on the top right, the line starts at the baseline height
  const [, cx, cy, r] = calls(fig, 'arc')[0];
  assert.equal(cx, 69);
  assert.equal(cy, 3);
  assert.equal(r, 2.5);
  const moves = calls(fig, 'moveTo');
  assert.deepEqual(moves.at(-1).slice(1), [3, 19], 'the line starts at the first (lowest) value');
  assert.ok(fig.canvas.log.some((c) => c[0] === 'setLineDash' && c[1].join() === '2,3'));
  assert.deepEqual(calls(fig, 'setTransform')[0].slice(1), [2, 0, 0, 2, 0, 0]);
});

test('fewer than two values draw nothing', () => {
  const fig = new SparklineFigure(element('div'), { width: 72, height: 22 });
  fig.setData([1]);
  fig.renderNow();
  assert.equal(calls(fig, 'stroke').length, 0);
  assert.equal(fig.direction, null);
});

test('a figure without a fixed size follows its container', () => {
  const host = element('div');
  const fig = new CartesianFigure(host, { height: 100 });
  assert.equal(env.observers.length, 1);
  assert.equal(fig.width, 300);
  assert.equal(fig.height, 100, 'a fixed side stays fixed');
  runFrames();
  fig.destroy();
  assert.ok(env.observers[0].gone);
  assert.ok(fig.root.removed);
  fig.setData([]);
  assert.equal(env.frames.length, 0, 'a destroyed figure schedules nothing');
});

const fan = [
  { type: 'area', points: [0, 1, 2, 3].map((x) => ({ x, y0: -2, y1: 2 })), color: 1, opacity: 0.2 },
  { type: 'line', id: 'you', datum: { n: 1 }, points: [[0, 0], [1, 1], [2, -1], [3, 0.5]], color: 'series', width: 2.25 },
  { type: 'text', text: 'You', at: 'end', y: 0.5, baseline: 'middle', place: { group: 'ends', mode: 'spread', gap: 15 } },
  { type: 'text', text: 'Median', at: 'end', y: 0.4, baseline: 'middle', place: { group: 'ends', mode: 'spread', gap: 15 } },
  { type: 'dot', id: 'last', x: 3, y: 0.5, r: 3, color: 'series' },
];

function plot(extra = {}) {
  const fig = new CartesianFigure(element('div'), {
    width: 400,
    height: 200,
    margin: { top: 8 },
    x: { domain: [0, 3], axis: { ticks: [0, 3], format: (v) => `m${v}` } },
    y: { domain: [-2, 2], axis: { ticks: [-2, 0, 2], format: (v) => `${v}k` }, grid: true },
    ...extra,
  });
  fig.setData(fan);
  fig.renderNow();
  return fig;
}

test('cartesian: margins fit the tick labels and end labels, marks with ids are exposed and "layout" fires', () => {
  const fig = new CartesianFigure(element('div'), {
    width: 400,
    height: 200,
    margin: { top: 8 },
    x: { domain: [0, 3], axis: { ticks: [0, 3], format: (v) => `m${v}` } },
    y: { domain: [-2, 2], axis: { ticks: [-2, 0, 2], format: (v) => `${v}k` }, grid: true },
  });
  let seen = null;
  fig.on('layout', (marks) => (seen = marks));
  fig.setData(fan);
  runFrames();
  // the widest y label is '-2k' (18 px) → left = 18 + 10; bottom = 4 + 11 + 7; right = 'Median' (36) + 8 + 6
  assert.deepEqual(fig.plot, { x: 28, y: 8, w: 400 - 28 - 50, h: 200 - 8 - 22 });
  assert.deepEqual(seen.map((m) => m.id), ['you', 'last']);
  assert.strictEqual(fig.marks, seen);
  const you = fig.markById('you');
  assert.equal(you.kind, 'path');
  assert.deepEqual(you.datum, { n: 1 });
  assert.equal(you.runs[0].length, 4);
  assert.equal(you.runs[0][0].x, fig.plot.x);
  assert.equal(fig.markById('last').kind, 'circle');
  // the two end labels were 1.2 px apart: spread to 15
  const ys = calls(fig, 'fillText').filter((c) => c[1] === 'You' || c[1] === 'Median').map((c) => c[3]);
  assert.ok(Math.abs(ys[0] - ys[1]) >= 14.99);
  // axis labels are drawn, the end labels start just right of the plot
  assert.ok(calls(fig, 'fillText').some((c) => c[1] === '-2k'));
  assert.ok(calls(fig, 'fillText').some((c) => c[1] === 'm3'));
  assert.equal(calls(fig, 'fillText').find((c) => c[1] === 'You')[2], fig.plot.x + fig.plot.w + 8);
});

test('hit testing: markAt finds the line and the dot, and hover / click are emitted once a handler is added', () => {
  const fig = plot();
  const you = fig.markById('you');
  const p = you.runs[0][1];
  assert.equal(fig.markAt(p.x, p.y + 3).id, 'you');
  assert.equal(fig.markAt(p.x, p.y + 40), null);
  const last = fig.markById('last');
  assert.equal(fig.markAt(last.cx, last.cy).id, 'last', 'the dot is on top of the line');
  assert.deepEqual(fig.canvas.listeners, []);
  const hovers = [];
  const clicks = [];
  fig.on('hover', (e) => hovers.push(e.mark?.id ?? null));
  fig.on('click', (e) => clicks.push(e.mark?.id ?? null));
  assert.deepEqual(fig.canvas.listeners.sort(), ['click', 'pointerleave', 'pointermove']);
  fig.canvas.onpointermove({ clientX: p.x, clientY: p.y });
  fig.canvas.onpointermove({ clientX: p.x + 1, clientY: p.y });
  fig.canvas.onpointermove({ clientX: 5, clientY: 190 });
  fig.canvas.onclick({ clientX: p.x, clientY: p.y });
  assert.deepEqual(hovers, ['you', null]);
  assert.deepEqual(clicks, ['you']);
});

test('setActive and setSelected redraw only the look: a halo behind a line, a ring on a dot, the marks stay', () => {
  const fig = plot();
  const before = fig.marks;
  fig.canvas.log.length = 0;
  fig.setActive('you');
  assert.equal(env.frames.length, 1);
  runFrames();
  assert.ok(fig.canvas.log.some((c) => c[0] === 'set globalCompositeOperation' && c[1] === 'destination-over'), 'the halo goes behind the line');
  fig.canvas.log.length = 0;
  fig.setActive(null);
  fig.setSelected('last');
  runFrames();
  assert.equal(calls(fig, 'arc').length, 2, 'the dot and its ring');
  assert.equal(fig.active, null);
  assert.equal(fig.selected, 'last');
  assert.equal(fig.marks.length, before.length);
  fig.setActive('nope'); // an unknown id draws nothing and does not throw
  fig.renderNow();
});

test('an unknown mark type is an error, and null entries are skipped', () => {
  const fig = new CartesianFigure(element('div'), { width: 100, height: 50 });
  fig.setData([null, { type: 'dot', x: 1, y: 1 }]);
  fig.renderNow();
  assert.equal(calls(fig, 'arc').length, 1);
  fig.setData([{ type: 'nope' }]);
  assert.throws(() => fig.renderNow(), /Unknown mark type: nope/);
});

test('bars on band scales and cells on a band grid land inside their bands', () => {
  const fig = new CartesianFigure(element('div'), {
    width: 200,
    height: 100,
    x: { scale: 'band', domain: ['a', 'b'], padding: 0.5 },
    y: { domain: [0, 10] },
  });
  fig.setData([
    { type: 'bar', id: 'a', x: 'a', to: 10, color: 0 },
    { type: 'bar', id: 'b', x: 'b', from: 2, to: 6, color: 1, ratio: 1 },
    { type: 'bar', id: 'h', x: 'a', to: 5, orientation: 'h' },
  ]);
  fig.renderNow();
  assert.equal(fig.markById('a').x, 25, 'a band of 100 with half of it as the gap: the bar is 50 wide and starts 25 in');
  assert.equal(fig.markById('a').w, 50);
  assert.equal(fig.markById('a').h, 100);
  assert.equal(fig.markById('b').w, 50);
  fig.setData([{ type: 'bar', id: 'c', x: 'b', to: 5, ratio: 0.5 }]);
  fig.renderNow();
  assert.equal(fig.markById('c').w, 25, 'a ratio shrinks the bar inside its band');
  fig.setData([{ type: 'bar', id: 'b', x: 'b', from: 2, to: 6 }]);
  fig.renderNow();
  assert.equal(fig.markById('b').y, 40);
  assert.equal(fig.markById('b').h, 40);

  const grid = new CartesianFigure(element('div'), {
    width: 100,
    height: 100,
    x: { scale: 'band', domain: ['p', 'q'], padding: 0 },
    y: { scale: 'band', domain: ['r', 's'], padding: 0 },
  });
  grid.setData([{ type: 'cell', id: 'ps', x: 'p', y: 's', inset: 1 }, { type: 'cell', id: 'none', x: 'zzz', y: 's' }]);
  grid.renderNow();
  assert.deepEqual([grid.markById('ps').x, grid.markById('ps').y, grid.markById('ps').w], [1, 51, 48], 'the first y key is at the top');
  assert.equal(grid.markById('none'), null, 'a key that is not in the domain draws nothing');
});

test('figures are created by their registered id', () => {
  const s = createFigure(element('div'), 'sparkline', { width: 40, height: 20 });
  assert.ok(s instanceof SparklineFigure);
  assert.ok(createFigure(element('div'), 'cartesian', { width: 40, height: 20 }) instanceof CartesianFigure);
  assert.throws(() => createFigure(element('div'), 'nope', {}), /Unknown figure type: nope/);
});

test('toCanvas returns the figure on a canvas of its own without touching the marks', () => {
  const fig = plot();
  const marks = fig.marks;
  const out = fig.toCanvas();
  assert.deepEqual([out.width, out.height], [800, 400]);
  assert.strictEqual(fig.marks, marks);
  assert.ok(out.log.some((c) => c[0] === 'stroke'));
});

test('axis ticks may be a function of the axis length, and a tick can carry its own grid color', () => {
  const lengths = [];
  const fig = new CartesianFigure(element('div'), {
    width: 300,
    height: 100,
    x: { domain: [0, 10], axis: { ticks: (len) => (lengths.push(len), [0, 10]) } },
    y: { domain: [0, 4], axis: { ticks: [{ value: 0, gridColor: '#f00' }, 2] }, grid: true },
  });
  fig.setData([]);
  fig.renderNow();
  assert.deepEqual(lengths, [fig.plot.w]);
  assert.ok(fig.canvas.log.some((c) => c[0] === 'set strokeStyle' && c[1] === '#f00'));
});
