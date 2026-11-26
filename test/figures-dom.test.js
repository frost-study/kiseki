import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { CartesianFigure } from '../src/figures/CartesianFigure.js';
import { SparklineFigure } from '../src/figures/sparkline.js';
import { DonutFigure } from '../src/figures/donut.js';
import { TreemapFigure } from '../src/figures/treemap.js';
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

/* ───────────── donut, treemap and the marks added for them ───────────── */

test('donut: one filled sector per positive value, exposed as arc marks that hit-test, a label in the middle', () => {
  const fig = new DonutFigure(element('div'), { width: 160, height: 160, label: { text: '42', size: 14 } });
  fig.setData([{ id: 'a', value: 3, color: 0 }, { id: 'zero', value: 0, color: 1 }, { id: 'b', value: 1, color: 2, datum: { n: 2 } }]);
  fig.renderNow();
  assert.deepEqual(fig.marks.map((m) => m.id), ['a', 'b']);
  assert.deepEqual(fig.ring, { cx: 80, cy: 80, r0: 80 * 0.68, r1: 80 });
  assert.equal(calls(fig, 'fill').length, 2);
  assert.equal(calls(fig, 'fillText')[0][1], '42');
  const a = fig.markById('a');
  assert.equal(a.kind, 'arc');
  assert.ok(a.a1 > a.a0);
  const mid = (a.a0 + a.a1) / 2;
  const r = (a.r0 + a.r1) / 2;
  assert.equal(fig.markAt(80 + r * Math.cos(mid), 80 + r * Math.sin(mid)).id, 'a');
  assert.equal(fig.markAt(80, 80), null, 'the hole');
  assert.deepEqual(fig.markById('b').datum, { n: 2 });
  // keyboard focus ring on a sector
  fig.setActive('a');
  fig.renderNow();
  assert.ok(calls(fig, 'arc').length > 8);
});

test('donut: a single slice is a whole ring without a gap', () => {
  const fig = new DonutFigure(element('div'), { width: 100, height: 100 });
  fig.setData([{ id: 'only', value: 5, color: 0 }]);
  fig.renderNow();
  const arcs = calls(fig, 'arc');
  assert.equal(arcs.length, 2);
  assert.deepEqual([arcs[0][3], arcs[1][3]], [50, 34]);
});

test('treemap: tiles are squarified with the gap, rounded to pixels, and each reports how many of its lines fit', () => {
  const fig = new TreemapFigure(element('div'), { width: 400, height: 220, gap: 2 });
  const rows = [30, 5, 12, 8, 20, 3, 22].map((value, i) => ({
    id: `t${i}`, value, fill: i, datum: { i },
    lines: [{ text: `Tile ${i}`, weight: 500, minW: 40, minH: 22 }, { text: '+1.0%', minW: 76, minH: 44 }],
  }));
  fig.setData(rows);
  let seen = null;
  fig.on('layout', (m) => (seen = m));
  runFrames();
  assert.equal(seen.length, 7);
  const big = fig.markById('t0');
  assert.deepEqual([big.x, big.y, big.w, big.h], [0, 0, 207, 126]);
  assert.deepEqual([big.shown, big.lines, big.full], [2, 2, true]);
  const small = fig.markById('t5'); // 34 x 72: wide enough for nothing
  assert.deepEqual([small.w, small.h, small.shown, small.full], [34, 72, 0, false]);
  const mid = fig.markById('t3'); // 95 x 72
  assert.equal(mid.full, true);
  // text is drawn for the tiles that fit, and only for them
  const texts = calls(fig, 'fillText').map((c) => c[1]);
  assert.ok(texts.includes('Tile 0') && texts.includes('+1.0%'));
  assert.ok(!texts.includes('Tile 5'));
  assert.equal(fig.markAt(10, 10).id, 't0');
  assert.deepEqual(fig.markById('t3').datum, { i: 3 });
});

test('treemap: a stripe and a border are painted inside the tile, a long title is cut with an ellipsis at the tile\'s edge', () => {
  const fig = new TreemapFigure(element('div'), { width: 100, height: 60 });
  fig.setData([{ id: 'x', value: 1, fill: 'surface', border: { color: 'border' }, stripe: { color: 1, width: 4 }, lines: [{ text: 'A very long title indeed', minW: 10, minH: 10 }] }]);
  fig.renderNow();
  assert.ok(calls(fig, 'clip').length === 1);
  const text = calls(fig, 'fillText')[0];
  assert.ok(text[1].endsWith('…') && text[1].length < 24);
  assert.equal(text[2], 4 + 6, 'the words start after the stripe and the padding');
  assert.ok(calls(fig, 'fillRect').some((c) => c[3] === 4), 'the stripe');
});

