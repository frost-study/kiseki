// Regenerates the README screenshots in docs/ at twice the CSS pixel size (so they stay sharp on high-density screens).
//
//   node tools/screenshots.mjs            # all of them
//   node tools/screenshots.mjs trades     # only the ones whose name contains "trades"
//
// It needs a local Chrome or Chromium (set CHROME to its path if it is not in the usual place) and nothing else: the page is
// served by tools/serve.mjs and driven over the DevTools protocol with Node's own WebSocket. Every run uses a fresh browser
// profile, English, the light theme and a fixed clock-independent layout, so saved settings never leak into the images.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCALE = 2;
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A minimal DevTools protocol client over one page target. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  let id = 0;
  const waiting = new Map();
  const events = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      const { ok, fail } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) fail(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
      else ok(msg.result);
    } else if (msg.method) for (const fn of events.get(msg.method) ?? []) fn(msg.params);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, fail) => {
      waiting.set(++id, { ok, fail });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const once = (method) =>
    new Promise((ok) => {
      const list = events.get(method) ?? [];
      const fn = (p) => (list.splice(list.indexOf(fn), 1), ok(p));
      list.push(fn);
      events.set(method, list);
    });
  return { send, once, close: () => ws.close() };
}

async function openPage(cdp, { width, height }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: SCALE, mobile: false });
  await send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: 'light' },
      // the ticker tape then lies still instead of being caught mid-scroll
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ],
  });
  await send('Emulation.setLocaleOverride', { locale: 'en-US' });
  await send('Network.setUserAgentOverride', { userAgent: 'kiseki-screenshots', acceptLanguage: 'en-US', platform: 'MacIntel' });
  const page = {
    send,
    async goto(path) {
      const loaded = cdp.once('Page.loadEventFired');
      await send('Page.navigate', { url: BASE + path });
      await loaded;
      await page.eval('document.fonts.ready.then(() => true)');
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    /** Wait until `expression` is truthy (the page loads its data asynchronously). */
    async until(expression, timeout = 10_000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await page.eval(expression)) return;
        await sleep(50);
      }
      throw new Error(`timed out waiting for ${expression}`);
    },
    async mouse(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    },
    /** A PNG of `clip` (CSS px; the whole viewport when omitted), at SCALE. */
    async shot(file, clip) {
      await sleep(300); // two frames of rendering after the last change, with room to spare
      const params = { format: 'png', captureBeyondViewport: false };
      if (clip) params.clip = { ...clip, scale: 1 };
      const { data } = await send('Page.captureScreenshot', params);
      await writeFile(join(root, 'docs', file), Buffer.from(data, 'base64'));
      console.log(`docs/${file}`);
    },
    close: () => cdp.send('Target.closeTarget', { targetId }),
  };
  return page;
}

const SHOTS = {
  /** The demo: 4-hour candles, Bollinger Bands, an EMA, volume and MACD, a trend line, a measurement and the crosshair. */
  async 'advanced-chart'(cdp) {
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
    await page.shot('advanced-chart.png');
    await page.close();
  },

  /** The top of the widget gallery: the ticker tape and the mini charts. */
  async widgets(cdp) {
    // tall enough that the whole clip lies inside the viewport (anything past it would come out blank)
    const page = await openPage(cdp, { width: 1000, height: 2400 });
    await page.goto('/widgets.html');
    await page.until(`[...document.querySelectorAll('kiseki-mini-chart')].length > 0`);
    await sleep(1500); // history for every card, and their first frame
    const clip = await page.eval(`(() => {
      // only the widgets themselves: the settings and code panels are left out
      for (const p of document.querySelectorAll('.panel')) p.style.display = 'none';
      const heads = [...document.querySelectorAll('h2')];
      const tape = heads.find((h) => /ticker/i.test(h.textContent)).closest('section');
      const mini = heads.find((h) => /mini/i.test(h.textContent)).closest('section');
      const a = tape.getBoundingClientRect();
      const b = mini.getBoundingClientRect();
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

const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('No Chrome found. Set CHROME to the path of a Chrome or Chromium binary.');
  process.exit(1);
}
const filter = process.argv[2] ?? '';
const server = spawn(process.execPath, [join(root, 'tools/serve.mjs'), String(PORT)], { stdio: 'ignore' });
const profile = await mkdtemp(join(tmpdir(), 'kiseki-shots-'));
const browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', '--font-render-hinting=none', '--lang=en-US', 'about:blank'], {
  stdio: 'ignore',
});
try {
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    port = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').then((s) => s.split('\n')[0], () => null);
  }
  if (!port) throw new Error('Chrome did not start');
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const cdp = await connect(webSocketDebuggerUrl);
  for (const [name, run] of Object.entries(SHOTS)) if (name.includes(filter)) await run(cdp);
  cdp.close();
} finally {
  browser.kill();
  server.kill();
  await sleep(200);
  await rm(profile, { recursive: true, force: true });
}
