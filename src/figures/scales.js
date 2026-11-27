import { linearTicks, niceStep } from '../core/PriceScale.js';

/**
 * Scales for figures. Pure: no DOM.
 *
 * A scale maps a value to a pixel position:
 *   scale(v)    value → px (a band scale gives the start of the band)
 *   pos(v)      value → px of the point to draw at (a band scale gives the centre of the band)
 *   invert(px)  px → value
 *   ticks(n)    about n tick values inside the domain (a band scale gives every key)
 *
 * `range` is [px at domain[0], px at domain[1]]; `reverse` swaps its ends.
 */
const DAY = 86_400_000;
const MONTH_STEPS = [1, 2, 3, 6, 12, 24, 60];

function ends(range, reverse) {
  return reverse ? [range[1], range[0]] : [range[0], range[1]];
}

export function linearScale({ domain, range, reverse = false, type = 'linear' }) {
  const [d0, d1] = domain;
  const [r0, r1] = ends(range, reverse);
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const mid = (r0 + r1) / 2;
  const scale = (v) => (k === 0 ? mid : r0 + (v - d0) * k);
  return {
    type,
    domain: [d0, d1],
    range: [r0, r1],
    bandwidth: 0,
    scale,
    pos: scale,
    invert: (px) => (k === 0 ? d0 : d0 + (px - r0) / k),
    ticks: (count) => linearTicks(Math.min(d0, d1), Math.max(d0, d1), Math.max(1, count)),
  };
}

/**
 * A scale on time (UNIX milliseconds). Ticks fall on whole days or on the first day of a month (see `timeTicks`).
 * `utcOffset` (ms) shifts the calendar used for ticks, like the chart's own `utcOffset`.
 */
export function timeScale({ domain, range, reverse = false, utcOffset = 0 }) {
  const s = linearScale({ domain, range, reverse, type: 'time' });
  s.ticks = (count) => timeTicks(Math.min(domain[0], domain[1]), Math.max(domain[0], domain[1]), count, utcOffset);
  return s;
}

/**
 * Categories laid out in equal bands. `padding` is the gap between bands as a fraction of one step (0–1).
 * `domain` is the list of keys; the first key sits at the start of the range.
 */
export function bandScale({ domain, range, reverse = false, padding = 0.2 }) {
  const keys = [...domain];
  const index = new Map(keys.map((k, i) => [k, i]));
  const [r0, r1] = ends(range, reverse);
  const n = Math.max(1, keys.length);
  const step = (r1 - r0) / n;
  const gap = Math.min(0.95, Math.max(0, padding));
  const bandwidth = Math.abs(step) * (1 - gap);
  const sign = step < 0 ? -1 : 1;
  const start = (key) => {
    const i = index.get(key);
    if (i === undefined) return NaN;
    // the gap is split to both sides of a band
    const a = r0 + step * i + (sign * Math.abs(step) * gap) / 2;
    return sign < 0 ? a - bandwidth : a;
  };
  return {
    type: 'band',
    domain: keys,
    range: [r0, r1],
    bandwidth,
    step: Math.abs(step),
    scale: start,
    pos: (key) => start(key) + bandwidth / 2,
    invert: (px) => keys[Math.min(n - 1, Math.max(0, Math.floor((px - r0) / step)))],
    ticks: () => keys,
    has: (key) => index.has(key),
  };
}

/** Round [lo, hi] outwards to multiples of a nice step for about `count` ticks. */
export function niceDomain(lo, hi, count = 5) {
  if (!(hi > lo)) return [lo, hi];
  const step = niceStep(hi - lo, count);
  return [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step];
}

/**
 * Tick values on a calendar, as UNIX ms: the first day of every k-th month (k from 1, 2, 3, 6, 12, 24, 60; the smallest
 * that gives at most `count` ticks, aligned to multiples of k: Jan, Apr, Jul, Oct for 3); for a span shorter than two
 * months, `count` evenly spaced whole days (or evenly spaced times below two days). Independent of where data points
 * lie, so points crowded at one end never crowd the labels.
 */
export function timeTicks(lo, hi, count, utcOffset = 0) {
  if (!(hi > lo) || count < 1) return Number.isFinite(lo) ? [lo] : [];
  const span = hi - lo;
  if (span < 2 * DAY) {
    if (count === 1) return [lo];
    return Array.from({ length: count }, (_, i) => lo + (span * i) / (count - 1));
  }
  const day = (t) => Math.floor((t + utcOffset) / DAY);
  if (span < 62 * DAY) {
    if (count === 1) return [lo];
    // whole days inside [lo, hi]: the first one on or after lo, the last one on or before hi
    const a = Math.ceil((lo + utcOffset) / DAY);
    const b = day(hi);
    if (b < a) return [lo];
    const days = new Set(Array.from({ length: count }, (_, i) => Math.round(a + ((b - a) * i) / (count - 1))));
    return [...days].map((d) => d * DAY - utcOffset);
  }
  const first = new Date(lo + utcOffset);
  const monthIndex = first.getUTCFullYear() * 12 + first.getUTCMonth();
  for (const k of MONTH_STEPS) {
    const out = [];
    for (let idx = Math.ceil(monthIndex / k) * k; ; idx += k) {
      const t = Date.UTC(Math.floor(idx / 12), idx % 12, 1) - utcOffset;
      if (t > hi) break;
      if (t >= lo) out.push(t);
    }
    if (out.length > 0 && out.length <= count) return out;
  }
  return [lo, hi];
}

/** The extent of the values one axis is given: numbers as [lo, hi], anything else as keys in order of appearance. */
export function extentOf(values) {
  let lo = Infinity;
  let hi = -Infinity;
  const keys = [];
  const seen = new Set();
  for (const v of values) {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    } else if (v !== null && v !== undefined && !seen.has(v)) {
      seen.add(v);
      keys.push(v);
    }
  }
  return { lo, hi, keys };
}

/**
 * Build a scale from an axis spec and the values the marks place on that axis.
 * @param {{scale?:'linear'|'time'|'band', domain?:any[], reverse?:boolean, nice?:boolean|number, include?:number[], padding?:number, utcOffset?:number}} spec
 * @param {any[]} values every value the marks place on this axis (numbers, or keys for a band scale)
 * @param {[number, number]} range
 */
export function makeScale(spec = {}, values, range) {
  const type = spec.scale ?? 'linear';
  const reverse = !!spec.reverse;
  if (type === 'band') {
    const keys = spec.domain ?? extentOf(values).keys;
    return bandScale({ domain: keys, range, reverse, padding: spec.padding ?? 0.2 });
  }
  let domain = spec.domain;
  if (!domain) {
    const e = extentOf([...values, ...(spec.include ?? [])]);
    domain = e.lo <= e.hi ? [e.lo, e.hi] : [0, 1];
    if (domain[0] === domain[1]) {
      const pad = Math.abs(domain[0]) * 0.01 || 1;
      domain = [domain[0] - pad, domain[1] + pad];
    }
    if (spec.nice) domain = niceDomain(domain[0], domain[1], typeof spec.nice === 'number' ? spec.nice : 5);
  }
  return type === 'time'
    ? timeScale({ domain, range, reverse, utcOffset: spec.utcOffset ?? 0 })
    : linearScale({ domain, range, reverse });
}
