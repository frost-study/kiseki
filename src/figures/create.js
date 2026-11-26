import { figureTypes } from '../core/Registry.js';

/**
 * Create a figure by its registered id: `createFigure(el, 'sparkline', { width: 80, height: 24 })`.
 * `'cartesian'` is the plot hosts compose from marks; presets such as `'sparkline'` turn their own data into marks.
 */
export function createFigure(container, type, options) {
  const Figure = figureTypes.get(type);
  return new Figure(container, options);
}
