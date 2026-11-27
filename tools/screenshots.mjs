// Regenerates the README screenshots in docs/ at twice the CSS pixel size (so they stay sharp on high-density screens).
//
//   node tools/screenshots.mjs            # all of them
//   node tools/screenshots.mjs trades     # only the ones whose name contains "trades"
//
// It needs a local Chrome or Chromium (set CHROME to its path if it is not in the usual place) and nothing else: the page is
// served by tools/serve.mjs and driven over the DevTools protocol (see tools/chrome.mjs). Every run uses a fresh browser
// profile, English, the light theme and a fixed clock-independent layout, so saved settings never leak into the images.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPage as open, root, sleep, withChrome } from './chrome.mjs';

const SCALE = 2;
const PORT = 5199;
let BASE = '';

async function openPage(cdp, { width, height }) {
  // reduced motion: the price ribbon then lies still instead of being caught mid-scroll
  const page = await open(cdp, BASE, { width, height, scale: SCALE, reducedMotion: true, userAgent: 'kiseki-screenshots' });
  /** A PNG of `clip` (CSS px; the whole viewport when omitted), at SCALE. */
  page.shot = async (file, clip) => {
    await sleep(300); // two frames of rendering after the last change, with room to spare
    const params = { format: 'png', captureBeyondViewport: false };
    if (clip) params.clip = { ...clip, scale: 1 };
    const { data } = await page.send('Page.captureScreenshot', params);
    await writeFile(join(root, 'docs', file), Buffer.from(data, 'base64'));
    console.log(`docs/${file}`);
  };
  return page;
}

const SHOTS = {
  /** The demo: 4-hour candles, Bollinger Bands, an EMA, volume and MACD, a trend line, a measurement and the crosshair. */
  async chart(cdp) {
    const page = await openPage(cdp, { width: 1200, height: 750 });
    await page.goto('/?lang=en&symbol=MYTH/USD&tf=4h');
    await page.until('window.kiseki?.chart?.data?.length > 100');
    await page.eval(`(() => {
      const k = window.kiseki;
      k.pauseSaving(true);
      k.setLive(false);
      const c = k.chart;
      for (const ind of [...c.indicators]) c.removeIndicator(ind);
      c.addIndicator('volume');
      c.addIndicator('bb');
      c.addIndicator('ema', { length: 50 });
      c.addIndicator('macd');
      c.showLastBars(130);
      const d = c.data;
      const n = d.length;
      const at = (i, col) => ({ t: d.time[n - i], p: d[col][n - i] });
      c.drawings.restore([
        { tool: 'trend', points: [at(120, 'high'), at(46, 'high')] },
        { tool: 'measure', points: [at(28, 'high'), at(6, 'low')] },
      ]);
      return true;
    })()`);
    // the crosshair on a bar about two thirds of the way along
    const pos = await page.eval(`(() => {
      const { chart: c, root } = window.kiseki;
      const r = root.querySelector('canvas').getBoundingClientRect();
      const x = c.timeScale.x(c.data.length - 52);
      return { x: r.left + x, y: r.top + r.height * 0.33 };
    })()`);
    await page.mouse(pos.x, pos.y);
    await page.shot('chart.png');
    await page.close();
  },

  /** The top of the widget gallery: the price ribbon and the price cards. */
  async widgets(cdp) {
    // tall enough that the whole clip lies inside the viewport (anything past it would come out blank)
    const page = await openPage(cdp, { width: 1000, height: 2400 });
    await page.goto('/widgets.html');
    await page.until(`[...document.querySelectorAll('kiseki-price-card')].length > 0`);
    await sleep(1500); // history for every card, and their first frame
    const clip = await page.eval(`(() => {
      // only the widgets themselves: the settings and code panels are left out
      for (const p of document.querySelectorAll('.panel')) p.style.display = 'none';
      const heads = [...document.querySelectorAll('h2')];
      const ribbon = heads.find((h) => /ribbon/i.test(h.textContent)).closest('section');
      const cards = heads.find((h) => /price card/i.test(h.textContent)).closest('section');
      const a = ribbon.getBoundingClientRect();
      const b = cards.getBoundingClientRect();
      const left = document.querySelector('.wrap').getBoundingClientRect().left;
      return { x: left, y: a.top - 6, width: document.querySelector('.wrap').clientWidth, height: b.bottom - a.top + 12 };
    })()`);
    await page.shot('widgets.png', clip);
    await page.close();
  },

  /** examples/trades.html: round trips, a single fill and a price line. */
  async trades(cdp) {
    const page = await openPage(cdp, { width: 1000, height: 640 });
    await page.goto('/examples/trades.html');
    await page.until('window.chart?.data?.length > 0');
    const clip = await page.eval(`(() => {
      const r = document.getElementById('chart').getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    })()`);
    await page.shot('trades.png', clip);
    await page.close();
  },
};

const filter = process.argv[2] ?? '';
await withChrome(
  PORT,
  async (cdp, base) => {
    BASE = base;
    for (const [name, run] of Object.entries(SHOTS)) if (name.includes(filter)) await run(cdp);
  },
  ['--font-render-hinting=none'],
);
