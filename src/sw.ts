/**
 * Intent: Custom service worker (vite-plugin-pwa injectManifest).
 * Pattern: Precache the build assets; serve navigations network-first with an offline
 *   fallback to the install-verified precache copy of index.html; cache map tiles
 *   (StaleWhileRevalidate, purgeOnQuotaError on iOS storage-quota hits); never cache
 *   geocoding. The registerType:'prompt' update flow is wired manually here
 *   (SKIP_WAITING message + clientsClaim), since injectManifest doesn't generate it.
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

// ── Navigation: network-first, with the install-verified precache copy of index.html
// as the offline fallback. Network-first keeps the served shell paired with the
// current chunk hashes (no stale-shell mismatch), and the precache fallback keeps the
// app available offline.
registerRoute(
  ({ request }) => request.mode === 'navigate',
  async ({ request }) => {
    try {
      const res = await fetch(request);
      if (!res.ok) throw new Error(`navigation HTTP ${res.status}`);
      return res;
    } catch {
      const fallback = await matchPrecache('index.html');
      if (fallback) return fallback;
      throw new Error('navigation failed and no precached index.html');
    }
  },
);

// ── Map tiles ──────────────────────────────────────────────────────────────────
// Cache-while-revalidate. purgeOnQuotaError purges the cache on a storage-quota hit
// instead of throwing (the documented iOS/WKWebView mitigation).
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

// ── Geocoding: never cache ───────────────────────────────────────────────────────
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
