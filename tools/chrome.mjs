// Shared by tools/screenshots.mjs and tools/bench.mjs: start the static server and a headless Chrome with a fresh profile,
// and talk to Chrome over the DevTools protocol with Node's own WebSocket (no dependencies).
//
// It needs a local Chrome or Chromium; set CHROME to its path if it is not in one of the usual places.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A minimal DevTools protocol client over the browser connection. */
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

/**
 * Serve the project on `port`, start headless Chrome, and call `run(cdp, base)` with a DevTools client and the server's URL.
 * Everything is shut down and the temporary profile removed afterwards, also when `run` throws.
 */
export async function withChrome(port, run, extraArgs = []) {
  const chrome = CANDIDATES.find((p) => existsSync(p));
  if (!chrome) {
    console.error('No Chrome found. Set CHROME to the path of a Chrome or Chromium binary.');
    process.exit(1);
  }
  const server = spawn(process.execPath, [join(root, 'tools/serve.mjs'), String(port)], { stdio: 'ignore' });
  const profile = await mkdtemp(join(tmpdir(), 'kiseki-chrome-'));
  const browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', '--lang=en-US', ...extraArgs, 'about:blank'], {
    stdio: 'ignore',
  });
  try {
    let devtools = null;
    for (let i = 0; i < 100 && !devtools; i++) {
      await sleep(100);
      devtools = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').then((s) => s.split('\n')[0], () => null);
    }
    if (!devtools) throw new Error('Chrome did not start');
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${devtools}/json/version`)).json();
    const cdp = await connect(webSocketDebuggerUrl);
    try {
      return await run(cdp, `http://localhost:${port}`);
    } finally {
      cdp.close();
    }
  } finally {
    browser.kill();
    server.kill();
    await sleep(200);
    await rm(profile, { recursive: true, force: true });
  }
}

/** Open a page target with the given viewport. `goto`, `eval` and `until` cover what the tools need. */
export async function openPage(cdp, base, { width, height, scale = 1, colorScheme = 'light', reducedMotion = false, userAgent = 'kiseki-tools' }) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  const features = [{ name: 'prefers-color-scheme', value: colorScheme }];
  if (reducedMotion) features.push({ name: 'prefers-reduced-motion', value: 'reduce' });
  await send('Emulation.setEmulatedMedia', { features });
  await send('Emulation.setLocaleOverride', { locale: 'en-US' });
  await send('Network.setUserAgentOverride', { userAgent, acceptLanguage: 'en-US', platform: 'MacIntel' });
  const page = {
    send,
    async goto(path) {
      const loaded = cdp.once('Page.loadEventFired');
      await send('Page.navigate', { url: base + path });
      await loaded;
      await page.eval('document.fonts.ready.then(() => true)');
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    /** Wait until `expression` is truthy (pages load their data asynchronously). */
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
    close: () => cdp.send('Target.closeTarget', { targetId }),
  };
  return page;
}