test('cartesian: a faded line is stroked per segment with rising opacity and dots at all but its last point', () => {
  const fig = new CartesianFigure(element('div'), { width: 100, height: 100, x: { domain: [0, 4] }, y: { domain: [0, 4] } });
  fig.setData([{ type: 'line', points: [[0, 0], [1, 1], [2, 1.5], [3, 3]], color: 'series', width: 2, fade: { from: 0.2, to: 0.8 }, vertices: { r: 2 } }]);
  fig.renderNow();
  assert.equal(calls(fig, 'stroke').length, 3);
  const alphas = fig.canvas.log.filter((c) => c[0] === 'set globalAlpha').map((c) => c[1]);
  const seg = alphas.filter((a) => a !== 1);
  assert.deepEqual(seg.slice(0, 3).map((a) => +a.toFixed(3)), [0.2, 0.5, 0.8]);
  assert.equal(calls(fig, 'arc').length, 3, 'a dot at each point but the last');
});

test('cartesian: a region prints its corner words, an arrow takes an exact head, a dot dashes its outline, a link is a path mark', () => {
  const fig = new CartesianFigure(element('div'), { width: 200, height: 100, x: { domain: [0, 10] }, y: { domain: [0, 10] } });
  fig.setData([
    { type: 'region', x0: 0, x1: 5, y0: 5, y1: 10, color: 'accent', opacity: 0.1, stroke: 'border', label: { corner: 'tl', lines: [{ text: 'Name', size: 12 }, { text: 'gloss', size: 12 }] } },
    { type: 'region', x0: 5, x1: 10, y0: 0, y1: 5, color: null, label: { corner: 'br', dy: 10, lines: [{ text: 'Low' }, { text: 'gloss' }] } },
    { type: 'arrow', from: { x: 1, y: 1 }, to: { x: 5, y: 1 }, stem: false, headLength: 6, headWidth: 5 },
    { type: 'dot', x: 2, y: 2, r: 5, color: null, stroke: 'text', strokeWidth: 1.25, strokeDash: [2.5, 2] },
    { type: 'link', id: 'l', from: { x: 0, y: 1 }, to: { x: 10, y: 9 }, width: 6, opacity: 0.5 },
  ]);
  fig.renderNow();
  const words = calls(fig, 'fillText');
  assert.deepEqual(words.slice(0, 2).map((c) => [c[1], c[2], c[3]]), [['Name', 10, 18], ['gloss', 10, 32]]);
  assert.deepEqual(words.slice(2).map((c) => [c[1], c[2], c[3]]), [['Low', 200 - 10, 100 - 10 - 14], ['gloss', 200 - 10, 100 - 10]]);
  assert.equal(calls(fig, 'bezierCurveTo').length, 1);
  assert.ok(fig.canvas.log.some((c) => c[0] === 'setLineDash' && c[1].join() === '2.5,2'));
  const l = fig.markById('l');
  assert.equal(l.kind, 'path');
  assert.equal(fig.markAt(100, 50)?.id, 'l', 'the middle of the ribbon');
  // head: tip at x = 100 (value 5), base 6 px back, 5 px wide
  const lines = calls(fig, 'lineTo');
  const head = lines.slice(-2);
  assert.deepEqual(head.map((c) => [c[1], Math.abs(c[2] - 90)]), [[94, 2.5], [94, 2.5]]);
});

test('an inset emphasis rings a box inside its edge', () => {
  const fig = new TreemapFigure(element('div'), { width: 100, height: 50, emphasis: { active: { width: 2, inset: true } } });
  fig.setData([{ id: 'x', value: 1, fill: 0 }]);
  fig.setActive('x');
  fig.renderNow();
  assert.deepEqual(calls(fig, 'strokeRect').at(-1).slice(1), [1, 1, 98, 48]);
});

test('cartesian: a text mark can be rotated about its anchor', () => {
  const fig = new CartesianFigure(element('div'), { width: 100, height: 100, x: { domain: [0, 10] }, y: { domain: [0, 10] } });
  fig.setData([{ type: 'text', x: 0, y: 5, dx: -30, text: 'Momentum', anchor: 'middle', rotate: -90 }]);
  fig.renderNow();
  assert.deepEqual(calls(fig, 'translate')[0].slice(1), [-30, 50]);
  assert.ok(Math.abs(calls(fig, 'rotate')[0][1] + Math.PI / 2) < 1e-9);
  assert.deepEqual(calls(fig, 'fillText')[0].slice(1), ['Momentum', 0, 0]);
});

