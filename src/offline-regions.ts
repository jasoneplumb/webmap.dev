/**
 * Intent: Saved offline regions — the manifest of deliberately pre-downloaded areas,
 *         the tile math that turns a bounds+zoom selection into tile URLs per layer,
 *         and the storage-persistence helpers that protect those tiles from eviction.
 * Context: Pre-downloaded tiles live in REGION_TILE_CACHE_NAME (see sw-constants.ts),
 *          NOT in the passive caches, so the passive routes' ExpirationPlugin can never
 *          silently evict a region the user deliberately saved (#303). Only providers
 *          whose terms allow bulk download are offered here: OSM Streets (existing
 *          precedent) and Terrarium elevation (AWS Open Data) for the Hillshade
 *          overlay. Thunderforest, Esri, osm.fr and Waymarked stay passive-only.
 * Pattern: Pure functions (unit-tested) + a thin localStorage-backed manifest.
 *          Overlapping regions share tile URLs; deleting one region deletes shared
 *          tiles too — documented in ADR-007 rather than refcounted.
 */

// ── Region model ─────────────────────────────────────────────────────────────

/** Plain serializable bounds — L.LatLngBounds is not JSON-safe. */
export interface RegionBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Layers whose providers permit bulk pre-download. */
export type RegionLayerId = 'streets' | 'hillshade';

export interface SavedRegion {
  id: string;
  name: string;
  bounds: RegionBounds;
  zMin: number;
  zMax: number;
  layers: RegionLayerId[];
  tileCount: number;
  bytes: number;
  createdAt: number;
}

export interface RegionLayerMeta {
  label: string;
  avgTileBytes: number;
  /** Provider's native zoom ceiling — requests above it are clamped, not skipped. */
  maxNativeZoom: number;
}

/** Terrarium elevation tops out at z15; the hillshade layer overzooms by cropping
 *  the z15 ancestor (see hillshade.ts paintTile), so saving past 15 buys nothing. */
export const TERRARIUM_MAX_ZOOM = 15;

export const REGION_LAYERS: Record<RegionLayerId, RegionLayerMeta> = {
  // ~15 KB average OSM PNG (measured; matches the long-standing estimate constant).
  streets: { label: 'Streets (OSM)', avgTileBytes: 15_000, maxNativeZoom: 18 },
  // Terrarium elevation PNGs run ~40-60 KB (see the cache-budget note in sw.ts).
  hillshade: { label: 'Hillshade terrain', avgTileBytes: 50_000, maxNativeZoom: TERRARIUM_MAX_ZOOM },
};

// ── Tile coordinate math (pure) ──────────────────────────────────────────────

export function lng2tile(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}

export function lat2tile(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      Math.pow(2, z),
  );
}

export interface TileRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export function getTileRange(bounds: RegionBounds, z: number): TileRange {
  const maxTile = Math.pow(2, z) - 1;
  return {
    xMin: Math.max(0, lng2tile(bounds.west, z)),
    xMax: Math.min(maxTile, lng2tile(bounds.east, z)),
    yMin: Math.max(0, lat2tile(bounds.north, z)), // north edge has the smaller y
    yMax: Math.min(maxTile, lat2tile(bounds.south, z)),
  };
}

/** Clamp a requested zoom range to a layer's native ceiling. A range that starts
 *  above the ceiling collapses onto it (z16-18 hillshade → z15 alone) so the layer
 *  still gets its best-available data rather than nothing. */
export function clampZoomRange(
  zMin: number,
  zMax: number,
  maxNativeZoom: number,
): { zMin: number; zMax: number } {
  return { zMin: Math.min(zMin, maxNativeZoom), zMax: Math.min(zMax, maxNativeZoom) };
}

export function countTiles(bounds: RegionBounds, zMin: number, zMax: number): number {
  let total = 0;
  for (let z = zMin; z <= zMax; z++) {
    const r = getTileRange(bounds, z);
    total += (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);
  }
  return total;
}

// ── Tile URL generation (pure) ───────────────────────────────────────────────

const OSM_SUBDOMAINS = ['a', 'b', 'c'] as const;

/** Mirror Leaflet's TileLayer._getSubdomain — `abs(x + y) % subdomains.length` — so a
 *  pre-downloaded tile sits under the exact URL Leaflet will request. (The service
 *  worker's region lookup additionally tries all subdomain variants, but a direct
 *  hit skips that work; see osmTileUrlVariants in sw-constants.ts.) */
