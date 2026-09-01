#!/usr/bin/env node
/**
 * Intent: Regenerate the README preview screenshots in docs/images/ so a refresh is a
 *         command, not an afternoon of cropping phone screenshots.
 * Context: `npm run screenshots`. Boots the Vite dev server on its own port, drives a
 *          headless Google Chrome over the DevTools protocol, and writes one PNG per
 *          scene at the iPhone-15-Pro viewport the existing images use (393x852).
 * Pattern: Zero new dependencies — Node 22's global WebSocket speaks CDP directly, and
 *          `sharp` (already a devDependency, used by the icon/OG generators) does the
 *          2x supersample down to 1x. Each scene seeds localStorage for its base map and
 *          overlays, frames the view through the DEV-only `window.__webmapMap` handle in
 *          main.ts, then optionally drives the UI before the shutter.
 * Future: Scenes are hardcoded below. The nav scene depends on live ESRI + Valhalla
 *         responses; if either is down that scene fails loudly rather than shipping a
 *         half-drawn route.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs', 'images');
const PORT = 5199;
// The ESRI API key is referrer-restricted to the production hostname, so search and
// reverse geocoding return "Invalid Token" from a localhost origin. Chrome resolves
// this name to the loopback dev server for this run only (--host-resolver-rules,
// equivalent to a temporary /etc/hosts entry): the page really is served from the
// origin the key expects, so no header is faked and nothing outside this process
// is touched. Vite serves it because it accepts the Host header as-is.
const HOSTNAME = 'www.webmap.dev';
const VIEWPORT = { width: 393, height: 852 };
const SCALE = 2; // capture at 2x, downsample to 1x — crisper text, same file size class
const CHROME = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG = process.env.DEBUG === '1';

// ── Scenes ───────────────────────────────────────────────────────────────────
// Between them these cover every base map, the tile overlays, and the four UI
// surfaces worth showing: the layers popover, search results, the geocode bar,
// and the turn-by-turn pill.

/** @typedef {{ file: string, title: string, base: string, overlays: string[],
 *              center: [number, number], zoom: number, geolocation?: [number, number],
 *              act?: (page: Page, scene: Scene) => Promise<void> }} Scene */

