/** Shared service worker constants — imported by both vite.config.ts and app code.
 *  Centralising the cache name ensures a refactor in the SW config is caught
 *  at the import site rather than silently breaking the canvas tile fallback.
 */
export const OSM_TILE_CACHE_NAME = 'osm-tiles' as const;

/** Passively-cached tiles from every non-OSM provider (Thunderforest, CyclOSM,
 *  Waymarked, Esri imagery, Terrarium elevation).
 *
 *  Deliberately a SEPARATE cache from OSM_TILE_CACHE_NAME rather than a widened
 *  route on it: that one is also written by the region pre-download feature and read
 *  by the canvas tile fallback, so letting incidental browsing share its LRU would
 *  let a pan over new ground silently evict a region the user deliberately saved. */
export const BASEMAP_TILE_CACHE_NAME = 'basemap-tiles' as const;

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
export function isBasemapTileUrl(url: URL): boolean {
  if (url.hostname === 's3.amazonaws.com') {
    return url.pathname.startsWith('/elevation-tiles-prod/');
  }
  return BASEMAP_TILE_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
  );
}
