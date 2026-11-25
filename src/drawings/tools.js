import { drawingTools } from '../core/Registry.js';
import { formatDuration, formatPercent, formatSigned } from '../core/format.js';
import { t } from '../core/i18n.js';
import { contrastText, withAlpha } from '../core/theme.js';

/**
 * Drawing tool definitions.
 *
 * {
 *   id, label, icon,          // icon is a 24×24 SVG path (the d attribute)
 *   points: 2,                // number of points to place
 *   draw(ctx, p, env),        // p: points in screen coordinates [{x, y}]
 *   hit(p, x, y, env),        // whether (x, y) is on this shape
 * }
 *
 * env: { theme, color, width, height, anchors: [{t, p}], indices: number[],
 *        selected, formatPrice(v), precision }
 * strokeStyle / fillStyle / lineWidth / font are already set when draw is called.
 */

export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const NEAR = 6;

/** A point extended off-screen in the direction p0 → p1. */
function extend(p0, p1, env) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const k = ((env.width + env.height) * 2) / len;
  return { x: p1.x + dx * k, y: p1.y + dy * k };
}

function segment(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function tag(ctx, text, x, y, env, align = 'left') {
  const w = ctx.measureText(text).width + 8;
  const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = env.color;
  ctx.beginPath();
  ctx.roundRect(left, y - 8, w, 16, 2);
  ctx.fill();
  ctx.fillStyle = contrastText(env.color);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + 4, y + 0.5);
}

drawingTools.register({
  id: 'trend',
  label: 'Trend line',
  icon: 'M5 18L19 6M5 18m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M19 6m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0',
  points: 2,
  draw(ctx, p) {
    segment(ctx, p[0], p[1]);
  },
  hit: (p, x, y) => distToSegment(x, y, p[0].x, p[0].y, p[1].x, p[1].y) < NEAR,
});

drawingTools.register({
  id: 'ray',
  label: 'Ray',
  icon: 'M4 18L21 5M4 18m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M12 12m-1.4 0a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0',
  points: 2,
  draw(ctx, p, env) {
    segment(ctx, p[0], extend(p[0], p[1], env));
  },
  hit(p, x, y, env) {
    const e = extend(p[0], p[1], env);
    return distToSegment(x, y, p[0].x, p[0].y, e.x, e.y) < NEAR;
  },
});

drawingTools.register({
  id: 'xline',
  label: 'Extended line',
  icon: 'M3 20L21 4M9 14.7m-1.4 0a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0M15 9.3m-1.4 0a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0',
  points: 2,
  draw(ctx, p, env) {
    segment(ctx, extend(p[1], p[0], env), extend(p[0], p[1], env));
  },
  hit(p, x, y, env) {
    const a = extend(p[1], p[0], env);
    const b = extend(p[0], p[1], env);
    return distToSegment(x, y, a.x, a.y, b.x, b.y) < NEAR;
  },
});

drawingTools.register({
  id: 'hline',
  label: 'Horizontal line',
  icon: 'M3 12h18M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0',
  points: 1,
  draw(ctx, p, env) {
    const y = Math.round(p[0].y) + 0.5;
    segment(ctx, { x: 0, y }, { x: env.width, y });
    tag(ctx, env.formatPrice(env.anchors[0].p), env.width - 4, y, env, 'right');
  },
  hit: (p, _x, y) => Math.abs(y - p[0].y) < NEAR,
});

drawingTools.register({
  id: 'vline',
  label: 'Vertical line',
  icon: 'M12 3v18M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0',
  points: 1,
  draw(ctx, p, env) {
    const x = Math.round(p[0].x) + 0.5;
    segment(ctx, { x, y: 0 }, { x, y: env.height });
  },
  hit: (p, x) => Math.abs(x - p[0].x) < NEAR,
});

drawingTools.register({
  id: 'rect',
  label: 'Rectangle',
  icon: 'M5 7h14v10H5z',
  points: 2,
  draw(ctx, p, env) {
    const x = Math.min(p[0].x, p[1].x);
    const y = Math.min(p[0].y, p[1].y);
    const w = Math.abs(p[1].x - p[0].x);
    const h = Math.abs(p[1].y - p[0].y);
    ctx.fillStyle = withAlpha(env.color, 0.1);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  },
  hit(p, x, y) {
    const x1 = Math.min(p[0].x, p[1].x) - NEAR;
    const x2 = Math.max(p[0].x, p[1].x) + NEAR;
    const y1 = Math.min(p[0].y, p[1].y) - NEAR;
    const y2 = Math.max(p[0].y, p[1].y) + NEAR;
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  },
});