/** @type {Scene[]} */
const SCENES = [
  {
    file: 'satellite-hillshade-view.png',
    title: 'Satellite + hillshade — Grand Canyon',
    base: 'satellite',
    overlays: ['hillshade'],
    center: [36.0959, -112.1129],
    zoom: 12.5,
  },
  {
    file: 'outdoors-trails-view.png',
    title: 'Outdoors + hillshade + hiking routes — Yosemite Valley',
    base: 'outdoors',
    overlays: ['hillshade', 'hiking-routes'],
    center: [37.7420, -119.5860],
    zoom: 13.5,
  },
  {
    file: 'cycle-routes-view.png',
    title: 'Cycle base + cycling routes — Amsterdam',
    base: 'cycle',
    overlays: ['cycling-routes'],
    center: [52.3702, 4.8952],
    zoom: 14,
  },
  {
    file: 'layers-panel-view.png',
    title: 'Map Layers popover — Golden Gate, San Francisco',
    base: 'satellite',
    overlays: ['hillshade'],
    // Framed so the Golden Gate Bridge sits in the strip of map the popover leaves.
    center: [37.8331, -122.4783],
    zoom: 14,
    async act(page) {
      await page.click('#layers-control-btn');
      await page.waitFor("document.querySelector('.layers-popover')?.style.display === 'block'");
      await page.settle(400);
    },
  },
  {
    file: 'search-results-view.png',
    title: 'Place search results — coffee in Melbourne',
    base: 'parks',
    overlays: [],
    // A category word rather than a place name: ESRI biases results to the visible
    // bounds (useMapBounds: 7), so this fills the list with fifteen distinctly-named
    // cafés spread across the frame instead of six spellings of one park. Melbourne
    // rather than a US city on purpose — a North American centre returns mostly
    // Starbucks, which reads as repetitively as the place-name search did.
    center: [-37.8130, 144.9640],
    zoom: 14,
    async act(page) {
      // Typing only raises ESRI's suggestion list; the app's own results dropdown
      // (numbered markers + rows) is built from the `results` event, which needs a submit.
      await page.type('.geocoder-control-input', 'coffee');
      await page.settle(600);
      await page.press('Enter', 13);
      await page.waitFor(
        "document.querySelector('.search-dropdown')?.style.display === 'block'" +
        " && document.querySelectorAll('.sheet-result').length > 0",
        { timeout: 20000, what: 'ESRI search results' },
      );
      // Results fit the map to their own bounds; re-frame so the markers land in
      // the strip of map the results sheet leaves above it.
      await page.setView([-37.8230, 144.9640], 14);
      await page.settle(800);
    },
  },
  {
    file: 'nav-guidance-view.png',
    title: 'Turn-by-turn guidance — Boston',
    base: 'osm-streets',
    overlays: [],
    center: [42.3510, -71.0815],
    zoom: 13.5,
    geolocation: [42.3550, -71.0656], // Boston Common — the "you are here" origin
    async act(page, scene) {
      // main.ts arms locate on load, so the blue dot arrives on its own once the
      // CDP geolocation override answers — no tap needed (tapping would toggle it OFF).
      await page.waitFor("document.querySelector('.leaflet-marker-icon') !== null",
        { what: 'GPS location marker' });
      // That first fix recentres the map at zoom 14; re-frame to fit both ends of the route.
      await page.setView(scene.center, scene.zoom);
      await page.settle(600);

      // Drop the destination pin exactly where a long-press on Fenway would, and
      // let the reverse geocode fill the bottom bar. The round-trip through
      // latLngToContainerPoint is how a plain {lat,lng} becomes a real LatLng
      // without a Leaflet global to call L.latLng() on.
      await page.exec(
        "window.__webmapMap.fire('dblclick', { latlng: window.__webmapMap.containerPointToLatLng("
        + "window.__webmapMap.latLngToContainerPoint({ lat: 42.3467, lng: -71.0972 })) })",
      );
      await page.waitFor(
        "document.querySelector('.geocode-bar__addr')?.textContent.trim().length > 0",
        { timeout: 20000, what: 'reverse-geocoded address' },
      );

      // Start guidance — fetches the route from Valhalla and raises the maneuver pill.
      await page.click('.geocode-bar__nav');
      await page.waitFor(
        "document.querySelector('.guidance-banner')?.textContent.trim().length > 0",
        { timeout: 30000, what: 'Valhalla route + guidance pill' },
      );
      await page.settle(1500);
      // Guidance snaps to the driver's viewpoint; pull back onto the whole route.
      await page.setView(scene.center, scene.zoom);
      await page.settle(1500);
    },
  },
];

// ── Minimal Chrome DevTools Protocol client ──────────────────────────────────

