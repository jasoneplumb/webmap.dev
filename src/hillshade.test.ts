import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import L from 'leaflet';
import {
  ELEV_CACHE_MAX,
  HILLSHADE_AZIMUTH_DEG,
  HILLSHADE_NW_AZIMUTH_DEG,
  type HillshadeLayer,
  createHillshadeLayer,
  decodeTerrarium,
  metersPerPixel,
  shadeElevationGrid,
  terrariumToMeters,
  tileCenterLat,
} from './hillshade';

describe('terrariumToMeters', () => {
  it('decodes the documented encoding: (r*256 + g + b/256) - 32768', () => {
    expect(terrariumToMeters(128, 0, 0)).toBe(0); // sea level
    expect(terrariumToMeters(128, 100, 0)).toBe(100);
    expect(terrariumToMeters(127, 156, 0)).toBe(-100);
    expect(terrariumToMeters(128, 0, 128)).toBe(0.5); // blue = fractional meters
  });
});

describe('decodeTerrarium', () => {
  it('decodes RGBA pixels, ignoring alpha', () => {
    const rgba = new Uint8ClampedArray([128, 0, 0, 255, 128, 200, 0, 255]);
    const elev = decodeTerrarium(rgba, 2);
    expect(Array.from(elev)).toEqual([0, 200]);
  });
});

describe('metersPerPixel', () => {
  it('halves with each zoom level and shrinks toward the poles', () => {
    const z10 = metersPerPixel(10, 0);
    expect(metersPerPixel(11, 0)).toBeCloseTo(z10 / 2, 6);
    expect(metersPerPixel(10, 60)).toBeCloseTo(z10 / 2, 6); // cos(60°) = 0.5
  });
});

describe('tileCenterLat', () => {
  it('is 0 at the equator row and symmetric north/south', () => {
    // z1 has two rows; their centers straddle the equator symmetrically
    expect(tileCenterLat(0, 1)).toBeCloseTo(-tileCenterLat(1, 1), 6);
    expect(tileCenterLat(0, 1)).toBeGreaterThan(0);
  });
});

/** Build a plane tilted along +x or +y: elev = ax*x + ay*y (meters per cell). */
function plane(size: number, ax: number, ay: number): Float32Array {
  const elev = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) elev[y * size + x] = ax * x + ay * y;
  }
  return elev;
}

describe('shadeElevationGrid', () => {
  const SIZE = 8;
  const CELL = 10;
  const center = (s: Uint8ClampedArray): number => s[(SIZE / 2) * SIZE + SIZE / 2] as number;

  it('renders flat terrain neutral mid-gray (overlay pass-through)', () => {
    const shade = shadeElevationGrid(new Float32Array(SIZE * SIZE), SIZE, SIZE, CELL);
    expect(Array.from(shade).every((v) => v === 128)).toBe(true);
  });

  it('with the SSE sun, lightens SE-facing slopes and shades NW-facing ones', () => {
    // Elevation rising to the NW (+x is east, +y is south in raster space):
    // surface faces SE — should catch the SSE sun (well above neutral)
    const facingSE = shadeElevationGrid(plane(SIZE, -CELL, -CELL), SIZE, SIZE, CELL);
    // Elevation rising to the SE: surface faces NW — should fall in shadow
    const facingNW = shadeElevationGrid(plane(SIZE, CELL, CELL), SIZE, SIZE, CELL);
    expect(center(facingSE)).toBeGreaterThan(160);
    // Highlights are damped (HILLSHADE_HIGHLIGHT_GAIN) so bright bases don't blow out
    expect(center(facingSE)).toBeLessThanOrEqual(128 + Math.ceil(127 * 0.5));
    expect(center(facingNW)).toBeLessThan(64);
    expect(HILLSHADE_AZIMUTH_DEG).toBe(150);
  });

  it('flips which slope is lit when the azimuth flips to NW', () => {
    const facingNWUnderNWSun = shadeElevationGrid(plane(SIZE, CELL, CELL), SIZE, SIZE, CELL, 315);
    expect(center(facingNWUnderNWSun)).toBeGreaterThan(160);
  });
});

