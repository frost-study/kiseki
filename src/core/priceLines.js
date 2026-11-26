/**
 * Pure helpers behind chart.addPriceLine(): which lines the price scale follows, and where title boxes go.
 */

/**
 * The values the price scale has to include for these lines, merged into `range` ({min, max} or null).
 * `autoscale: true` always counts; `'near'` counts only while the line lies within one height of `own` (the main series'
 * range over the visible bars) beyond it, so a target just above the highs is shown and one far away is not.
 * @param {{price:number, autoscale?:boolean|'near'}[]} lines
 * @param {{min:number, max:number}|null} own
 * @param {{min:number, max:number}|null} range
 */
export function priceLineRange(lines, own, range = null) {
  let reach = null;
  for (const line of lines) {
    if (!line.autoscale || !Number.isFinite(line.price)) continue;
    if (line.autoscale === 'near') {
      if (!own) continue;
      if (!reach) {
        const span = own.max - own.min;
        const pad = span > 0 ? span : Math.abs(own.max) * 0.1 || 1;
        reach = { min: own.min - pad, max: own.max + pad };
      }
      if (line.price < reach.min || line.price > reach.max) continue;
    }
    range ??= { min: line.price, max: line.price };
    range.min = Math.min(range.min, line.price);
    range.max = Math.max(range.max, line.price);
  }
  return range;
}

/**
 * Pushes boxes apart so none overlap: sorted by `y`, at least `gap` between neighbours, kept inside [top, bottom].
 * Changes `y` in place and returns the boxes in ascending order.
 */
export function spreadBoxes(boxes, gap, top, bottom) {
  const sorted = [...boxes].sort((p, q) => p.y - q.y);
  for (let i = 0; i < sorted.length; i++) sorted[i].y = Math.max(sorted[i].y, i === 0 ? top : sorted[i - 1].y + gap);
  for (let i = sorted.length - 1; i >= 0; i--) sorted[i].y = Math.min(sorted[i].y, i === sorted.length - 1 ? bottom : sorted[i + 1].y - gap);
  return sorted;
}