class Cdp {
  #ws;
  #nextId = 1;
  #pending = new Map();

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === undefined) {
        // DEBUG=1 forwards page console + uncaught exceptions; without it a scene
        // that silently does nothing is very hard to diagnose.
        if (!DEBUG) return;
        if (msg.method === 'Runtime.consoleAPICalled') {
          console.log(`  [page.${msg.params.type}]`, msg.params.args.map((a) => a.value ?? a.description).join(' '));
        } else if (msg.method === 'Runtime.exceptionThrown') {
          console.log('  [page.error]', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
        }
        return;
      }
      const slot = this.#pending.get(msg.id);
      if (!slot) return;
      this.#pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? {})})`));
      else slot.resolve(msg.result);
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`CDP connect failed: ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.#ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  close() { this.#ws.close(); }
}

/** Thin page-scoped wrapper: everything a scene needs, nothing it doesn't. */
class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sid = sessionId;
  }

  send(method, params) { return this.cdp.send(method, params, this.sid); }

  /** Evaluate in the page and return the value (throws on a page-side exception). */
  async eval(expression, { awaitPromise = false } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise,
    });
    if (res.exceptionDetails) {
      throw new Error(`page eval failed: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}\n  ${expression}`);
    }
    return res.result.value;
  }

  /** Run for effect. Leaflet's setters return the map itself, which CDP cannot
   *  serialize ("Object reference chain is too long"), so discard the result. */
  exec(expression) { return this.eval(`void (${expression})`); }

  /** Frame the map through the DEV-only handle main.ts hangs off `window`. */
  setView([lat, lng], zoom) {
    return this.exec(`window.__webmapMap.setView([${lat}, ${lng}], ${zoom}, { animate: false })`);
  }

  settle(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async waitFor(expression, { timeout = 15000, interval = 150, what = expression } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      // Swallow page-side errors: the DOM the predicate probes may not exist yet.
      let ok = false;
      try { ok = Boolean(await this.eval(`(() => { try { return !!(${expression}); } catch { return false; } })()`)); }
      catch { ok = false; }
      if (ok) return;
      if (Date.now() > deadline) throw new Error(`timed out after ${timeout}ms waiting for ${what}`);
      await this.settle(interval);
    }
  }

  /** Synthetic click — the app's controls all listen for `click`, and this sidesteps
   *  hit-testing against Leaflet's stacked panes. */
  async click(selector) {
    const clicked = await this.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});` +
      ` if (!el) return false; el.click(); return true; })()`,
    );
    if (!clicked) throw new Error(`click: no element matched ${selector}`);
  }

  /** Type into an input with real key events so debounced listeners actually fire. */
  async type(selector, text) {
    const focused = await this.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});` +
      ` if (!el) return false; el.focus(); el.value = ''; return true; })()`,
    );
    if (!focused) throw new Error(`type: no element matched ${selector}`);
    for (const ch of text) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      await this.settle(40);
    }
  }

  async press(key, windowsVirtualKeyCode) {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode });
    }
  }

  /** Every Leaflet tile currently in the DOM has finished loading. */
  waitForTiles(timeout = 45000) {
    return this.waitFor(
      "(() => { const t = document.querySelectorAll('.leaflet-tile');" +
      " return t.length > 0 && Array.from(t).every(el => el.classList.contains('leaflet-tile-loaded')); })()",
      { timeout, what: 'map tiles to finish loading' },
    );
  }

  async screenshot() {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    return Buffer.from(data, 'base64');
  }
}

// ── Process plumbing ─────────────────────────────────────────────────────────

/** Boot `vite` and resolve the https URL it prints. */
function startDevServer() {
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const url = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite did not start in 60s:\n${log}`)), 60000);
    const scan = (buf) => {
      log += buf.toString();
      const m = /https?:\/\/localhost:(\d+)\//.exec(log);
      if (m) { clearTimeout(timer); resolve(`https://${HOSTNAME}:${m[1]}`); }
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`vite exited (${code}):\n${log}`)); });
  });
  return { child, url };
}