test('cartesian: text anchored in the middle is centred on its x', () => {
  const fig = new CartesianFigure(element('div'), { width: 100, height: 100, x: { domain: [0, 10] }, y: { domain: [0, 10] } });
  fig.setData([{ type: 'text', id: 't', x: 5, y: 5, text: 'abcd', anchor: 'middle' }]);
  fig.renderNow();
  assert.equal(fig.canvas.log.filter((c) => c[0] === 'set textAlign').at(-1)[1], 'center');
  const t = fig.markById('t');
  assert.equal(t.x + t.w / 2, 50);
});

test('a hatched bar clips to its box, fills the stripes of the pattern and can outline itself inside its edge', () => {
  const fig = new CartesianFigure(element('div'), { width: 100, height: 50, x: { scale: 'band', domain: ['a'], padding: 0 }, y: { domain: [0, 10] } });
  fig.setData([{ type: 'bar', id: 'e', x: 'a', to: 10, color: null, pattern: { color: 3, angle: 135, width: 2, period: 10 }, stroke: 'up', strokeInside: true, radius: [2, 2, 0, 0] }]);
  fig.renderNow();
  assert.equal(calls(fig, 'clip').length, 1, 'the stripes stay inside the bar');
  assert.equal(calls(fig, 'fill').length, 0, 'color: null leaves the base unfilled');
  // along a 135 degree gradient a 100 x 50 box is about 106 px long (|100 sin| + |50 cos|), a stripe every 10 px
  assert.equal(calls(fig, 'moveTo').length, Math.ceil((100 * Math.SQRT1_2 + 50 * Math.SQRT1_2) / 10));
  const rect = calls(fig, 'roundRect').pop();
  assert.deepEqual(rect.slice(1), [0.5, 0.5, 99, 49, [1.5, 1.5, 0, 0]], 'the outline is a stroke-width smaller on every side, corners included');
  assert.equal(fig.markById('e').w, 100, 'the bar keeps its size');
});

test('hatch stripes run at the angle asked for', async () => {
  const { hatch, shrinkRadius } = await import('../src/figures/marks.js');
  const log = [];
  hatch(makeContext(log), { x: 0, y: 0, w: 10, h: 10 }, 'red', { angle: 90, width: 1, period: 4 });
  const from = log.filter((c) => c[0] === 'moveTo');
  const to = log.filter((c) => c[0] === 'lineTo');
  assert.ok(from.length >= 3);
  from.forEach((a, i) => assert.equal(a[1].toFixed(6), to[i][1].toFixed(6), 'a gradient to the right makes vertical stripes'));
  assert.equal(shrinkRadius(2, 0.5), 1.5);
  assert.deepEqual(shrinkRadius([2, 0.2], 0.5), [1.5, 0]);
});

test('a cell can be outlined (dashed), shaded, and print a label that is cut with an ellipsis when it does not fit', () => {
  const fig = new CartesianFigure(element('div'), {
    width: 60, height: 20, x: { scale: 'band', domain: ['a', 'b'], padding: 0 }, y: { scale: 'band', domain: ['r'], padding: 0 },
  });
  fig.setData([
    { type: 'cell', id: 'short', x: 'a', y: 'r', color: 2, label: { text: 'ok', ellipsis: true } },
    { type: 'cell', id: 'long', x: 'b', y: 'r', color: null, stroke: 'axis', strokeDash: [2, 2], shade: 0.05, label: { text: 'a very long word', ellipsis: true, align: 'start', pad: 3 } },
  ]);
  fig.renderNow();
  assert.equal(fig.markById('short').cut, false);
  assert.equal(fig.markById('long').cut, true);
  const words = calls(fig, 'fillText').map((c) => c[1]);
  assert.equal(words[0], 'ok');
  // 6 px per letter in the fake context: a 28 px cell less 2 x 3 px of padding leaves 22 px, which holds two letters and the ellipsis
  assert.equal(words[1], 'a …');
  assert.ok(calls(fig, 'setLineDash').some((c) => JSON.stringify(c[1]) === '[2,2]'), 'dashed outline');
  assert.ok(fig.canvas.log.some((c) => c[0] === 'set textAlign' && c[1] === 'left'), 'start-aligned label');
  fig.setData([{ type: 'cell', id: 'tiny', x: 'a', y: 'r', label: { text: 'wide', ellipsis: true, pad: 14 } }]);
  fig.renderNow();
  assert.equal(calls(fig, 'fillText').length, 2, 'a cell too small for a letter prints nothing new');
});
