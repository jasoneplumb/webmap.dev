/** Shared service worker constants — imported by both vite.config.ts and app code.
 *  Centralising the cache name ensures a refactor in the SW config is caught
 *  at the import site rather than silently breaking the canvas tile fallback.
 */
export const OSM_TILE_CACHE_NAME = 'osm-tiles' as const;

/** TEMPORARY (remove with the #207/#208 diagnostics once the WKWebView blank is
 *  confirmed fixed). The service worker stashes recovered blank-navigation records
 *  in this cache because a blank navigation can't report anything itself; the page
 *  reads them on its next good load. Shared so sw.ts and main.ts can't drift. */
export const SW_DIAG_CACHE = 'webmap-sw-diag' as const;
export const SW_DIAG_URL = '/__webmap_sw_diag__' as const;
