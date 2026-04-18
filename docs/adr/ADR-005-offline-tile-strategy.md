# ADR-005: Two-Tier Offline Tile Strategy

**Status:** Accepted

## Context

Maps require tile imagery from a provider (e.g., OpenStreetMap). Without an internet connection, the map is blank and unusable. Users want to record trails offline, so the app needs a strategy to cache map tiles for offline access.

Two complementary caching strategies are available:

1. **Passive caching** — Cache tiles *as the user views them* (Workbox StaleWhileRevalidate pattern)
2. **Proactive pre-caching** — User selects a region in advance and pre-downloads all tiles for that area before heading out

A single strategy alone is insufficient:
- Passive caching only covers areas the user has previously visited
- Pre-caching requires the app to predict which regions users will need
- Together, they provide flexible offline coverage: use old cached tiles from past trips, or pre-download new areas before traveling

## Decision

Implement a **two-tier offline tile strategy**:

### Tier 1: Workbox Passive Caching (Service Worker)
Use Workbox's `StaleWhileRevalidate` handler for OpenStreetMap tiles:

```typescript
// vite.config.ts
runtimeCaching: [
  {
    urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: OSM_TILE_CACHE_NAME,
      expiration: {
        maxEntries: 500,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      },
    },
  },
]
```

**Behavior:**
- On a network request for a tile, return the cached version if available (stale is acceptable)
- Fetch the fresh tile in the background and update the cache for next time
- If the cache miss and network is offline, request fails gracefully

### Tier 2: Cache API Pre-Download (User-Initiated)
Provide a UI control to select a bounding box, choose zoom levels, and pre-download all tiles for that region into the Cache API:

```typescript
// offline-download.ts
async function downloadTiles(urls: string[], onProgress: ProgressCallback): Promise<void> {
  const cache = await caches.open(OSM_TILE_CACHE_NAME);
  for (const url of urls) {
    const resp = await fetch(url);
    if (resp.ok) {
      await cache.put(url, resp);
    }
  }
  onProgress({ done: urls.length, failed: 0 });
}
```

**Behavior:**
- User drags a rectangle on the map and selects zoom levels
- App estimates tile count and storage size
- User initiates download; tiles are fetched and cached in parallel (6 concurrent fetches)
- Progress is shown in the UI; can be cancelled at any time
- Pre-downloaded tiles are stored in the same cache as passive tiles

## Alternatives Considered

1. **Passive Caching Only (StaleWhileRevalidate)**
   - Tiles are cached as the user explores the map
   - Pros: Zero configuration; works automatically
   - Cons: Only covers visited areas; limited offline utility for new regions

2. **Pre-Download Only (No Passive Cache)**
   - User pre-downloads regions explicitly before trips
   - Pros: Predictable; users control bandwidth usage
   - Cons: Doesn't benefit from opportunistic caching during online sessions; forces users to plan ahead

3. **Server-Side Tile Hosting with Sync API**
   - App uploads user location trails and downloads only the tiles needed for those routes
   - Pros: Minimal storage; personalized to user's activities
   - Cons: Requires a backend server; breaks local-only principle ([ADR-004](ADR-004-local-only-data.md)); privacy concerns

4. **Distributed Tile Archive (MBTiles)**
   - Download a single `.mbtiles` file (SQLite database) for a region instead of individual tiles
   - Pros: More efficient than many individual requests; single file to manage
   - Cons: Requires custom code to parse and serve from IndexedDB; no integration with Workbox; larger file size due to packaging overhead

## Consequences

### Advantages
- **Automatic coverage:** Passive caching provides offline maps for all previously-visited areas with zero user action
- **Flexible pre-download:** Users can prepare specific regions for upcoming trips
- **Efficient storage:** Only tiles the user has viewed (or explicitly pre-downloaded) are stored; cache is bounded at 500 entries
- **Graceful degradation:** If a tile is not cached and offline, the map shows missing tile placeholders; app remains functional
- **Service Worker integration:** Workbox is battle-tested and maintained; no custom synchronization logic needed

### Disadvantages
- **Cache bloat:** Popular routes (e.g., hiking trails) can accumulate many tiles; 500-entry limit may evict frequently-used tiles
- **Storage quota:** Browser cache quota varies by browser and device (50MB on Safari, 1GB on Chrome); large pre-downloads may exceed quota
- **Stale imagery:** StaleWhileRevalidate always returns cached tiles first, even if the network is available; map imagery may be days or weeks old
- **OSM only:** Only OpenStreetMap tiles are cached; Mapbox, Google, and other providers are not cached and are unusable offline
- **No vector tiles:** Raster tile caching doesn't support vector-based maps (`.pbf` format); future map providers may require a different caching strategy

### Mitigation
- Display a warning when the user approaches the 500-tile cache limit, suggesting cleanup
- Implement a "clear offline tiles" UI button to allow manual cache clearing
- Add a fallback UI hint ("Go online to refresh maps") when tiles are stale
- Consider future support for vector tile caching (e.g., PMTiles) if Mapbox or Maplibre integration is needed
- Monitor browser cache quota usage and alert users if approaching their device's storage limit

## Implementation Details

**Shared Cache Name:** Both tiers write to the same cache (`OSM_TILE_CACHE_NAME` = `"osm-tiles-v1"`), so pre-downloaded tiles are treated identically to passively-cached tiles. Workbox automatically adds pre-downloaded tiles to the cache, and subsequent passive requests reuse them.

**Tile Format:** Both strategies cache PNG tiles (raster, ~15KB each).

**Tile Expiration:** Workbox's expiration policy stores up to 500 tiles, each valid for 30 days. Pre-downloaded tiles follow the same expiration, so old maps can be manually refreshed.

## Related Decisions
- [ADR-004: Local-Only Data](ADR-004-local-only-data.md) — Offline data is stored entirely locally using the Cache API, consistent with the local-only principle
- [ADR-003: offsetHeight for iOS Safari Snap-Points](ADR-003-offsetheight-ios-safari.md) — The offline pre-download UI is implemented in the bottom sheet, which uses offsetHeight for snap-point calculations
