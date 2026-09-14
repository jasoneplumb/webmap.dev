import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  REGION_LAYERS,
  TERRARIUM_MAX_ZOOM,
  type RegionBounds,
  type RegionLayerId,
  type SavedRegion,
  PARTIAL_SUFFIX,
  addRegion,
  clampZoomRange,
  countTiles,
  coverageContains,
  isSameCoverage,
  mergeRegions,
  estimateLayers,
  formatBytes,
  getTileRange,
  crossesAntimeridian,
  hasSavedLayer,
  lat2tile,
  lng2tile,
  loadRegions,
  nextRegionName,
  normalizeLng,
  osmTileUrl,
  removeRegion,
  savedRegionCoversTile,
  isCoveredBySavedRegion,
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

  it('drops a structurally-valid entry with an unknown layer id', () => {
    const stale = { ...makeRegion(), layers: ['terrain-legacy'] };
    store.set('webmap-offline-regions', JSON.stringify([makeRegion(), stale]));
    expect(loadRegions()).toHaveLength(1);
  });

  it('drops a structurally-valid entry with non-numeric bounds fields', () => {
    const stale = { ...makeRegion(), bounds: { south: '0', west: 0, north: 1, east: 1 } };
    store.set('webmap-offline-regions', JSON.stringify([makeRegion(), stale]));
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

  it('recognizes its own "(partial)" suffix so a later full download does not collide', () => {
    expect(nextRegionName([makeRegion({ name: 'Region 3 (partial)' })])).toBe('Region 4');
  });

  it('hasSavedLayer reports per-layer coverage', () => {
    addRegion(makeRegion({ layers: ['hillshade'] }));
    expect(hasSavedLayer('hillshade')).toBe(true);
    expect(hasSavedLayer('streets')).toBe(false);
  });

  describe('antimeridian handling', () => {
    it('wraps longitudes that Leaflet reports unwrapped after panning past 180', () => {
      expect(normalizeLng(-181)).toBeCloseTo(179);
      expect(normalizeLng(190)).toBeCloseTo(-170);
      expect(normalizeLng(0)).toBeCloseTo(0);
      expect(normalizeLng(180)).toBeCloseTo(-180); // canonical form; same meridian
    });

    it('detects a selection that spans the 180 meridian once wrapped', () => {
      expect(crossesAntimeridian({ south: 0, west: 179, north: 1, east: -179 })).toBe(true);
      expect(crossesAntimeridian({ south: 0, west: -181, north: 1, east: -179 })).toBe(true);
      expect(crossesAntimeridian({ south: 37, west: -123, north: 38, east: -122 })).toBe(false);
    });

    it('does not turn a small unwrapped selection into a world-wide tile sweep', () => {
      // west -181 / east -179 is two degrees near the dateline. Before longitudes were
      // normalized, lng2tile(-181) went negative, xMin clamped to 0, and the range ran
      // from the left edge of the world — a multi-gigabyte "small" region.
      const wrapped: RegionBounds = { south: 0, west: -181, north: 1, east: -179 };
      const plain: RegionBounds = { south: 0, west: 179, north: 1, east: 180 };
      expect(countTiles(wrapped, 1, 10)).toBeLessThanOrEqual(countTiles(plain, 1, 10) * 2);
    });

    it('never reports a negative tile count for a selection wrapped the other way', () => {
      // west 190 normalizes to -170 and east 191 to -169: a valid, ordinary range.
      // The old math left xMin > xMax, which made countTiles go negative and the size
      // estimate read as a negative number of bytes.
      expect(countTiles({ south: 0, west: 190, north: 1, east: 191 }, 1, 12)).toBeGreaterThan(0);
      for (let z = 1; z <= 14; z++) {
        const r = getTileRange({ south: 0, west: 179.5, north: 1, east: -179.5 }, z);
        expect(Math.max(0, r.xMax - r.xMin + 1)).toBeGreaterThanOrEqual(0);
      }
      expect(countTiles({ south: 0, west: 179.5, north: 1, east: -179.5 }, 1, 14))
        .toBeGreaterThanOrEqual(0);
    });
  });

  describe('coverage queries', () => {
    it('savedRegionCoversTile distinguishes a tile inside a region from one outside it', () => {
      // Yosemite-ish box; the tile-error toast must not promise this covers Tahoe.
      addRegion(makeRegion({
        layers: ['streets'],
        bounds: { south: 37.6, west: -119.8, north: 37.9, east: -119.4 },
        zMin: 10,
        zMax: 14,
      }));
      const inside = { x: lng2tile(-119.6, 12), y: lat2tile(37.75, 12), z: 12 };
      const outside = { x: lng2tile(-120.05, 12), y: lat2tile(39.1, 12), z: 12 };
      expect(savedRegionCoversTile('streets', inside.x, inside.y, inside.z)).toBe(true);
      expect(savedRegionCoversTile('streets', outside.x, outside.y, outside.z)).toBe(false);
      // Right place, layer never saved.
      expect(savedRegionCoversTile('hillshade', inside.x, inside.y, inside.z)).toBe(false);
      // Right place, zoom outside the saved range.
      expect(savedRegionCoversTile('streets', inside.x, inside.y, 17)).toBe(false);
    });

    it('isCoveredBySavedRegion requires bounds, layers and zoom all to be contained', () => {
      const region = makeRegion({
        layers: ['streets', 'hillshade'],
        bounds: { south: 37, west: -123, north: 38, east: -122 },
        zMin: 10,
        zMax: 15,
      });
      addRegion(region);
      const inner = { south: 37.2, west: -122.8, north: 37.6, east: -122.4 };
      expect(isCoveredBySavedRegion(inner, ['streets'], 11, 14)).toBe(true);
      // Same box, a zoom level deeper than anything saved.
      expect(isCoveredBySavedRegion(inner, ['streets'], 11, 16)).toBe(false);
      // Straddles the western edge.
      expect(isCoveredBySavedRegion(
        { south: 37.2, west: -123.5, north: 37.6, east: -122.4 }, ['streets'], 11, 14,
      )).toBe(false);
      // No region carries this combination across a single entry.
      expect(isCoveredBySavedRegion(inner, ['streets'], 9, 14)).toBe(false);
    });
  });

  it('drops a manifest entry whose numeric display fields are not numbers', () => {
    // Hand-edited localStorage or a schema drift: a non-numeric bytes used to survive
    // validation and render as "NaN MB" in the saved-regions list.
    const good = makeRegion({ name: 'Keep' });
    const bad = { ...makeRegion({ name: 'Drop' }), bytes: 'lots' };
    localStorage.setItem('webmap-offline-regions', JSON.stringify([good, bad]));
    const loaded = loadRegions();
    expect(loaded.map((r) => r.name)).toEqual(['Keep']);
  });

  describe('re-download dedupe', () => {
    it('folds a re-download of the same area into the entry that already holds it', () => {
      // Two rows for one area is the #318 defect: deleteRegion recomputes tile URLs from
      // bounds/zoom/layers, so deleting either twin empties the tiles the other lists,
      // and the survivor reads as fully saved until the user is offline on that ground.
      addRegion(makeRegion({ id: 'first', name: 'Region 1' }));
      addRegion(makeRegion({ id: 'second', name: 'Region 2' }));
      expect(loadRegions()).toHaveLength(1);
    });

    it('keeps the original id and createdAt so the manager\u2019s Delete still resolves', () => {
      addRegion(makeRegion({ id: 'first', createdAt: 1_000 }));
      addRegion(makeRegion({ id: 'second', createdAt: 9_999 }));
      const saved = loadRegions();
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ id: 'first', name: 'Region 1', createdAt: 1_000 });
    });

    it('never lowers the recorded size on a re-download', () => {
      addRegion(makeRegion({ tileCount: 400, bytes: 6_000_000 }));
      // A re-run stopped early reports fewer succeeded tiles — but it removed nothing, so
      // the row must not shrink to match it.
      addRegion(makeRegion({ tileCount: 90, bytes: 1_350_000 }));
      expect(loadRegions()[0]).toMatchObject({ tileCount: 400, bytes: 6_000_000 });
      // A re-run that fills the gaps an earlier one left does raise it.
      addRegion(makeRegion({ tileCount: 500, bytes: 7_500_000 }));
      expect(loadRegions()[0]).toMatchObject({ tileCount: 500, bytes: 7_500_000 });
    });

    it('drops the "(partial)" marker once a re-download completes the region', () => {
      addRegion(makeRegion({ name: 'Region 1' + PARTIAL_SUFFIX }));
      addRegion(makeRegion({ name: 'Region 2' }));
      expect(loadRegions().map((r) => r.name)).toEqual(['Region 1']);
    });

    it('does not re-mark a complete region partial when a later run is stopped early', () => {
      // Stopping a re-run cannot un-download what the first, complete run already wrote.
      addRegion(makeRegion({ name: 'Region 1' }));
      addRegion(makeRegion({ name: 'Region 2' + PARTIAL_SUFFIX }));
      expect(loadRegions().map((r) => r.name)).toEqual(['Region 1']);
    });

    it('merges zoom ranges that clamp to the same tiles', () => {
      // Terrarium stops at z15, so a hillshade region saved z10-18 and one saved z10-15
      // hold byte-identical tiles. Left as two rows, deleting either would empty the other.
      addRegion(makeRegion({ id: 'wide', layers: ['hillshade'], zMin: 10, zMax: 18 }));
      addRegion(makeRegion({ id: 'exact', layers: ['hillshade'], zMin: 10, zMax: 15 }));
      const saved = loadRegions();
      expect(saved).toHaveLength(1);
      expect(saved[0]?.id).toBe('wide');
    });

    it('keeps genuinely different selections as separate entries', () => {
      addRegion(makeRegion({ id: 'base' }));
      addRegion(makeRegion({ id: 'deeper', zMax: 15 })); // holds tiles 'base' never fetched
      addRegion(makeRegion({ id: 'two-layer', layers: ['streets', 'hillshade'] }));
      addRegion(makeRegion({
        id: 'tahoe',
        bounds: { south: 39, west: -120.2, north: 39.2, east: -120 },
      }));
      expect(loadRegions().map((r) => r.id))
        .toEqual(['base', 'deeper', 'two-layer', 'tahoe']);
    });

    it('does not swallow a smaller selection into the region that contains it', () => {
      // Containment is not equality. The inner selection is a strict subset, so folding it
      // in would claim the outer row covers ground the user asked for separately — and
      // dropping it would leave those tiles listed nowhere once the outer row is deleted.
      addRegion(makeRegion({
        id: 'outer',
        bounds: { south: 37, west: -123, north: 38, east: -122 },
        zMin: 10,
        zMax: 14,
      }));
      addRegion(makeRegion({
        id: 'inner',
        bounds: { south: 37.2, west: -122.8, north: 37.6, east: -122.4 },
        zMin: 11,
        zMax: 13,
      }));
      expect(loadRegions().map((r) => r.id)).toEqual(['outer', 'inner']);
    });
  });

  it('does not claim coverage above a layer\u2019s native ceiling', () => {
    // The slider said z10-18, but tileUrlsForLayer clamps hillshade to z15, so tiles above
    // z15 were never fetched. Comparing against the stored range would over-claim them.
    addRegion(makeRegion({
      layers: ['hillshade'],
      bounds: { south: 37, west: -123, north: 38, east: -122 },
      zMin: 10,
      zMax: 18,
    }));
    const x = lng2tile(-122.5, 14);
    const y = lat2tile(37.5, 14);
    expect(savedRegionCoversTile('hillshade', x, y, 14)).toBe(true);
    expect(savedRegionCoversTile('hillshade', lng2tile(-122.5, 17), lat2tile(37.5, 17), 17))
      .toBe(false);
    const inner = { south: 37.2, west: -122.8, north: 37.6, east: -122.4 };
    // A z16-18 hillshade request resolves to z15 alone, which this region holds.
    expect(isCoveredBySavedRegion(inner, ['hillshade'], 16, 18)).toBe(true);
    // Streets has no clamping (ceiling 18) and was never saved here.
    expect(isCoveredBySavedRegion(inner, ['streets'], 16, 18)).toBe(false);
  });
});

