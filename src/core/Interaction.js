/**
 * Pointer, wheel and keyboard interaction.
 *
 *   Drag the plot            pan (also vertically when the price scale is manual); keeps gliding on release
 *   Wheel / pinch            zoom around the cursor; horizontal scroll pans
 *   Drag the price axis      rescale prices; double-click returns to auto
 *   Drag the time axis       rescale time; double-click resets the view
 *   Drag a pane border       resize panes
 *   ← → / ↑ ↓ / Home / End   pan / zoom / oldest / latest
 *   Esc / Delete             cancel drawing / remove the selected drawing
 */
export class Interaction {
  constructor(chart) {
    this.chart = chart;
    this.#pointers = new Map();
    this.#mode = null;
    const root = chart.root;
    const on = (type, fn, opts) => {
      root.addEventListener(type, fn, opts);
      this.#off.push(() => root.removeEventListener(type, fn, opts));
    };
    on('pointerdown', (e) => this.#down(e));
    on('pointermove', (e) => this.#move(e));
    on('pointerup', (e) => this.#up(e));
    on('pointercancel', (e) => this.#up(e));
    on('pointerleave', () => {
      if (!this.#mode) this.chart.clearCrosshair();
    });
    on('wheel', (e) => this.#wheel(e), { passive: false });
    on('dblclick', (e) => this.#dblclick(e));
    on('keydown', (e) => this.#key(e));
    on('contextmenu', (e) => chart.options.interactive !== false && e.preventDefault());
  }

  #off = [];
  #pointers;
  #mode;
  #state = {};
  #kinetic = 0;

  destroy() {
    for (const off of this.#off) off();
    cancelAnimationFrame(this.#kinetic);
  }

  #pos(e) {
    const r = this.chart.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Which region a coordinate falls in. */
  #zone(x, y) {
    const chart = this.chart;
    const plotW = chart.plotWidth;
    if (y >= chart.height - chart.timeAxisHeight) return { zone: x < plotW ? 'time' : 'corner' };
    const panes = chart.panes;
    for (let i = 1; i < panes.length; i++) {
      if (Math.abs(y - panes[i].rect.y) <= 3) return { zone: 'sep', index: i };
    }
    const pane = panes.find((p) => y >= p.rect.y && y <= p.rect.y + p.rect.h) ?? panes[panes.length - 1];
    return { zone: x >= plotW ? 'axis' : 'plot', pane };
  }

  #cursor(z) {
    const d = this.chart.drawings;
    let c = 'crosshair';
    if (z.zone === 'axis') c = 'ns-resize';
    else if (z.zone === 'time') c = 'ew-resize';
    else if (z.zone === 'sep') c = 'row-resize';
    else if (z.zone === 'corner') c = 'default';
    else if (!d.tool && d.hover) c = 'pointer';
    this.chart.root.style.cursor = c;
  }

  #down(e) {
    if (e.target.closest('.kc-row, .kc-live')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const chart = this.chart;
    if (chart.options.interactive === false) {
      // Non-interactive view: just read the value at the pressed position (dragging is left to the page).
      const p = this.#pos(e);
      const z = this.#zone(p.x, p.y);
      if (z.zone === 'plot') chart.setCrosshair(p.x, p.y, z.pane);
      return;
    }
    chart.releaseFit();
    const { x, y } = this.#pos(e);
    chart.root.focus({ preventScroll: true });
    chart.stopAnimation();
    cancelAnimationFrame(this.#kinetic);
    this.#pointers.set(e.pointerId, { x, y });
    chart.root.setPointerCapture(e.pointerId);

    if (this.#pointers.size === 2) {
      const [p, q] = [...this.#pointers.values()];
      this.#mode = 'pinch';
      this.#state = { dist: Math.hypot(p.x - q.x, p.y - q.y), mid: (p.x + q.x) / 2 };
      chart.clearCrosshair();
      return;
    }

    const z = this.#zone(x, y);
    const main = chart.panes[0];
    if (z.zone === 'plot') {
      if (z.pane === main && chart.drawings.down(x, y - main.rect.y)) {
        this.#mode = 'draw';
      } else {
        if (z.pane !== main) chart.drawings.select(null);
        this.#mode = 'pan';
        this.#state = { pane: z.pane, x, y, sx: x, sy: y, touch: e.pointerType !== 'mouse', samples: [{ t: e.timeStamp, x }] };
        if (e.pointerType === 'mouse') chart.root.style.cursor = 'grabbing';
      }
    } else if (z.zone === 'axis') {
      this.#mode = 'axis';
      this.#state = { pane: z.pane, y };
    } else if (z.zone === 'time') {
      this.#mode = 'time';
      this.#state = { x };
    } else if (z.zone === 'sep') {
      this.#mode = 'sep';
      this.#state = { index: z.index, y };
    }
  }

  #move(e) {
    const chart = this.chart;
    const { x, y } = this.#pos(e);
    const ts = chart.timeScale;
    const main = chart.panes[0];
    const s = this.#state;
    if (this.#pointers.has(e.pointerId)) this.#pointers.set(e.pointerId, { x, y });

    switch (this.#mode) {
      case 'pinch': {
        if (this.#pointers.size < 2) return;
        const [p, q] = [...this.#pointers.values()];
        const dist = Math.hypot(p.x - q.x, p.y - q.y);
        const mid = (p.x + q.x) / 2;
        if (s.dist > 0 && dist > 0) ts.zoomAt(mid, dist / s.dist);
        ts.scrollPx(mid - s.mid);
        s.dist = dist;
        s.mid = mid;
        chart.invalidate();
        return;
      }
      case 'pan': {
        ts.scrollPx(x - s.x);
        if (!s.pane.scale.auto) s.pane.scale.pan(y - s.y);
        s.x = x;
        s.y = y;
        s.samples.push({ t: e.timeStamp, x });
        if (s.samples.length > 6) s.samples.shift();
        if (s.touch) chart.clearCrosshair();
        else chart.setCrosshair(x, y, s.pane);
        chart.invalidate();
        return;
      }
      case 'draw':
        chart.drawings.move(x, y - main.rect.y);
        chart.setCrosshair(x, y, main);
        return;
      case 'axis':
        s.pane.scale.zoom(Math.exp((y - s.y) * 0.006));
        s.y = y;
        chart.invalidate();
        return;
      case 'time':
        ts.zoomAt(chart.plotWidth, Math.exp((s.x - x) * 0.006));
        s.x = x;
        chart.invalidate();
        return;
      case 'sep':
        chart.resizePanes(s.index, y - s.y);
        s.y = y;
        return;
      default: {
        if (e.target.closest('.kc-actions, .kc-live')) return;
        const z = this.#zone(x, y);
        if (z.zone === 'plot') {
          if (z.pane === main || chart.drawings.busy) chart.drawings.move(x, y - main.rect.y);
          chart.setCrosshair(x, y, z.pane);
        } else {
          chart.clearCrosshair();
        }
        this.#cursor(z);
      }
    }
  }

  #up(e) {
    if (!this.#pointers.has(e.pointerId)) return;
    const chart = this.chart;
    const { x, y } = this.#pos(e);
    this.#pointers.delete(e.pointerId);
    const mode = this.#mode;
    const s = this.#state;
    if (mode === 'pinch') {
      // When one finger remains, carry on as a pan.
      const rest = [...this.#pointers.values()][0];
      if (rest) {
        this.#mode = 'pan';
        this.#state = { pane: chart.panes[0], x: rest.x, y: rest.y, sx: rest.x, sy: rest.y, touch: true, samples: [] };
      } else {
        this.#mode = null;
      }
      return;
    }
    this.#mode = null;
    if (mode === 'draw') {
      chart.drawings.up(x, y - chart.panes[0].rect.y);
    } else if (mode === 'pan') {
      const moved = Math.hypot(x - s.sx, y - s.sy);
      if (s.touch && moved < 6) chart.setCrosshair(x, y, s.pane);
      else this.#fling(s.samples, e.timeStamp);
    }
    this.#cursor(this.#zone(x, y));
  }

  /** Glide at the release velocity and stop by friction. */
  #fling(samples, now) {
    const first = samples.find((p) => now - p.t < 90);
    const last = samples[samples.length - 1];
    if (!first || !last || last.t === first.t) return;
    let v = (last.x - first.x) / (last.t - first.t);
    if (Math.abs(v) < 0.25) return;
    const chart = this.chart;
    let prev = performance.now();
    const step = (t) => {
      const dt = Math.min(40, t - prev);
      prev = t;
      chart.timeScale.scrollPx(v * dt);
      v *= 0.94 ** (dt / 16);
      chart.invalidate();
      if (Math.abs(v) > 0.03) this.#kinetic = requestAnimationFrame(step);
    };
    this.#kinetic = requestAnimationFrame(step);
  }

  #wheel(e) {
    const chart = this.chart;
    if (chart.options.interactive === false) return; // do not block page scrolling
    e.preventDefault();
    chart.releaseFit();
    const { x, y } = this.#pos(e);
    chart.stopAnimation();
    cancelAnimationFrame(this.#kinetic);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const z = this.#zone(x, y);
    if (z.zone === 'axis') {
      z.pane.scale.zoom(Math.exp(dy * 0.002));
    } else if (Math.abs(dx) > Math.abs(dy) && !e.ctrlKey) {
      chart.timeScale.scrollPx(-dx);
    } else {
      // ctrlKey marks a trackpad pinch. Its deltas are small, so raise the sensitivity.
      const k = e.ctrlKey ? 0.012 : 0.0022;
      chart.timeScale.zoomAt(Math.min(x, chart.plotWidth), Math.exp(-dy * k));
    }
    if (z.zone === 'plot') chart.setCrosshair(x, y, z.pane);
    chart.invalidate();
  }

  #dblclick(e) {
    if (e.target.closest('.kc-row, .kc-live')) return;
    const chart = this.chart;
    if (chart.options.interactive === false) return;
    const { x, y } = this.#pos(e);
    const z = this.#zone(x, y);
    if (z.zone === 'axis') {
      z.pane.scale.auto = true;
      chart.invalidate();
    } else if (z.zone === 'time') {
      chart.animateView({ barSpacing: 8, rightIndex: chart.timeScale.realtimeIndex });
    }
  }

  #key(e) {
    const chart = this.chart;
    if (chart.options.interactive === false) return;
    chart.releaseFit();
    const ts = chart.timeScale;
    const step = Math.max(40, ts.barSpacing * (e.shiftKey ? 20 : 4));
    switch (e.key) {
      case 'ArrowLeft':
        ts.scrollPx(step);
        break;
      case 'ArrowRight':
        ts.scrollPx(-step);
        break;
      case 'ArrowUp':
      case '+':
      case '=':
        ts.zoomAt(chart.plotWidth - ts.rightOffset * ts.barSpacing, 1.2);
        break;
      case 'ArrowDown':
      case '-':
        ts.zoomAt(chart.plotWidth - ts.rightOffset * ts.barSpacing, 1 / 1.2);
        break;
      case 'Home':
        chart.animateView({ rightIndex: ts.width / ts.barSpacing - ts.rightOffset });
        return e.preventDefault();
      case 'End':
        chart.scrollToRealtime();
        return e.preventDefault();
      case 'Escape':
        chart.drawings.cancel();
        return;
      case 'Delete':
      case 'Backspace':
        if (chart.drawings.selected) chart.drawings.remove(chart.drawings.selected);
        return;
      default:
        return;
    }
    e.preventDefault();
    chart.stopAnimation();
    chart.invalidate();
  }
}
