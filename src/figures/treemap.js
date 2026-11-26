import { figureTypes } from '../core/Registry.js';
import { Figure } from './Figure.js';
import { PHI, ellipsize, fitLines, squarify } from './layout.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// the pure helpers live in layout.js (a host that only lays tiles out needs no figure); they stay importable from here
export { PHI, ellipsize, fitLines, squarify };

/**
 * A treemap: one tile per datum, squarified (see `squarify`), on one canvas.
 *
 * `setData([{ id, value, fill, border, stripe, shade, opacity, lines, datum }])`
 *   fill     the tile's color spec (a CSS color, a palette index or a role)
 *   border   { color, width = 1 }       stripe   { color, width = 4 }: a bar down the left edge, over the border
 *   shade    0–1: a black veil over the tile (a pointer resting on it)
 *   lines    [{ text, size = 12, weight, color = 'text', minW, minH }] the words in the tile, top left, one line each, cut with an
 *            ellipsis at the tile's edge; a line is only printed when the tile is at least `minW` × `minH` px, and then so are the
 *            ones before it (see `fitLines`)
 * Every tile is exposed in `marks` as `{ id, kind: 'rect', x, y, w, h, datum, shown, lines, full }`: `shown` is the number of
 * text lines printed and `full` says all of them were, so a host knows which tiles need their words somewhere else.
 *
 * Options (besides those of every figure): `gap` between tiles (default 0), `round` edges to whole pixels (default true),
 * `ratio` aimed-for aspect (default the golden ratio), `padding` between a tile's edge and its words (default 6), `lineHeight`
 * (default 16), `radius` corner radius (default 2).
 */
export class TreemapFigure extends Figure {
  static id = 'treemap';
  static label = 'Treemap';

  paint(ctx) {
    const o = this.options;
    const rows = (Array.isArray(this.data) ? this.data : []).filter(Boolean);
    const tiles = squarify(rows, { width: this.width, height: this.height, gap: o.gap ?? 0, round: o.round ?? true, ratio: o.ratio ?? PHI });
    const pad = o.padding ?? 6;
    const lineHeight = o.lineHeight ?? 16;
    const radius = o.radius ?? 2;
    for (const t of tiles) {
      const row = rows[t.index];
      const x = t.x0;
      const y = t.y0;
      const w = t.x1 - t.x0;
      const h = t.y1 - t.y0;
      if (w <= 0 || h <= 0) continue;
      ctx.save();
      ctx.globalAlpha = row.opacity ?? 1;
      ctx.beginPath();
      if (radius && ctx.roundRect) ctx.roundRect(x, y, w, h, radius);
      else ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.fillStyle = this.color(row.fill ?? 'surface');
      ctx.fillRect(x, y, w, h);
      const bw = row.border ? row.border.width ?? 1 : 0;
      if (row.border) {
        ctx.strokeStyle = this.color(row.border.color ?? 'border');
        ctx.lineWidth = bw * 2; // clipped to the tile: the inner half is the border
        ctx.strokeRect(x, y, w, h);
      }
      const sw = row.stripe ? row.stripe.width ?? 4 : 0;
      if (row.stripe) {
        ctx.fillStyle = this.color(row.stripe.color ?? 0);
        ctx.fillRect(x, y, sw, h);
      }
      if (row.shade) {
        ctx.globalAlpha = row.shade;
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = row.opacity ?? 1;
      }
      const lines = row.lines ?? [];
      const shown = fitLines(lines, w, h);
      const left = x + Math.max(sw, bw) + pad;
      const room = w - Math.max(sw, bw) - bw - 2 * pad;
      ctx.textAlign = 'left';
      for (let i = 0; i < shown; i++) {
        const l = lines[i];
        const size = l.size ?? 12;
        ctx.font = this.font(size, l.weight);
        ctx.fillStyle = this.color(l.color ?? 'text');
        const text = ellipsize((s) => ctx.measureText(s).width, l.text, room);
        if (text) ctx.fillText(text, left, y + bw + pad + i * lineHeight + lineHeight / 2 + size * 0.32);
      }
      if (shown) this.watchFonts();
      ctx.restore();
      if (row.id !== undefined && row.id !== null) {
        this.expose({ id: row.id, datum: row.datum, type: 'tile', kind: 'rect', x, y, w, h, shown, lines: lines.length, full: shown === lines.length });
      }
    }
  }
}

figureTypes.register(TreemapFigure);
