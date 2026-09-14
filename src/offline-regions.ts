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

/** Wrap a longitude into [-180, 180].
 *
 *  Leaflet's `getBounds()` reports unwrapped longitudes once the user has panned across the
 *  antimeridian — west can read -181, or east 190. Feeding those straight to lng2tile is
 *  how a rectangle the size of a town becomes a download of every tile column on Earth:
 *  lng2tile(-181) is negative, Math.max(0, …) snaps xMin to 0, and the range runs from the
 *  left edge of the world to wherever east lands. The mirror case (west 190) produces
 *  xMin > xMax, a negative tile count, a negative size estimate, and a "successful"
 *  download that fetches nothing at all. */
export function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Whether a selection spans the antimeridian once its longitudes are wrapped.
 *
 *  A single x-range cannot express that span — it would have to be two ranges, one either
 *  side of 180. Rather than guess which half the user meant, or sweep the whole world,
 *  callers refuse the selection and say why. */
export function crossesAntimeridian(bounds: RegionBounds): boolean {
  return normalizeLng(bounds.west) > normalizeLng(bounds.east);
}

export function getTileRange(bounds: RegionBounds, z: number): TileRange {
  const maxTile = Math.pow(2, z) - 1;
  const west = normalizeLng(bounds.west);
  const east = normalizeLng(bounds.east);
  const clamp = (v: number): number => Math.max(0, Math.min(maxTile, v));
  // A crossing selection is rejected upstream (crossesAntimeridian); clamping here keeps
  // the range coherent — empty rather than world-sized — if one ever reaches this far.
  const xMin = clamp(lng2tile(west, z));
  const xMax = clamp(lng2tile(east, z));
  return {
    xMin,
    xMax: Math.max(xMin - 1, xMax), // xMin-1 encodes "no columns" for countTiles
    yMin: clamp(lat2tile(bounds.north, z)), // north edge has the smaller y
    yMax: clamp(lat2tile(bounds.south, z)),
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
    // max(0, …): an empty range must contribute nothing rather than a negative count that
    // silently cancels out other zoom levels in the estimate.
    total += Math.max(0, r.xMax - r.xMin + 1) * Math.max(0, r.yMax - r.yMin + 1);
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
    // The numeric display fields are validated too: a hand-edited or schema-drifted entry
    // with a non-numeric bytes renders as "NaN MB" in the manager rather than being
    // dropped like every other malformed row. Finite, not merely number — NaN is a number.
    Number.isFinite(r['tileCount']) &&
    Number.isFinite(r['bytes']) &&
    Number.isFinite(r['createdAt']) &&
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

/** Marks a region whose download was stopped before it finished. Dropped by mergeRegions
 *  once a later run completes the same coverage. */
export const PARTIAL_SUFFIX = ' (partial)';

function stripPartial(name: string): string {
  return name.endsWith(PARTIAL_SUFFIX) ? name.slice(0, -PARTIAL_SUFFIX.length) : name;
}

/** Next auto-name: "Region 1", "Region 2", … past the highest existing number.
 *  Matches the optional " (partial)" suffix too, so a region saved partial doesn't
 *  leave its number free for a later full download to collide with. */
export function nextRegionName(existing: SavedRegion[]): string {
  let max = 0;
  for (const r of existing) {
    // Strip the marker rather than encoding it in the pattern, so PARTIAL_SUFFIX stays the
    // one definition of that string.
    const m = /^Region (\d+)$/.exec(stripPartial(r.name));
    if (m?.[1]) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Region ${max + 1}`;
}

/** Fold a download into the entry that already covers the same footprint: union the layers,
 *  keep the row's identity, and take the better of the two size estimates.
 *
 *  `id` and `createdAt` stay on the original — the coverage was created then, and the id is
 *  the handle the manager's Delete button already carries.
 *
 *  `bytes`/`tileCount` depend on whether the merge changes the layer set. Same layers: take
 *  the maximum, since both totals count the same tiles and the larger is the honest "at
 *  least this much is held". Different layers: the totals count different tiles, so they are
 *  apportioned per layer and recombined (see combineSizeByLayer) — comparing them would drop
 *  a whole layer's estimate from the row.
 *
 *  The "(partial)" marker is recomputed per layer rather than carried over, because a merge
 *  can now add layers. A layer both runs covered is complete once either run finished; a
 *  layer only one run covered is only as complete as that run. Any layer still partial
 *  leaves the marker on. With identical layer sets this reduces to the obvious rule — a
 *  finished re-download clears the marker, and a run stopped early cannot un-download what
 *  an earlier complete run wrote.
 *
 *  One marker covers the whole row, so once set it no longer says which layer set it. A run
 *  that covers only some of the row's layers therefore cannot clear it; only a run covering
 *  all of them can. That errs towards reporting a complete region as partial, never the
 *  reverse — the direction that cannot send someone offline on coverage they do not have.
 *  Per-layer completeness would need a manifest schema change and a migration. */
function sameLayerSet(a: RegionLayerId[], b: RegionLayerId[]): boolean {
  return a.length === b.length && a.every((l) => b.includes(l));
}

/** Split a row's recorded totals back across the layers it carries, in proportion to what a
 *  full download of each would weigh.
 *
 *  The manifest stores one bytes/tileCount per row, not per layer, so a merge that adds a
 *  layer has no per-layer figure to add to. startDownload spreads a run's succeeded-tile
 *  count evenly across the layers it fetched (its avgBytes); this reverses that, assuming
 *  the same uniform completion, which is the most the stored fields can support. */
function perLayerShare(r: SavedRegion): Map<RegionLayerId, { tiles: number; bytes: number }> {
  const full = estimateLayers(r.layers, r.bounds, r.zMin, r.zMax);
  const fullTiles = full.reduce((sum, e) => sum + e.tiles, 0);
  // Clamped: a row whose stored count drifted above what the footprint can hold must not
  // inflate the share past a complete download.
  const ratio = fullTiles > 0 ? Math.min(1, r.tileCount / fullTiles) : 0;
  return new Map(full.map((e) => [e.layer, { tiles: e.tiles * ratio, bytes: e.bytes * ratio }]));
}

/** Per-layer maximum, summed over the union — for merges whose layer sets differ.
 *
 *  A layer both rows carry describes the same tiles either side, so the fuller side wins.
 *  A layer only one row carries is additional coverage and has to be added; the absent
 *  side contributes zero, which is what makes one Math.max cover both cases. */
function combineSizeByLayer(
  existing: SavedRegion,
  incoming: SavedRegion,
  layers: RegionLayerId[],
): { tileCount: number; bytes: number } {
  const a = perLayerShare(existing);
  const b = perLayerShare(incoming);
  let tiles = 0;
  let bytes = 0;
  for (const l of layers) {
    tiles += Math.max(a.get(l)?.tiles ?? 0, b.get(l)?.tiles ?? 0);
    bytes += Math.max(a.get(l)?.bytes ?? 0, b.get(l)?.bytes ?? 0);
  }
  return { tileCount: Math.round(tiles), bytes: Math.round(bytes) };
}

export function mergeRegions(existing: SavedRegion, incoming: SavedRegion): SavedRegion {
  const existingPartial = existing.name.endsWith(PARTIAL_SUFFIX);
  const incomingPartial = incoming.name.endsWith(PARTIAL_SUFFIX);
  const layers = unionLayers(existing.layers, incoming.layers);
  const partial = layers.some((l) => {
    const inExisting = existing.layers.includes(l);
    const inIncoming = incoming.layers.includes(l);
    if (inExisting && inIncoming) return existingPartial && incomingPartial;
    return inExisting ? existingPartial : incomingPartial;
  });
  const base = stripPartial(existing.name);
  const size = sameLayerSet(existing.layers, incoming.layers)
    // The same layers over the same footprint: both totals count the same tiles, so the
    // larger is the honest "at least this much is held". An aborted re-run of an
    // already-complete region reports fewer succeeded tiles than the region still holds,
    // and writing that in would shrink the row for a download that removed nothing.
    ? {
      tileCount: Math.max(existing.tileCount, incoming.tileCount),
      bytes: Math.max(existing.bytes, incoming.bytes),
    }
    // Different layer sets: the totals count different tiles and cannot be compared. Taking
    // the larger would drop the smaller side's layers from the figure altogether — save
    // Streets (~1.5 MB), then save Hillshade (~5 MB) over the same rectangle, and the row
    // would read 5 MB rather than 6.5 MB. The delete confirmation quotes this number as its
    // safety signal, so it must not under-report what deletion frees.
    : combineSizeByLayer(existing, incoming, layers);
  return {
    // Keeping existing's raw zMin/zMax is safe because isSameFootprint has already checked
    // that it clamps to the same per-layer range as incoming's, for every layer either side
    // carries — including a layer only incoming brings. So the kept range still describes
    // the newly-merged layer's fetched tiles when deleteRegion recomputes URLs from it.
    ...existing,
    name: partial ? base + PARTIAL_SUFFIX : base,
    layers,
    ...size,
  };
}

/** Append a region to the manifest — or merge it into the entry that already covers the
 *  same footprint.
 *
 *  The invariant: at most one entry per (bounds, zoom) footprint, carrying the union of
 *  every layer saved over it.
 *
 *  Re-downloading an area (to resume a stopped run, or to restore coverage a sibling's
 *  delete took with it — ADR-007 tells users to do exactly that) used to append a second
 *  entry under a fresh id. The duplicates are not cosmetic: deleteRegion recomputes tile
 *  URLs from bounds/zoom/layers and deletes them from the shared region cache, so deleting
 *  either twin empties the tiles the other still lists. The survivor goes on reading as
 *  fully saved in the manager, and the gap surfaces only when the user is offline on that
 *  ground with no way left to re-download it.
 *
 *  Limitation: matching is on bounds, not on the tile ranges they resolve to. Two
 *  hand-drawn rectangles a hair apart can cover identical tiles and still be filed as two
 *  regions. The paths that actually produce duplicates — pressing Download again, or adding
 *  a layer — reuse the selection still on screen and so reuse the same bounds. Closing the
 *  near-miss case means comparing per-zoom tile ranges instead; cheap enough, but it also
 *  changes what isCoveredBySavedRegion means, so it is left for its own change.
 *
 *  Partial overlap between different rectangles is out of scope by design: ADR-007 accepts
 *  that deleting one of two overlapping regions thins the other. What must not happen is two
 *  rows describing the SAME ground, where one delete silently empties a row that goes on
 *  claiming full coverage. */
export function addRegion(region: SavedRegion): SavedRegion[] {
  const existing = loadRegions();
  const idx = existing.findIndex((r) => isSameFootprint(r, region));
  const regions = idx === -1
    ? [...existing, region]
    : existing.map((r, i) => (i === idx ? mergeRegions(r, region) : r));
  saveRegions(regions);
  return regions;
}

export function removeRegion(id: string): SavedRegion[] {
  const regions = loadRegions().filter((r) => r.id !== id);
  saveRegions(regions);
  return regions;
}

/** Inverse of lng2tile / lat2tile: the north-west corner of a tile, in degrees. */
export function tile2lng(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

export function tile2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** True when a saved region carrying `layer` actually contains this tile.
 *
 *  hasSavedLayer only answers "is that layer saved anywhere", which is the wrong question
 *  for the offline tile-error toast: someone who saved Yosemite and then rides in Tahoe was
 *  told their saved regions covered the area, switched base layers on that promise, and
 *  found nothing. The manifest has the bounds, so the toast can check where the user
 *  actually is. */
export function savedRegionCoversTile(
  layer: RegionLayerId,
  x: number,
  y: number,
  z: number,
  regions = loadRegions(),
): boolean {
  // The tile's north-west corner is enough: a region containing any part of the tile is
  // coverage worth pointing at, and the corner is the cheapest representative point.
  const lng = normalizeLng(tile2lng(x, z));
  const lat = tile2lat(y, z);
  // Same clamping rule as isCoveredBySavedRegion: a hillshade region saved at z10-18 holds
  // tiles through z15 only, so it cannot answer for z17 however the slider was set.
  const ceiling = REGION_LAYERS[layer].maxNativeZoom;
  return regions.some((r) => {
    const held = clampZoomRange(r.zMin, r.zMax, ceiling);
    return r.layers.includes(layer) &&
      held.zMin <= Math.min(z, ceiling) && held.zMax >= Math.min(z, ceiling) && z <= ceiling &&
      normalizeLng(r.bounds.west) <= lng && normalizeLng(r.bounds.east) >= lng &&
      r.bounds.south <= lat && r.bounds.north >= lat;
  });
}

/** True when any saved region includes the given layer — drives the layers-popover
 *  offline badges and the offline tile-error toast copy. */
export function hasSavedLayer(layer: RegionLayerId, regions = loadRegions()): boolean {
  return regions.some((r) => r.layers.includes(layer));
}

/** The fields that decide which tiles a region actually holds. `SavedRegion` satisfies it
 *  structurally; a not-yet-saved selection can be described with the same shape. */
export interface RegionCoverage {
  bounds: RegionBounds;
  layers: RegionLayerId[];
  zMin: number;
  zMax: number;
}

/** True when `outer` holds every tile `inner` needs: its bounds contain inner's, it carries
 *  every layer inner asks for, and per layer its zoom range spans inner's.
 *
 *  The single place coverage is compared — `isCoveredBySavedRegion` asks it one way and
 *  `isSameFootprint` asks it both ways — so the containment rule and its clamping cannot
 *  drift between the "skip a redundant row" check and the "fold into the existing row"
 *  check. Those two disagreeing is precisely how a duplicate entry gets written. */
export function coverageContains(outer: RegionCoverage, inner: RegionCoverage): boolean {
  const west = normalizeLng(inner.bounds.west);
  const east = normalizeLng(inner.bounds.east);
  return (
    // Per layer, against the zoom range that layer actually holds. The manifest stores the
    // raw slider values, but tileUrlsForLayer clamps to each layer's native ceiling before
    // fetching, so comparing the request to the stored zMin/zMax unclamped claims hillshade
    // coverage above z15 that was never downloaded.
    inner.layers.every((l) => {
      if (!outer.layers.includes(l)) return false;
      const ceiling = REGION_LAYERS[l].maxNativeZoom;
      const held = clampZoomRange(outer.zMin, outer.zMax, ceiling);
      const want = clampZoomRange(inner.zMin, inner.zMax, ceiling);
      return held.zMin <= want.zMin && held.zMax >= want.zMax;
    }) &&
    normalizeLng(outer.bounds.west) <= west && normalizeLng(outer.bounds.east) >= east &&
    outer.bounds.south <= inner.bounds.south && outer.bounds.north >= inner.bounds.north
  );
}

/** True when two selections describe the same ground at the same zoom — the same rectangle,
 *  and the same clamped zoom range for every layer either one carries.
 *
 *  Layer sets deliberately need NOT match. Two entries over one rectangle that share even a
 *  single layer also share that layer's tiles, so deleting either empties the other — the
 *  #318 failure, reached by "add Hillshade to an area I already saved Streets for" rather
 *  than by a plain re-download. Keying on the footprint and unioning the layers (see
 *  mergeRegions) collapses every such pair, and does so in one pass: were merging to
 *  require overlapping layer sets instead, Streets then Hillshade then Streets+Hillshade
 *  would fold into the first row and leave the second one duplicating it.
 *
 *  Zoom is compared per layer, after clamping, across the union of both layer sets. A
 *  hillshade region saved z10-18 and one saved z10-15 hold byte-identical tiles because
 *  tileUrlsForLayer stops at the provider ceiling; the same two ranges are genuinely
 *  different footprints once streets is in play, and stay separate rows. */
export function isSameFootprint(a: RegionCoverage, b: RegionCoverage): boolean {
  // Ask coverageContains in both directions, with both sides widened to the union of their
  // layer sets first. Containment each way over one shared layer list means equal bounds
  // and, per layer, equal clamped zoom ranges — footprint identity — while the widening
  // normalizes away the layer-set asymmetry that would otherwise make a streets-only row
  // differ from a streets+hillshade one over the same rectangle. (Mutual containment on the
  // raw layer sets is exactly that asymmetric test, which is why it cannot be used here.)
  //
  // Going through coverageContains rather than repeating the comparison is the point: the
  // clamping rule has one definition, so the coverage check and the dedupe check cannot
  // drift apart and start disagreeing about what "the same tiles" means.
  const layers = unionLayers(a.layers, b.layers);
  return coverageContains({ ...a, layers }, { ...b, layers })
    && coverageContains({ ...b, layers }, { ...a, layers });
}

/** Both layer sets, deduped, in REGION_LAYERS declaration order so a merged row's layer
 *  list does not reshuffle with the order downloads happened to arrive in. */
export function unionLayers(a: RegionLayerId[], b: RegionLayerId[]): RegionLayerId[] {
  return (Object.keys(REGION_LAYERS) as RegionLayerId[])
    .filter((l) => a.includes(l) || b.includes(l));
}

/** True when some single saved region already covers this selection outright: its bounds
 *  contain it, it carries every requested layer, and its zoom range spans the request.
 *
 *  Used to tell two zero-new-tile downloads apart. Re-downloading inside an existing region
 *  should not mint a redundant row; downloading tiles that are in the protected cache but
 *  listed nowhere — localStorage cleared while region-tiles survived — must record one, or
 *  the tiles are invisible in the manager and can never be deleted (ADR-007: this cache has
 *  no expiry, so the manifest entry is the only handle on them). */
export function isCoveredBySavedRegion(
  bounds: RegionBounds,
  layers: RegionLayerId[],
  zMin: number,
  zMax: number,
  regions = loadRegions(),
): boolean {
  return regions.some((r) => coverageContains(r, { bounds, layers, zMin, zMax }));
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
