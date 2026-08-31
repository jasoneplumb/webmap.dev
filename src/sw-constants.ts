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
