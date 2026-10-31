import { describe, it, expect } from 'vitest';
import { haversineDistance } from './geo';
import { INITIAL_FIX_ZOOM } from './location';
import { MAX_ZOOM } from './map';

describe('INITIAL_FIX_ZOOM', () => {
  it('is one level in from the map ceiling, not a second magic number', () => {
    // The default the first GPS fix lands on. Written as MAX_ZOOM - 1 so raising the ceiling
    // carries it up; a literal here would drift silently, which is the state this replaced.
    expect(INITIAL_FIX_ZOOM).toBe(MAX_ZOOM - 1);
  });

  it('is a level the tile providers actually serve', () => {
    // MAX_ZOOM - 1 is each layer's maxNativeZoom, so arriving costs native tiles rather than
    // an upscale. If the ceiling ever moves without maxNativeZoom moving with it, the default
    // lands on blurred tiles and this is where that shows up.
    expect(INITIAL_FIX_ZOOM).toBeLessThan(MAX_ZOOM);
    expect(INITIAL_FIX_ZOOM).toBeGreaterThan(2); // the map's minZoom
  });
});

describe('haversineDistance', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistance(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0);
  });

  it('calculates ~1km for nearby SF points', () => {
    // Market St to Ferry Building: approx 1.3 km
    const dist = haversineDistance(37.7749, -122.4194, 37.7955, -122.3934);
    expect(dist).toBeGreaterThan(1000);
    expect(dist).toBeLessThan(3500);
  });

  it('calculates ~8900km for SF to London', () => {
    const dist = haversineDistance(37.7749, -122.4194, 51.5074, -0.1278);
    expect(dist).toBeGreaterThan(8500_000);
    expect(dist).toBeLessThan(9000_000);
  });

  it('handles antipodal points (half circumference)', () => {
    // North pole to south pole: ~20,000 km
    const dist = haversineDistance(90, 0, -90, 0);
    expect(dist).toBeGreaterThan(19_900_000);
    expect(dist).toBeLessThan(20_100_000);
  });

  it('handles equatorial points', () => {
    // 1 degree longitude at equator: ~111 km
    const dist = haversineDistance(0, 0, 0, 1);
    expect(dist).toBeGreaterThan(110_000);
    expect(dist).toBeLessThan(112_000);
  });

  it('is symmetric', () => {
    const ab = haversineDistance(37.7749, -122.4194, 51.5074, -0.1278);
    const ba = haversineDistance(51.5074, -0.1278, 37.7749, -122.4194);
    expect(ab).toBeCloseTo(ba, 2);
  });
});