export function osmTileUrl(x: number, y: number, z: number): string {
  const sub = OSM_SUBDOMAINS[Math.abs(x + y) % OSM_SUBDOMAINS.length];
  return `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

/** Must stay byte-identical to TERRARIUM_URL in hillshade.ts — the SW region lookup
 *  matches the exact URL the hillshade layer fetches. */
export function terrariumTileUrl(x: number, y: number, z: number): string {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
}

export function tileUrlsForLayer(
  layer: RegionLayerId,
  bounds: RegionBounds,
  zMin: number,
  zMax: number,
): string[] {
  const clamped = clampZoomRange(zMin, zMax, REGION_LAYERS[layer].maxNativeZoom);
  const build = layer === 'streets' ? osmTileUrl : terrariumTileUrl;
  const urls: string[] = [];
  for (let z = clamped.zMin; z <= clamped.zMax; z++) {
    const r = getTileRange(bounds, z);
    for (let x = r.xMin; x <= r.xMax; x++) {
      for (let y = r.yMin; y <= r.yMax; y++) {
        urls.push(build(x, y, z));
      }
    }
  }
  return urls;
}

export interface LayerEstimate {
  layer: RegionLayerId;
  tiles: number;
  bytes: number;
}

export function estimateLayers(
  layers: RegionLayerId[],
  bounds: RegionBounds,
  zMin: number,
  zMax: number,
): LayerEstimate[] {
  return layers.map((layer) => {
    const meta = REGION_LAYERS[layer];
    const clamped = clampZoomRange(zMin, zMax, meta.maxNativeZoom);
    const tiles = countTiles(bounds, clamped.zMin, clamped.zMax);
    return { layer, tiles, bytes: tiles * meta.avgTileBytes };
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Manifest persistence ─────────────────────────────────────────────────────

const REGIONS_STORAGE_KEY = 'webmap-offline-regions';

function isRegionBounds(value: unknown): value is RegionBounds {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b['south'] === 'number' &&
    typeof b['west'] === 'number' &&
    typeof b['north'] === 'number' &&
    typeof b['east'] === 'number'
  );
}

function isSavedRegion(value: unknown): value is SavedRegion {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' &&
    typeof r['name'] === 'string' &&
    typeof r['zMin'] === 'number' &&
    typeof r['zMax'] === 'number' &&
    Array.isArray(r['layers']) &&
    r['layers'].every((l) => typeof l === 'string' && l in REGION_LAYERS) &&
    isRegionBounds(r['bounds'])
  );
}

export function loadRegions(): SavedRegion[] {
  try {
    const raw = localStorage.getItem(REGIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedRegion);
  } catch {
    return []; // localStorage unavailable or corrupt — regions still exist in cache
  }
}

function saveRegions(regions: SavedRegion[]): void {
  try {
    localStorage.setItem(REGIONS_STORAGE_KEY, JSON.stringify(regions));
  } catch {
    // localStorage unavailable — the tiles are cached regardless; only the
    // manifest listing is lost.
  }
}

/** Next auto-name: "Region 1", "Region 2", … past the highest existing number.
 *  Matches the optional " (partial)" suffix too, so a region saved partial doesn't
 *  leave its number free for a later full download to collide with. */
export function nextRegionName(existing: SavedRegion[]): string {
  let max = 0;
  for (const r of existing) {
    const m = /^Region (\d+)(?: \(partial\))?$/.exec(r.name);
    if (m?.[1]) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Region ${max + 1}`;
}

export function addRegion(region: SavedRegion): SavedRegion[] {
  const regions = [...loadRegions(), region];
  saveRegions(regions);
  return regions;
}

export function removeRegion(id: string): SavedRegion[] {
  const regions = loadRegions().filter((r) => r.id !== id);
  saveRegions(regions);
  return regions;
}

/** True when any saved region includes the given layer — drives the layers-popover
 *  offline badges and the offline tile-error toast copy. */
export function hasSavedLayer(layer: RegionLayerId, regions = loadRegions()): boolean {
  return regions.some((r) => r.layers.includes(layer));
}

// ── Storage persistence / estimate ───────────────────────────────────────────

/** Ask the browser not to evict our origin's storage under pressure. Safe to call
 *  repeatedly — the browser remembers a grant. Returns false where unsupported. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!('storage' in navigator) || typeof navigator.storage.persist !== 'function') {
      return false;
    }
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!('storage' in navigator) || typeof navigator.storage.estimate !== 'function') {
      return null;
    }
    const est = await navigator.storage.estimate();
    if (typeof est.usage !== 'number' || typeof est.quota !== 'number') return null;
    return { usage: est.usage, quota: est.quota };
  } catch {
    return null;
  }
}