drawingTools.register({
  id: 'channel',
  label: 'Parallel channel',
  icon: 'M4 15L18 5M6 20L20 10',
  points: 3,
  draw(ctx, p, env) {
    const [a, b, c] = p;
    // the third point only contributes its vertical distance from the base line
    const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x);
    const off = c.y - (a.y + slope * (c.x - a.x));
    const a2 = { x: a.x, y: a.y + off };
    const b2 = { x: b.x, y: b.y + off };
    ctx.fillStyle = withAlpha(env.color, 0.08);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.lineTo(a2.x, a2.y);
    ctx.closePath();
    ctx.fill();
    segment(ctx, a, b);
    segment(ctx, a2, b2);
    ctx.setLineDash([4, 4]);
    segment(ctx, { x: a.x, y: a.y + off / 2 }, { x: b.x, y: b.y + off / 2 });
    ctx.setLineDash([]);
  },
  hit(p, x, y) {
    const [a, b, c] = p;
    const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x);
    const off = c.y - (a.y + slope * (c.x - a.x));
    return (
      distToSegment(x, y, a.x, a.y, b.x, b.y) < NEAR ||
      distToSegment(x, y, a.x, a.y + off, b.x, b.y + off) < NEAR
    );
  },
});

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

drawingTools.register({
  id: 'fib',
  label: 'Fibonacci retracement',
  icon: 'M4 5h16M4 9.5h16M4 14h16M4 19h16',
  points: 2,
  draw(ctx, p, env) {
    const x1 = Math.min(p[0].x, p[1].x);
    const x2 = Math.max(p[0].x, p[1].x);
    const [v0, v1] = [env.anchors[0].p, env.anchors[1].p];
    let prevY = null;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    FIB_LEVELS.forEach((lv, k) => {
      const y = Math.round(p[1].y + (p[0].y - p[1].y) * lv) + 0.5;
      if (prevY !== null) {
        ctx.fillStyle = withAlpha(env.color, k % 2 ? 0.1 : 0.04);
        ctx.fillRect(x1, Math.min(prevY, y), x2 - x1, Math.abs(y - prevY));
      }
      segment(ctx, { x: x1, y }, { x: x2, y });
      ctx.fillStyle = env.theme.textMuted;
      ctx.fillText(`${lv}  ${env.formatPrice(v1 + (v0 - v1) * lv)}`, x1 + 4, y - 2);
      prevY = y;
    });
    ctx.setLineDash([3, 4]);
    segment(ctx, p[0], p[1]);
    ctx.setLineDash([]);
  },
  hit(p, x, y) {
    const x1 = Math.min(p[0].x, p[1].x) - NEAR;
    const x2 = Math.max(p[0].x, p[1].x) + NEAR;
    const y1 = Math.min(p[0].y, p[1].y) - NEAR;
    const y2 = Math.max(p[0].y, p[1].y) + NEAR;
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  },
});

drawingTools.register({
  id: 'measure',
  label: 'Measure (price & time)',
  icon: 'M4 17L17 4l3 3L7 20zM8 13l1.5 1.5M11 10l1.5 1.5M14 7l1.5 1.5',
  points: 2,
  draw(ctx, p, env) {
    const [a, b] = env.anchors;
    const up = b.p >= a.p;
    const color = up ? env.theme.up : env.theme.down;
    const x = Math.min(p[0].x, p[1].x);
    const y = Math.min(p[0].y, p[1].y);
    const w = Math.abs(p[1].x - p[0].x);
    const h = Math.abs(p[1].y - p[0].y);
    ctx.fillStyle = withAlpha(color, 0.12);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    // arrows for the vertical (price) and horizontal (time) extent
    const cx = x + w / 2;
    const cy = y + h / 2;
    segment(ctx, { x: cx, y: p[0].y }, { x: cx, y: p[1].y });
    segment(ctx, { x: p[0].x, y: cy }, { x: p[1].x, y: cy });
    const dirY = p[1].y < p[0].y ? 1 : -1;
    const dirX = p[1].x > p[0].x ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(cx - 4, p[1].y + 6 * dirY);
    ctx.lineTo(cx, p[1].y);
    ctx.lineTo(cx + 4, p[1].y + 6 * dirY);
    ctx.moveTo(p[1].x + 6 * dirX, cy - 4);
    ctx.lineTo(p[1].x, cy);
    ctx.lineTo(p[1].x + 6 * dirX, cy + 4);
    ctx.stroke();

    const diff = b.p - a.p;
    const bars = Math.round(env.indices[1] - env.indices[0]);
    const lines = [
      `${formatSigned(diff, env.precision)}  (${formatPercent(a.p ? (diff / a.p) * 100 : 0)})`,
      `${t('{n} bars', { n: Math.abs(bars) })} · ${formatDuration(b.t - a.t)}`,
    ];
    const tw = Math.max(...lines.map((s) => ctx.measureText(s).width)) + 16;
    const th = 38;
    const bx = Math.max(2, Math.min(env.width - tw - 2, cx - tw / 2));
    const by = up ? Math.max(2, y - th - 6) : Math.min(env.height - th - 2, y + h + 6);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(bx, by, tw, th, 2);
    ctx.fill();
    ctx.fillStyle = contrastText(color);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lines[0], bx + tw / 2, by + 12);
    ctx.fillText(lines[1], bx + tw / 2, by + 27);
  },
  hit(p, x, y) {
    const x1 = Math.min(p[0].x, p[1].x) - NEAR;
    const x2 = Math.max(p[0].x, p[1].x) + NEAR;
    const y1 = Math.min(p[0].y, p[1].y) - NEAR;
    const y2 = Math.max(p[0].y, p[1].y) + NEAR;
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  },
});
