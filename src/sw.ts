/**
 * Intent: Custom service worker (injectManifest) — a navigation handler that can
 *   never blank the page, plus SW-side error capture for on-device observability.
 * Context: Replaces vite-plugin-pwa's generateSW. The Edge-on-iPhone (WKWebView)
 *   blank-on-cold-start survived the navigation-strategy fixes (NetworkFirst in
 *   v0.34.3, timeout removal in v0.34.4). It only appears after several loads from a
 *   clean state — pointing at accumulated storage/SW-runtime pressure tipping the
 *   worker over and returning an empty navigation. A blank navigation is invisible to
 *   page-side diagnostics, so both the recovery and the diagnostics have to live here.
 * Pattern: Navigations go network-first but any failure OR an empty body falls back to
 *   the install-verified precache copy of index.html — never the flaky runtime cache,
 *   so the page can never go blank (worst case: a slightly-stale shell). Failures are
 *   stashed in a cache that the next good load reads (see surfaceSwDiagnostics in
 *   main.ts). The registerType:'prompt' update flow is wired manually here
 *   (SKIP_WAITING message + clientsClaim), since generateSW no longer does it.
 * Future: The diagnostics (DIAG_*) are temporary — remove with the #207/#208 overlay
 *   once the WKWebView blank is confirmed fixed in the field.
 */
/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';
import { OSM_TILE_CACHE_NAME } from './sw-constants';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ── Precache the build assets (manifest injected by vite-plugin-pwa at build) ──
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── SW-side diagnostics ───────────────────────────────────────────────────────
// A blank navigation can't report anything itself, but the worker survives it — so
// it records failures here and the page reads them on its next good load. These
// constants are duplicated in main.ts (surfaceSwDiagnostics); keep them in sync.
const DIAG_CACHE = 'webmap-sw-diag';
const DIAG_URL = '/__webmap_sw_diag__';

async function recordSwError(context: string, err: unknown): Promise<void> {
  try {
    const cache = await caches.open(DIAG_CACHE);
    const prev = await cache.match(DIAG_URL);
    const list: unknown[] = prev ? await prev.json() : [];
    list.push({
      t: new Date().toISOString(),
      context,
      message: err instanceof Error ? err.message : String(err),
    });
    // Keep only the most recent few so the entry can't grow unbounded.
    while (list.length > 20) list.shift();
    await cache.put(
      DIAG_URL,
      new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }),
    );
  } catch {
    // Diagnostics are best-effort; never let them throw back into a handler.
  }
}

// ── Bulletproof navigation ─────────────────────────────────────────────────────
// Network-first, but the ONLY fallback is the install-verified precache copy of
// index.html — never a runtime cache (whose flaky reads in WKWebView were returning
// empty navigations). So the page always renders a real document.
registerRoute(
  ({ request }) => request.mode === 'navigate',
  async ({ request }) => {
    try {
      const res = await fetch(request);
      if (!res.ok) throw new Error(`navigation HTTP ${res.status}`);
      // Guard against an empty/blank 200 (the WKWebView failure mode): validate the
      // body before trusting it. index.html is tiny, so reading a clone is cheap.
      const body = await res.clone().text();
      if (body.trim().length < 50) throw new Error('navigation body empty');
      return res;
    } catch (err) {
      await recordSwError('navigate', err);
      const fallback = await matchPrecache('index.html');
      if (fallback) return fallback;
      // index.html is always precached, so this is unreachable — but never blank:
      // a zero-delay refresh document beats a white screen.
      return new Response('<!doctype html><meta http-equiv="refresh" content="0">', {
        headers: { 'Content-Type': 'text/html' },
      });
    }
  },
);

// ── Map tiles ──────────────────────────────────────────────────────────────────
// Cache-while-revalidate. purgeOnQuotaError purges the cache on a storage-quota hit
// instead of throwing (the documented iOS/WKWebView mitigation for "fails after N
// loads"); the lower maxEntries trims the footprint that accumulates across a soak.
registerRoute(
  /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/,
  new StaleWhileRevalidate({
    cacheName: OSM_TILE_CACHE_NAME,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

// ── Geocoding: never cache (parity with the previous generateSW config) ─────────
registerRoute(/^https:\/\/geocode\.arcgis\.com\/.*/, new NetworkOnly());

// ── Update flow (registerType: 'prompt') ────────────────────────────────────────
// virtual:pwa-register's updateSW(true) posts SKIP_WAITING to the waiting worker;
// activate + claim so workbox-window's 'controlling' event fires and reloads the
// page. The visibility/post-paint gating of that reload lives in main.ts.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string } | undefined;
  if (data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
clientsClaim();
