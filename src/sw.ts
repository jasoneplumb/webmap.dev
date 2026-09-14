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
import { StaleWhileRevalidate, CacheFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim, type WorkboxPlugin } from 'workbox-core';
import {
  OSM_TILE_CACHE_NAME,
  BASEMAP_TILE_CACHE_NAME,
  REGION_TILE_CACHE_NAME,
  isBasemapTileUrl,
  osmTileUrlVariants,
} from './sw-constants';

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

// ── Saved regions ──────────────────────────────────────────────────────────────
// Tiles the user deliberately pre-downloaded (offline-download.ts). Checked BEFORE
// the passive strategies on both tile routes, so a saved region serves offline —
// and without a network round-trip online — regardless of what the passive LRUs
// have evicted. This cache has no ExpirationPlugin on purpose: only the region
// manager's explicit delete removes entries (ADR-007). purgeOnQuotaError is also
// deliberately absent — under quota pressure the passive caches purge first, and
// saved regions are the last thing the user wants sacrificed.
let regionCachePromise: Promise<Cache> | null = null;

/**
 * Look up a tile in the protected region cache, or undefined if it is not there.
 *
 * Never throws. This runs ahead of the network on BOTH tile routes, so a rejection here
 * would fail the whole `respondWith` and take out every map tile — online, with a working
 * network, for the entire service-worker lifetime, because the rejected promise would stay
 * memoized. `caches.open` does reject in the wild: Safari private browsing, Firefox with
 * site data blocked, and storage errors all surface here. A miss is recoverable; a throw is
 * a black map.
 */
async function matchRegionTile(url: string): Promise<Response | undefined> {
  if (!regionCachePromise) {
    regionCachePromise = caches.open(REGION_TILE_CACHE_NAME).catch((err: unknown) => {
      // Drop the rejected promise so a later request can retry rather than inheriting
      // this failure forever.
      regionCachePromise = null;
      throw err;
    });
  }
  try {
    const cache = await regionCachePromise;
    // Parallel, not sequential: the variants are a guess at which subdomain Leaflet will
    // ask for, and on a miss — the common case, since most users save no regions — three
    // serialized cache lookups sat in front of every single tile request.
    const hits = await Promise.all(osmTileUrlVariants(url).map((v) => cache.match(v)));
    return hits.find((hit) => hit !== undefined);
  } catch {
    return undefined;
  }
}

// ── Map tiles ──────────────────────────────────────────────────────────────────
// Region-first, then cache-while-revalidate. purgeOnQuotaError purges the passive
// cache on a storage-quota hit instead of throwing (the documented iOS/WKWebView
// mitigation).
const osmPassiveStrategy = new StaleWhileRevalidate({
  cacheName: OSM_TILE_CACHE_NAME,
  plugins: [
    new ExpirationPlugin({
      maxEntries: 300,
      maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      purgeOnQuotaError: true,
    }),
  ],
});

registerRoute(
  /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/,
  async ({ event, request }) => {
    const regionHit = await matchRegionTile(request.url);
    if (regionHit) return regionHit;
    return osmPassiveStrategy.handle({ event, request });
  },
);

// ── Non-OSM tiles ──────────────────────────────────────────────────────────────
// Everything the app draws that ISN'T openstreetmap.org — including the DEFAULT
// stack (Esri satellite base + Terrarium hillshade), which until now matched no
// route at all and so re-fetched on every zoom step even on a repeat visit.
//
// Refuse anything opaque. Tile <img>s carry crossOrigin (see tilePerf in map.ts), so
// these arrive as real CORS responses with readable bodies and honest sizes; an
// opaque response would be a 0-byte body to any reader and is padded by megabytes
// against the storage quota, so caching one is worse than not caching at all. If the
// crossOrigin option is ever dropped, this fails closed instead of silently filling
// the quota with unusable entries.
const onlyReadable: WorkboxPlugin = {
  cacheWillUpdate: async ({ response }) =>
    response.status === 200 && response.type !== 'opaque' ? response : null,
};

// CacheFirst, not StaleWhileRevalidate: a revalidation round-trip on every tile
// spends cellular data and provider quota to refresh imagery that changes on a
// scale of months. Passive caching of tiles the user actually viewed is what the
// OSM and Thunderforest policies permit; nothing here fetches ahead of the view.
// (Region pre-download is the one exception, and it only ever targets providers
// whose terms allow it — OSM and AWS-Open-Data Terrarium; see offline-regions.ts.)
const basemapPassiveStrategy = new CacheFirst({
  cacheName: BASEMAP_TILE_CACHE_NAME,
  plugins: [
    onlyReadable,
    // ~500 entries at a ~25 KB blended average (Esri JPEG ~20-40 KB, Terrarium PNG
    // ~40-60 KB, Thunderforest PNG ~15-30 KB) is ~12 MB, alongside osm-tiles' ~4.5 MB,
    // inside the ~50 MB Safari budget with room left for pre-downloaded regions.
    new ExpirationPlugin({
      maxEntries: 500,
      maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      purgeOnQuotaError: true,
    }),
  ],
});

registerRoute(
  ({ url }) => isBasemapTileUrl(url),
  // Region-first covers the hillshade offline: hillshade.ts fetches Terrarium
  // elevation through this route, so a saved region's elevation tiles serve from
  // region-tiles even after the passive LRU has moved on.
  async ({ event, request }) => {
    const regionHit = await matchRegionTile(request.url);
    if (regionHit) return regionHit;
    return basemapPassiveStrategy.handle({ event, request });
  },
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
