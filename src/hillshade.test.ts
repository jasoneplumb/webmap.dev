import { describe, expect, it } from 'vitest';
import {
  HILLSHADE_AZIMUTH_DEG,
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
