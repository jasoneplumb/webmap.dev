/**
 * Intent: Client-side hillshade computed from Terrarium elevation tiles with a
 *         south-east sun (azimuth 150°), so shading matches the real shadows in
 *         the Satellite base's imagery (~10:30 am capture, northern hemisphere)
 * Context: Replaces the pre-rendered Esri World Hillshade, whose fixed NW light
 *          is roughly opposite the imagery's sun and can't be re-lit client-side
 *          (the NW-facing range is compressed into a few near-white values)
 * Pattern: Pure decode/shade functions (unit-tested) + a Leaflet GridLayer that
 *          fetches AWS Open Data Terrarium tiles (free, key-less, z0–15) and
 *          paints shaded canvas tiles; overzoom past 15 crops the z15 ancestor,
 *          with shaded ancestors cached so sibling subtiles don't recompute.
 *          Decoded elevation is cached separately from the shading it feeds —
 *          elevation doesn't depend on the sun, so changing azimuth re-shades
 *          from memory instead of re-downloading (Terrarium isn't SW-cached).
 *          Both caches hold the pending promise, so concurrent callers for one
 *          tile share a single download. Downloads are deliberately NOT
 *          cancelled on pan-away: a shared request can't be attributed to one
 *          tile, and a completed fetch is kept for the pan back (see below).
 *          Shade is normalized to neutral mid-gray on flat terrain for the
 *          overlay blend: sun-facing slopes LIGHTEN the base, shadowed darken
 * Future: Azimuth is fixed; southern-hemisphere imagery is sunlit from the north,
 *         so a latitude-dependent azimuth flip is a possible refinement.
 *         Panning fast over new ground queues downloads that are no longer
 *         wanted; if that shows up on cellular, gate new fetches on the tile
 *         still being current rather than reinstating per-tile abort.
 */
import L from 'leaflet';

export const HILLSHADE_AZIMUTH_DEG = 150; // SSE — matches mid-morning imagery sun
export const HILLSHADE_NW_AZIMUTH_DEG = 315; // classic cartographic convention
export const HILLSHADE_ALTITUDE_DEG = 45;
// Highlights at half strength: full-range overlay lightening blows out already
// bright base pixels (snow, pale rock); shadows keep their full range.
export const HILLSHADE_HIGHLIGHT_GAIN = 0.5;

const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const TERRARIUM_MAX_ZOOM = 15;
const TILE_PX = 256;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Decode one Terrarium pixel to meters: (r*256 + g + b/256) - 32768. */
export function terrariumToMeters(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Ground meters per pixel for a 256px tile at this zoom/latitude. */
export function metersPerPixel(zoom: number, latDeg: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((latDeg * Math.PI) / 180)) / (TILE_PX * Math.pow(2, zoom));
}

/** Latitude of a tile row's center (Web Mercator). */
export function tileCenterLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/**
 * Horn hillshade over an elevation grid, normalized so flat terrain is neutral
 * mid-gray (128) — the value the overlay blend passes through untouched. Slopes
 * facing the sun map above 128 (lightening the base); slopes facing away map
 * below (darkening it). Border pixels reuse their nearest interior gradient
 * (replicate padding) — a one-pixel approximation that avoids fetching
 * neighbor tiles.
 */
