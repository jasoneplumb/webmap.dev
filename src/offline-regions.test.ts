import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  REGION_LAYERS,
  TERRARIUM_MAX_ZOOM,
  type RegionBounds,
  type SavedRegion,
  addRegion,
  clampZoomRange,
  countTiles,
  estimateLayers,
  formatBytes,
  getTileRange,
  hasSavedLayer,
  lat2tile,
  lng2tile,
  loadRegions,
  nextRegionName,
  osmTileUrl,
  removeRegion,
  terrariumTileUrl,
  tileUrlsForLayer,
} from './offline-regions';
import { osmTileUrlVariants } from './sw-constants';

// A small area around Yosemite Valley — real coordinates keep the tile math honest.
const YOSEMITE: RegionBounds = { south: 37.7, west: -119.65, north: 37.77, east: -119.53 };

function makeRegion(overrides: Partial<SavedRegion> = {}): SavedRegion {
  return {
    id: 'region-test-1',
    name: 'Region 1',
    bounds: YOSEMITE,
    zMin: 12,
    zMax: 14,
    layers: ['streets'],
    tileCount: 10,
    bytes: 150_000,
    createdAt: 0,
    ...overrides,
  };
}

describe('tile coordinate math', () => {
  it('maps the origin corner of the world to tile 0/0', () => {
    expect(lng2tile(-180, 3)).toBe(0);
    expect(lat2tile(85.05, 3)).toBe(0);
  });

  it('maps Yosemite to the known z12 tile column/row', () => {
    // Independently verified: (-119.65+180)/360 * 4096 = 686.6 → x 686;
    // y from the Mercator formula at lat 37.77 → 1583.
    expect(lng2tile(YOSEMITE.west, 12)).toBe(686);
    expect(lat2tile(YOSEMITE.north, 12)).toBe(1583);
  });

  it('getTileRange puts north at yMin (smaller y is further north)', () => {
    const r = getTileRange(YOSEMITE, 12);
    expect(r.yMin).toBeLessThanOrEqual(r.yMax);
    expect(r.xMin).toBeLessThanOrEqual(r.xMax);
  });

  it('countTiles sums ranges across the zoom span', () => {
    const perZoom = [12, 13, 14].map((z) => {
      const r = getTileRange(YOSEMITE, z);
      return (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);
    });
    expect(countTiles(YOSEMITE, 12, 14)).toBe(perZoom.reduce((a, b) => a + b, 0));
  });
});

describe('clampZoomRange', () => {
  it('passes ranges under the ceiling through unchanged', () => {
    expect(clampZoomRange(10, 14, 18)).toEqual({ zMin: 10, zMax: 14 });
  });

  it('clamps the top of the range to the ceiling', () => {
    expect(clampZoomRange(10, 18, TERRARIUM_MAX_ZOOM)).toEqual({ zMin: 10, zMax: 15 });
  });

  it('collapses a range entirely above the ceiling onto it', () => {
    expect(clampZoomRange(16, 18, TERRARIUM_MAX_ZOOM)).toEqual({ zMin: 15, zMax: 15 });
  });
});

describe('tile URL generation', () => {
  it('spreads OSM URLs across subdomains with Leaflet’s abs(x+y) formula', () => {
    expect(osmTileUrl(0, 0, 1)).toBe('https://a.tile.openstreetmap.org/1/0/0.png');
    expect(osmTileUrl(1, 0, 1)).toBe('https://b.tile.openstreetmap.org/1/1/0.png');
    expect(osmTileUrl(1, 1, 1)).toBe('https://c.tile.openstreetmap.org/1/1/1.png');
  });

  it('builds Terrarium URLs on the exact host/path hillshade.ts fetches', () => {
    expect(terrariumTileUrl(686, 1583, 12)).toBe(
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/686/1583.png',
    );
  });

  it('generates one URL per tile in the range for streets', () => {
    const urls = tileUrlsForLayer('streets', YOSEMITE, 12, 13);
    expect(urls).toHaveLength(countTiles(YOSEMITE, 12, 13));
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('clamps hillshade URLs to the Terrarium z15 ceiling', () => {
    const urls = tileUrlsForLayer('hillshade', YOSEMITE, 14, 18);
    expect(urls).toHaveLength(countTiles(YOSEMITE, 14, 15));
    expect(urls.every((u) => /\/terrarium\/1[45]\//.test(u))).toBe(true);
  });
});

describe('osmTileUrlVariants', () => {
  it('expands an OSM tile URL to all three subdomains', () => {
    expect(osmTileUrlVariants('https://b.tile.openstreetmap.org/12/686/1583.png')).toEqual([
      'https://a.tile.openstreetmap.org/12/686/1583.png',
      'https://b.tile.openstreetmap.org/12/686/1583.png',
      'https://c.tile.openstreetmap.org/12/686/1583.png',
    ]);
  });

  it('passes non-OSM URLs through untouched', () => {
    const terrarium = terrariumTileUrl(1, 2, 3);
    expect(osmTileUrlVariants(terrarium)).toEqual([terrarium]);
  });

  it('does not match a hostile suffix domain', () => {
    const evil = 'https://a.tile.openstreetmap.org.evil.example/12/1/1.png';
    expect(osmTileUrlVariants(evil)).toEqual([evil]);
  });
});

describe('estimateLayers', () => {
  it('prices each layer at its own average tile size', () => {
    const [streets, hillshade] = estimateLayers(['streets', 'hillshade'], YOSEMITE, 12, 13);
    expect(streets!.bytes).toBe(streets!.tiles * REGION_LAYERS.streets.avgTileBytes);
    expect(hillshade!.bytes).toBe(hillshade!.tiles * REGION_LAYERS.hillshade.avgTileBytes);
  });

  it('gives hillshade fewer tiles than streets once past its zoom ceiling', () => {
    const [streets, hillshade] = estimateLayers(['streets', 'hillshade'], YOSEMITE, 14, 18);
    expect(hillshade!.tiles).toBeLessThan(streets!.tiles);
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [15_000, '15 KB'],
    [50 * 1024 * 1024, '50.0 MB'],
  ])('formats %d as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('region manifest', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a region through add/load/remove', () => {
    const region = makeRegion();
    addRegion(region);
    expect(loadRegions()).toEqual([region]);
    removeRegion(region.id);
    expect(loadRegions()).toEqual([]);
  });

  it('drops malformed entries instead of throwing', () => {
    store.set('webmap-offline-regions', JSON.stringify([makeRegion(), { junk: true }, 42]));
    expect(loadRegions()).toHaveLength(1);
  });

  it('returns [] for corrupt JSON', () => {
    store.set('webmap-offline-regions', '{not json');
    expect(loadRegions()).toEqual([]);
  });

  it('numbers new regions past the highest existing auto-name', () => {
    expect(nextRegionName([])).toBe('Region 1');
    expect(nextRegionName([makeRegion({ name: 'Region 3' })])).toBe('Region 4');
    // A renamed/pattern-breaking region does not disturb the counter.
    expect(nextRegionName([makeRegion({ name: 'Yosemite trip' })])).toBe('Region 1');
  });

  it('hasSavedLayer reports per-layer coverage', () => {
    addRegion(makeRegion({ layers: ['hillshade'] }));
    expect(hasSavedLayer('hillshade')).toBe(true);
    expect(hasSavedLayer('streets')).toBe(false);
  });
});