describe('coverage comparison', () => {
  const STREETS: RegionLayerId[] = ['streets'];
  const base = { bounds: YOSEMITE, layers: STREETS, zMin: 12, zMax: 14 };

  it('holds its own coverage', () => {
    expect(coverageContains(base, base)).toBe(true);
    expect(isSameCoverage(base, base)).toBe(true);
  });

  it('is directional — a wider region contains a narrower one, not the reverse', () => {
    const wider = { ...base, zMin: 11, zMax: 15 };
    expect(coverageContains(wider, base)).toBe(true);
    expect(coverageContains(base, wider)).toBe(false);
    expect(isSameCoverage(base, wider)).toBe(false);
  });

  it('treats unwrapped longitudes as the same ground', () => {
    // Leaflet reports west 190 after a pan past the dateline; it is the same meridian as
    // -170, and both selections generate byte-identical tile URLs. Comparing the raw
    // numbers would file them as two regions that delete each other's tiles.
    const wrapped = {
      bounds: { south: 0, west: 190, north: 1, east: 191 },
      layers: STREETS, zMin: 5, zMax: 6,
    };
    const plain = {
      bounds: { south: 0, west: -170, north: 1, east: -169 },
      layers: STREETS, zMin: 5, zMax: 6,
    };
    expect(isSameCoverage(wrapped, plain)).toBe(true);
  });

  it('requires the same layer set, not merely an overlapping one', () => {
    const both = { ...base, layers: ['streets', 'hillshade'] as RegionLayerId[] };
    expect(coverageContains(both, base)).toBe(true);
    expect(coverageContains(base, both)).toBe(false);
    expect(isSameCoverage(base, both)).toBe(false);
  });

  it('mergeRegions keeps the original identity and the larger estimate', () => {
    const merged = mergeRegions(
      makeRegion({ id: 'a', createdAt: 1_000, tileCount: 100, bytes: 1_500_000 }),
      makeRegion({ id: 'b', createdAt: 2_000, tileCount: 20, bytes: 300_000 }),
    );
    expect(merged).toMatchObject({
      id: 'a', createdAt: 1_000, tileCount: 100, bytes: 1_500_000,
    });
  });
});