export function shadeElevationGrid(
  elev: Float32Array,
  width: number,
  height: number,
  cellSizeM: number,
  azimuthDeg: number = HILLSHADE_AZIMUTH_DEG,
  altitudeDeg: number = HILLSHADE_ALTITUDE_DEG,
): Uint8ClampedArray {
  const zenith = ((90 - altitudeDeg) * Math.PI) / 180;
  // Convert compass azimuth (clockwise from north) to math angle (counter-clockwise from east)
  const azimuthMath = ((360 - azimuthDeg + 90) % 360) * (Math.PI / 180);
  const cosZenith = Math.cos(zenith);
  const sinZenith = Math.sin(zenith);
  const out = new Uint8ClampedArray(width * height);

  const at = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
    const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
    return elev[cy * width + cx] as number;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Horn's method: 3×3 weighted differences
      const dzdx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))) /
        (8 * cellSizeM);
      const dzdy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))) /
        (8 * cellSizeM);
      const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade =
        cosZenith * Math.cos(slope) + sinZenith * Math.sin(slope) * Math.cos(azimuthMath - aspect);
      // Piecewise-linear normalization around flat (shade = cosZenith) → 0.5:
      // sun-facing [cosZenith..1] maps to [0.5..0.5+gain/2] (damped highlights),
      // away-facing [0..cosZenith] to [0..0.5] (full-range shadows)
      const v =
        shade >= cosZenith
          ? 0.5 + (HILLSHADE_HIGHLIGHT_GAIN * 0.5 * (shade - cosZenith)) / (1 - cosZenith)
          : (0.5 * Math.max(0, shade)) / cosZenith;
      out[y * width + x] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    }
  }
  return out;
}

/** Decode a Terrarium RGBA buffer into meters. */
export function decodeTerrarium(rgba: Uint8ClampedArray, pixelCount: number): Float32Array {
  const elev = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    elev[i] = terrariumToMeters(
      rgba[i * 4] as number,
      rgba[i * 4 + 1] as number,
      rgba[i * 4 + 2] as number,
    );
  }
  return elev;
}

/**
 * GridLayer that paints SE-lit hillshade tiles from Terrarium elevation data.
 * Past z15 (Terrarium's max) the z15 ancestor is shaded, then the child's
 * quadrant is cropped and scaled — mirroring TileLayer's maxNativeZoom behavior.
 */
const ANCESTOR_CACHE_MAX = 24; // ~6 MB of shaded 256px canvases at worst
export const ELEV_CACHE_MAX = 24; // ~6 MB of 256×256 Float32 elevation grids at worst