// Layer-level regression guard: re-lighting must not go back to the network.
// Terrarium tiles aren't service-worker cached (src/sw.ts only caches OSM), so a
// refetch on every sun toggle left the map unshaded until the network answered —
// and permanently when it didn't (offline, flaky cellular, throttled tile burst).
describe('HillshadeLayer.setAzimuth', () => {
  // Shaded output captured per fetchAndShade call, so a test can assert the tile
  // was genuinely re-shaded and not just re-served.
  let painted: Uint8ClampedArray[];
  let fetchMock: ReturnType<typeof vi.fn>;
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  const realFetch = globalThis.fetch;
  const realCreateImageBitmap = globalThis.createImageBitmap;

  beforeEach(() => {
    painted = [];
    // Minimal 2D-context stub: jsdom has no canvas backend.
    (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ({
      drawImage: () => {},
      // A ramp in the red channel decodes to terrain with a real gradient, so the
      // two sun directions produce genuinely different shading.
      getImageData: () => ({
        data: Uint8ClampedArray.from(
          { length: 256 * 256 * 4 },
          (_, i) => (i % 4 === 0 ? 128 + Math.floor(i / 4 / 256) % 8 : 0),
        ),
      }),
      createImageData: () => ({ data: new Uint8ClampedArray(256 * 256 * 4) }),
      putImageData: (img: { data: Uint8ClampedArray }) => painted.push(img.data.slice()),
      imageSmoothingEnabled: false,
    });
    globalThis.createImageBitmap = (async () => ({ close: () => {} })) as never;
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, blob: async () => ({}) }));
    globalThis.fetch = fetchMock as never;
  });

  // Restore the globals: vi.restoreAllMocks() can't undo a direct prototype patch,
  // and leaving it in place would silently bleed into any test added later.
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
    globalThis.fetch = realFetch;
    globalThis.createImageBitmap = realCreateImageBitmap;
  });

  function paint(layer: HillshadeLayer, z: number, x: number, y: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const coords = Object.assign(L.point(x, y), { z }) as L.Coords;
      layer.createTile(coords, (err) => (err ? reject(err) : resolve()));
    });
  }

  it('re-shades from cached elevation instead of re-downloading the tile', async () => {
    const layer = createHillshadeLayer({ tileSize: 256 });
    await paint(layer, 14, 2620, 6333);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    layer.setAzimuth(HILLSHADE_NW_AZIMUTH_DEG);
    await paint(layer, 14, 2620, 6333);

    // The elevation grid is kept across the sun change — no second download …
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // … and the tile really was re-shaded under the new sun.
    expect(painted).toHaveLength(2);
    expect(painted[1]).not.toEqual(painted[0]);
  });

  it('re-shades overzoomed tiles from the cached ancestor elevation', async () => {
    // z17 crops a z15 ancestor (dz = 2) — the getShadedAncestor path, which
    // clears on setAzimuth and so must re-shade from elevCache rather than refetch.
    const layer = createHillshadeLayer({ tileSize: 256 });
    await paint(layer, 17, 20960, 50664);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/15/5240/12666.png'));

    layer.setAzimuth(HILLSHADE_NW_AZIMUTH_DEG);
    await paint(layer, 17, 20960, 50664);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(painted).toHaveLength(2);
    expect(painted[1]).not.toEqual(painted[0]);
  });

  it('evicts the least-recently-used elevation grid once the cache is full', async () => {
    const layer = createHillshadeLayer({ tileSize: 256 });
    // Exactly fill the cache with distinct native tiles …
    for (let i = 0; i < ELEV_CACHE_MAX; i++) await paint(layer, 14, 2620 + i, 6333);
    expect(fetchMock).toHaveBeenCalledTimes(ELEV_CACHE_MAX);

    // … one more evicts the least-recently-used entry (the first tile painted) …
    await paint(layer, 14, 2620 + ELEV_CACHE_MAX, 6333);
    expect(fetchMock).toHaveBeenCalledTimes(ELEV_CACHE_MAX + 1);

    // … so that one must be re-downloaded …
    await paint(layer, 14, 2620, 6333);
    expect(fetchMock).toHaveBeenCalledTimes(ELEV_CACHE_MAX + 2);

    // … while a still-resident entry is served from memory.
    await paint(layer, 14, 2620 + ELEV_CACHE_MAX, 6333);
    expect(fetchMock).toHaveBeenCalledTimes(ELEV_CACHE_MAX + 2);
  });

  it('shares one download across sibling subtiles of the same ancestor', async () => {
    const layer = createHillshadeLayer({ tileSize: 256 });
    await Promise.all([
      paint(layer, 17, 20960, 50664),
      paint(layer, 17, 20961, 50664),
      paint(layer, 17, 20960, 50665),
      paint(layer, 17, 20961, 50665),
    ]);

    // All four crop the same z15 ancestor: one fetch, one Horn pass.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(painted).toHaveLength(1);
  });

  it('coalesces concurrent requests for the same native tile', async () => {
    const layer = createHillshadeLayer({ tileSize: 256 });
    // Both paints start before either fetch resolves — the elevation cache holds
    // the pending promise, so the second must join the first rather than refetch.
    await Promise.all([paint(layer, 14, 2620, 6333), paint(layer, 14, 2620, 6333)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces a native tile with an overzoomed descendant of it', async () => {
    const layer = createHillshadeLayer({ tileSize: 256 });
    // z15/5240/12666 is both directly visible and the ancestor z17/20960/50664
    // crops — the two paths race for one tile, which is why the abortable
    // per-tile fetch had to go: a shared request belongs to no single tile.
    await Promise.all([paint(layer, 15, 5240, 12666), paint(layer, 17, 20960, 50664)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
