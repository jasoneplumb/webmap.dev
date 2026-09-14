# ADR-007: Protected Region Cache for Multi-Layer Pre-Downloads

**Status:** Accepted

## Context

ADR-005's two-tier strategy stored pre-downloaded region tiles in the same cache
(`osm-tiles`) as the passive StaleWhileRevalidate route. That coupling had two
consequences:

1. **Silent eviction of saved regions.** The passive route's `ExpirationPlugin`
   (300 entries / 30 days, `purgeOnQuotaError`) governs the shared cache. Once a
   pre-downloaded tile was served through the strategy it entered the expiration
   index, and ordinary browsing could evict tiles the user deliberately saved for
   a trip. A quota error purged the entire cache — regions included.
2. **OSM-only downloads.** Pre-download built OSM URLs exclusively, so every other
   layer — including the Hillshade overlay that is part of the default Satellite
   stack — was blank offline outside passively-browsed ground. Users learned to
   stay on the Streets base while offline.

Extending bulk download to *every* provider is not a code decision: Thunderforest
prohibits pre-caching without a paid plan, Esri's terms gate bulk export behind
official APIs, and the osm.fr and Waymarked community servers discourage bulk
fetching. Terrarium elevation tiles, however, are AWS Open Data — bulk-friendly —
and they are exactly what the Hillshade overlay renders from.

## Decision

1. **A third cache, `region-tiles`, holds deliberately saved tiles.** It has **no
   ExpirationPlugin and no `purgeOnQuotaError`**: entries leave it only through the
   region manager's explicit Delete. The passive caches keep their existing LRUs.
2. **The service worker serves `region-tiles` first** on both tile routes (OSM and
   non-OSM). A saved region therefore works offline — and skips the network online —
   regardless of what the passive LRUs have evicted. OSM lookups try all three
   subdomain variants (`osmTileUrlVariants`) so writer/reader subdomain formulas can
   never drift into silent misses.
3. **Pre-download offers exactly the layers whose provider terms permit it:**
   OSM Streets and Terrarium elevation (Hillshade), selected per download with
   per-layer size estimates. Terrarium URLs are clamped to its native z15; the
   hillshade layer already overzooms by cropping the z15 ancestor.
4. **A saved-region manifest** (`webmap-offline-regions` in localStorage) records
   bounds, zoom range, layers, and size per region. It drives the download panel's
   region manager (list + delete), the layers-popover offline badges, and the
   offline tile-error toast copy. **It holds at most one entry per (bounds,
   zoom) footprint, carrying the union of every layer saved over it**:
   re-downloading an area, or adding a layer to one, folds into the existing
   row rather than appending a second. Because delete recomputes tile URLs
   from bounds/zoom/layers, two rows describing the same ground would delete
   each other's tiles while both still claimed to hold them (#318). Partial
   overlap between *different* rectangles stays as Alternative 2 below
   describes it — accepted, and documented to the user.
5. **Deleting a region is confirmed.** It is irreversible — this cache has no
   expiry and no other reclamation path — and it can thin an overlapping region
   too, so a single mis-tap in the mobile panel is not treated as consent.
6. **`navigator.storage.persist()` is requested before each download** so the
   browser treats the origin's storage as non-evictable where supported; the result
   is surfaced in the completion toast when declined.

## Alternatives Considered

1. **Widen the passive caches' `maxEntries` instead** — still couples deliberate
   saves to incidental browsing; a big region plus a long pan session still evicts.
2. **Refcount shared tiles across overlapping regions** — deleting one region
   currently deletes tiles an overlapping region also covers. Refcounting fixes
   that at the cost of an index that must stay consistent with the cache under
   crashes. Overlap is rare and re-downloading skips cached tiles, so the simple
   semantics won; the region manager documents it.
3. **Bulk-download every layer and let users opt in** — violates provider terms
   (see Context). Passive caching remains the only offline path for those layers,
   stated in the download panel rather than hidden.

## Consequences

- Saved regions survive passive-cache churn, quota purges, and (where the browser
  grants persistence) storage pressure.
- Hillshade — half of the default base stack — now works offline inside saved
  regions, and the layers popover shows per-layer offline coverage honestly.
- Tiles inside saved regions are effectively CacheFirst even online; imagery
  refreshes only when the user re-downloads the region. Acceptable for map data
  that changes on a scale of months; a future "refresh region" action can force it.
- Deleting overlapping regions can remove shared tiles (see Alternatives, 2).

## Related Decisions

- [ADR-005: Two-Tier Offline Tile Strategy](ADR-005-offline-tile-strategy.md) —
  this ADR splits the deliberate tier out of the passive tier's cache and extends
  it beyond OSM.
- [ADR-004: Local-Only Data](ADR-004-local-only-data.md) — the manifest and all
  tiles remain on-device.
