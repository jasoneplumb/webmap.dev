/** Shared service worker constants — imported by both vite.config.ts and app code.
 *  Centralising the cache name ensures a refactor in the SW config is caught
 *  at the import site rather than silently breaking the canvas tile fallback.
 */
export const OSM_TILE_CACHE_NAME = 'osm-tiles' as const;

/** Passively-cached tiles from every non-OSM provider (Thunderforest, CyclOSM,
 *  Waymarked, Esri imagery, Terrarium elevation).
 *
 *  Deliberately a SEPARATE cache from OSM_TILE_CACHE_NAME rather than a widened
 *  route on it: sharing an LRU would let a pan over new ground evict tiles another
 *  consumer relies on. */
export const BASEMAP_TILE_CACHE_NAME = 'basemap-tiles' as const;

/** Deliberately pre-downloaded region tiles (OSM Streets + Terrarium elevation),
 *  written by offline-download.ts and served by sw.ts AHEAD of the passive
 *  strategies. Its own cache with NO ExpirationPlugin: the passive caches' LRU and
 *  30-day sweep must never evict a region the user deliberately saved — regions are
 *  removed only by the region manager's explicit delete. See ADR-007 / #303. */
export const REGION_TILE_CACHE_NAME = 'region-tiles' as const;

/** Every URL an OSM tile may be requested under. Leaflet spreads requests across
 *  the a/b/c subdomains (`abs(x+y) % 3`) and pre-download mirrors that formula,
 *  but any drift between writers and readers would otherwise turn into silent
 *  cache misses — so region lookups try all three. Non-OSM URLs pass through
 *  unchanged. Pure so it can be unit-tested (the SW around it can't be). */
export function osmTileUrlVariants(url: string): string[] {
  const m = /^https:\/\/[abc]\.tile\.openstreetmap\.org\/(.+)$/.exec(url);
  if (!m) return [url];
  return ['a', 'b', 'c'].map((s) => `https://${s}.tile.openstreetmap.org/${m[1]}`);
}

/** Tile hosts served into BASEMAP_TILE_CACHE_NAME — everything the app draws that
 *  isn't openstreetmap.org. Keep in step with the URL templates in map.ts. */
export const BASEMAP_TILE_HOSTS = [
  'tile.thunderforest.com',
  'tile-cyclosm.openstreetmap.fr',
  'tile.openstreetmap.fr',
  'tile.waymarkedtrails.org',
  'server.arcgisonline.com',
] as const;

/**
 * Does this URL belong to the non-OSM tile cache?
 *
 * Lives here rather than inline in sw.ts so it can be unit-tested — the service
 * worker around it can't be. Matches the exact host or a subdomain of it, never a
 * suffix: `evil-tile.thunderforest.com.example.com` must not match, which is why this
 * tests `endsWith('.' + host)` rather than `includes(host)`.
 */
/** Terrarium elevation is the only basemap-route layer a saved region ever contains, so
 *  it is the only one worth a region-cache lookup. Every other basemap host — Satellite,
 *  Thunderforest, osm.fr, Waymarked — would pay an IndexedDB round-trip per tile on the
 *  hot path to learn what this predicate already knows. */
export function isRegionCacheableBasemapUrl(url: URL): boolean {
  return url.hostname === 's3.amazonaws.com' && url.pathname.startsWith('/elevation-tiles-prod/');
}

export function isBasemapTileUrl(url: URL): boolean {
  if (url.hostname === 's3.amazonaws.com') {
    return url.pathname.startsWith('/elevation-tiles-prod/');
  }
  const host = BASEMAP_TILE_HOSTS.find(
    (h) => url.hostname === h || url.hostname.endsWith(`.${h}`),
  );
  if (host === undefined) return false;

  // Thunderforest answers a request with NO usable key with HTTP 200 and a
  // different image — a placeholder, not the map — rather than a 4xx (verified
  // 2026-08-31; an *invalid* key is a clean 401, which onlyReadable already
  // rejects). CacheFirst would pin that placeholder for 30 days, so a build that
  // shipped without VITE_THUNDERFOREST_KEY would keep serving it from cache long
  // after the key was restored. Decline to cache what we can't tell is real.
  if (host === 'tile.thunderforest.com' && !url.searchParams.get('apikey')) return false;

  return true;
}
