import { figureTypes } from '../core/Registry.js';
import { CartesianFigure } from './CartesianFigure.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** 'up' | 'down' | 'flat' from the change between the first and the last value. */
export function directionOf(delta) {
  return delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
}

/**
 * The marks and the y range of a sparkline. Pure.
 * Non-finite values are dropped (the rest are spread evenly), and fewer than two leave nothing to draw (`null`).
 *
 * @param {number[]} values
 * @param {object} [o]
 * @param {'start'|number|null} [o.baseline='start']  a dashed line at the first value, at a number, or none
 * @param {'direction'|'plain'} [o.tone='direction']  the end dot follows the direction of the change, or has the line's color
 * @param {{line?:any, baseline?:any, up?:any, down?:any, flat?:any}} [o.colors]  color specs (CSS colors, palette indices or roles)
 * @param {number} [o.lineWidth=1.5]
 * @param {number} [o.dotRadius=2.5]
 * @param {number[]} [o.baselineDash=[2, 3]]
 */
export function sparklineMarks(values, o = {}) {
  const vals = (values ?? []).filter(finite);
  if (vals.length < 2) return null;
  const baseline = o.baseline === undefined ? 'start' : o.baseline;
  const base = baseline === 'start' ? vals[0] : finite(baseline) ? baseline : null;
  const c = { line: 'series', baseline: 'axis', up: 'up', down: 'down', flat: 'muted', ...o.colors };
  const direction = directionOf(vals[vals.length - 1] - vals[0]);
  const points = vals.map((y, x) => ({ x, y }));
  const marks = [];
  if (base !== null) marks.push({ type: 'rule', y: base, from: 0, to: vals.length - 1, color: c.baseline, width: 1, dash: o.baselineDash ?? [2, 3] });
  marks.push({ type: 'line', points, color: c.line, width: o.lineWidth ?? 1.5 });
  marks.push({ type: 'dot', x: vals.length - 1, y: vals[vals.length - 1], r: o.dotRadius ?? 2.5, color: o.tone === 'plain' ? c.line : c[direction] });
  return { marks, direction, xDomain: [0, vals.length - 1], yInclude: base === null ? [] : [base] };
}

/**
 * A sparkline: a line on its own y scale (the range of its values, plus the baseline), an optional dashed baseline and an end
 * dot. `setData(values)`. Meant to be small and many: give it a fixed `width` and `height`, and it observes nothing.
 *
 * Options: `pad` (px around the line, default 3), `baseline`, `tone`, `colors`, `lineWidth`, `dotRadius`, `baselineDash` (see
 * `sparklineMarks`). `direction` after a layout is 'up' | 'down' | 'flat' (null when nothing was drawn).
 */
export class SparklineFigure extends CartesianFigure {
  static id = 'sparkline';
  static label = 'Sparkline';

  direction = null;

  constructor(container, options = {}) {
    super(container, { pad: 3, ...options });
  }

  paint(ctx) {
    const o = this.options;
    const s = sparklineMarks(this.data, o);
    this.direction = s?.direction ?? null;
    if (s) this.drawPlot(ctx, s.marks, { ...o, margin: o.pad, x: { domain: s.xDomain }, y: { include: s.yInclude } });
  }
}

figureTypes.register(SparklineFigure);