async function startChrome() {
  const userDataDir = await mkdtemp(join(tmpdir(), 'webmap-shots-'));
  const child = spawn(CHROME, [
    '--headless=new',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-features=Translate,MediaRouter',
    // The dev server serves a self-signed cert (see the basicSsl plugin in
    // vite.config.ts); https is required for geolocation to work at all.
    '--ignore-certificate-errors',
    '--allow-insecure-localhost',
    `--host-resolver-rules=MAP ${HOSTNAME} 127.0.0.1`,
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const portFile = join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 30000;
  for (;;) {
    if (existsSync(portFile)) {
      const [port] = readFileSync(portFile, 'utf8').split('\n');
      if (port) {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        const { webSocketDebuggerUrl } = await res.json();
        return { child, userDataDir, webSocketDebuggerUrl };
      }
    }
    if (Date.now() > deadline) throw new Error('Chrome did not expose a DevTools port in 30s');
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ── Capture ──────────────────────────────────────────────────────────────────

/** The consent gate blocks the whole app; pre-accept it rather than clicking through. */
function consentVersion() {
  const src = readFileSync(join(ROOT, 'src', 'consent.ts'), 'utf8');
  const m = /const CONSENT_VERSION = '([^']+)'/.exec(src);
  if (!m) throw new Error('could not read CONSENT_VERSION from src/consent.ts');
  return m[1];
}

function seedScript(scene, version) {
  return `
    try {
      localStorage.setItem('webmap-consent-version', ${JSON.stringify(version)});
      localStorage.setItem('webmap-consent-accepted-at', '2026-01-01T00:00:00.000Z');
      localStorage.setItem('webmap-consent-install-id', '00000000-0000-4000-8000-000000000000');
      localStorage.setItem('webmap-layer-selection', ${JSON.stringify(scene.base)});
      localStorage.setItem('webmap-overlay-selection', ${JSON.stringify(JSON.stringify(scene.overlays))});
    } catch (e) { console.error('seed failed', e); }
    ${scene.geolocation ? '' : `
    // No GPS in this scene: stub the API so the app's watch never resolves OR
    // rejects. A rejection would raise the sticky "Location access is denied"
    // toast over the map; a fix would drop a blue dot the scene didn't ask for.
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition() {}, watchPosition() { return 1; }, clearWatch() {} },
    });`}
  `;
}

async function captureScene(cdp, baseUrl, scene, version) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new Page(cdp, sessionId);
  try {
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: SCALE, mobile: true,
    });
    // Leaflet reads `'ontouchstart' in window` at import time, so touch has to be on
    // before the bundle loads or the controls render at desktop sizes.
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.send('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 '
        + '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });

    if (scene.geolocation) {
      const [latitude, longitude] = scene.geolocation;
      await cdp.send('Browser.grantPermissions', { origin: baseUrl, permissions: ['geolocation'] });
      await page.send('Emulation.setGeolocationOverride', { latitude, longitude, accuracy: 12 });
    }

    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: seedScript(scene, version) });
    await page.send('Page.navigate', { url: baseUrl + '/' });

    await page.waitFor('window.__webmapMap !== undefined', { timeout: 30000, what: 'app bootstrap' });
    await page.setView(scene.center, scene.zoom);
    await page.waitForTiles();
    await page.settle(1200);

    if (scene.act) {
      await scene.act(page, scene);
      await page.waitForTiles();
      await page.settle(600);
    }

    const png = await page.screenshot();
    const out = join(OUT_DIR, scene.file);
    await sharp(png)
      .resize(VIEWPORT.width, VIEWPORT.height, { fit: 'fill' })
      .png({ compressionLevel: 9, effort: 10 })
      .toFile(out);
    return out;
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const scenes = only.length ? SCENES.filter((s) => only.some((o) => s.file.includes(o))) : SCENES;
  if (!scenes.length) throw new Error(`no scene matched ${only.join(', ')}`);

  await access(CHROME).catch(() => {
    throw new Error(`Chrome not found at ${CHROME} — set CHROME_PATH`);
  });
  if (!existsSync(join(ROOT, '.env'))) {
    console.warn('! .env is missing — the Cycle/Outdoors bases and search will render as errors.');
  }

  const version = consentVersion();
  const vite = startDevServer();
  let chrome;
  let cdp;
  try {
    const baseUrl = await vite.url;
    console.log(`dev server: ${baseUrl}`);
    chrome = await startChrome();
    cdp = await Cdp.connect(chrome.webSocketDebuggerUrl);

    for (const scene of scenes) {
      process.stdout.write(`  ${scene.file} — ${scene.title} ... `);
      const out = await captureScene(cdp, baseUrl, scene, version);
      console.log(`${Math.round((await readFile(out)).length / 1024)} kB`);
    }
  } finally {
    cdp?.close();
    chrome?.child.kill();
    if (chrome?.userDataDir) await rm(chrome.userDataDir, { recursive: true, force: true }).catch(() => {});
    vite.child.kill();
  }
}

main().catch((err) => {
  console.error(`\nscreenshot capture failed: ${err.message}`);
  process.exitCode = 1;
});