/** LRU read: a hit re-inserts, so eviction targets the least-recently-*used* entry. */
function lruGet<V>(cache: Map<string, V>, key: string): V | undefined {
  const entry = cache.get(key);
  if (entry === undefined) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

/** LRU write: evicts the least-recently-used entry once the cache is at capacity. */
function lruSet<V>(cache: Map<string, V>, key: string, value: V, max: number): void {
  cache.delete(key);
  if (cache.size >= max) {
    // Map preserves insertion order and hits re-insert, so the first key is the LRU one
    const lru = cache.keys().next().value;
    if (lru !== undefined) cache.delete(lru);
  }
  cache.set(key, value);
}

export class HillshadeLayer extends L.GridLayer {
  private azimuthDeg = HILLSHADE_AZIMUTH_DEG;
  // Shaded z≤15 ancestors shared by overzoomed subtiles (up to 256 siblings at
  // z19 share one z15 ancestor) — cached so the Horn pass runs once.
  // Keyed by tile path only: setAzimuth clears the cache, so entries never mix suns.
  private ancestorCache = new Map<string, Promise<HTMLCanvasElement>>();
  // Decoded elevation per native tile. Elevation is sun-independent, so this
  // SURVIVES setAzimuth — that's what keeps re-lighting off the network.
  // Holds the PENDING promise, inserted before the fetch starts, so every
  // caller for a tile shares one request: a directly-visible z≤15 tile and an
  // overzoomed descendant's ancestor lookup can both want the same tile at once.
  private elevCache = new Map<string, Promise<Float32Array>>();

  /**
   * Switch the sun direction and re-render all visible tiles. Only the shaded
   * output is invalidated — the elevation it was computed from is kept, so the
   * repaint runs off cached data and never re-downloads.
   */
  setAzimuth(azimuthDeg: number): void {
    if (azimuthDeg === this.azimuthDeg) return;
    this.azimuthDeg = azimuthDeg;
    this.ancestorCache.clear();
    this.redraw();
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('canvas');
    tile.width = TILE_PX;
    tile.height = TILE_PX;
    void this.paintTile(tile, coords)
      .then(() => done(undefined, tile))
      .catch((err: Error) => done(err, tile));
    return tile;
  }

  /**
   * Decoded elevation for a native-zoom tile, shared by every caller. Not async:
   * the pending promise must reach the cache before the first await, or two
   * callers racing the same tile would each start a download.
   */
  private getElevation(z: number, x: number, y: number): Promise<Float32Array> {
    const key = `${z}/${x}/${y}`;
    const cached = lruGet(this.elevCache, key);
    if (cached) return cached;

    const entry = this.fetchElevation(z, x, y).catch((err: Error) => {
      this.elevCache.delete(key); // allow retry after a failed fetch
      throw err;
    });
    lruSet(this.elevCache, key, entry, ELEV_CACHE_MAX);
    return entry;
  }

  /**
   * Download and decode one Terrarium tile. The scratch canvas used to read the
   * PNG's pixels is dropped once decoded — only the Float32 grid is retained,
   * and it outlives any sun-direction change.
   */
  private async fetchElevation(z: number, x: number, y: number): Promise<Float32Array> {
    const resp = await fetch(`${TERRARIUM_URL}/${z}/${x}/${y}.png`);
    if (!resp.ok) throw new Error(`terrarium tile ${z}/${x}/${y}: HTTP ${resp.status}`);
    const bitmap = await createImageBitmap(await resp.blob());

    const src = document.createElement('canvas');
    src.width = TILE_PX;
    src.height = TILE_PX;
    const srcCtx = src.getContext('2d');
    if (!srcCtx) throw new Error('no 2d context');
    srcCtx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const rgba = srcCtx.getImageData(0, 0, TILE_PX, TILE_PX).data;
    return decodeTerrarium(rgba, TILE_PX * TILE_PX);
  }

  /** Shade a Terrarium tile under the current sun. */
  private async fetchAndShade(z: number, x: number, y: number): Promise<HTMLCanvasElement> {
    const elev = await this.getElevation(z, x, y);
    const shade = shadeElevationGrid(
      elev, TILE_PX, TILE_PX, metersPerPixel(z, tileCenterLat(y, z)), this.azimuthDeg,
    );

    const out = document.createElement('canvas');
    out.width = TILE_PX;
    out.height = TILE_PX;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('no 2d context');

    const gray = ctx.createImageData(TILE_PX, TILE_PX);
    for (let i = 0; i < shade.length; i++) {
      const v = shade[i] as number;
      gray.data[i * 4] = v;
      gray.data[i * 4 + 1] = v;
      gray.data[i * 4 + 2] = v;
      gray.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(gray, 0, 0);
    return out;
  }

  /** Cached shaded ancestor, shared by every overzoomed subtile that crops it. */
  private getShadedAncestor(z: number, x: number, y: number): Promise<HTMLCanvasElement> {
    const key = `${z}/${x}/${y}`;
    const cached = lruGet(this.ancestorCache, key);
    if (cached) return cached;

    const entry = this.fetchAndShade(z, x, y).catch((err: Error) => {
      this.ancestorCache.delete(key); // allow retry after a failed fetch
      throw err;
    });
    lruSet(this.ancestorCache, key, entry, ANCESTOR_CACHE_MAX);
    return entry;
  }

  private async paintTile(tile: HTMLCanvasElement, coords: L.Coords): Promise<void> {
    const dz = Math.max(0, coords.z - TERRARIUM_MAX_ZOOM);
    const scale = Math.pow(2, dz);
    const ctx = tile.getContext('2d');
    if (!ctx) throw new Error('no 2d context');

    if (dz === 0) {
      const src = await this.fetchAndShade(coords.z, coords.x, coords.y);
      ctx.drawImage(src, 0, 0);
    } else {
      const src = await this.getShadedAncestor(
        coords.z - dz, Math.floor(coords.x / scale), Math.floor(coords.y / scale),
      );
      const subSize = TILE_PX / scale;
      const subX = (coords.x % scale) * subSize;
      const subY = (coords.y % scale) * subSize;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(src, subX, subY, subSize, subSize, 0, 0, TILE_PX, TILE_PX);
    }
  }
}

export function createHillshadeLayer(options: L.GridLayerOptions): HillshadeLayer {
  return new HillshadeLayer(options);
}
