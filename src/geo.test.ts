import { describe, it, expect } from 'vitest';
import L from 'leaflet';
import { bearingDeg, pointToSegmentMeters } from './geo';

describe('bearingDeg', () => {
  it('returns ~0 for due north', () => {
    expect(bearingDeg(L.latLng(0, 0), L.latLng(1, 0))).toBeCloseTo(0, 1);
  });
  it('returns ~90 for due east at the equator', () => {
    expect(bearingDeg(L.latLng(0, 0), L.latLng(0, 1))).toBeCloseTo(90, 1);
  });
  it('returns ~180 for due south', () => {
    expect(bearingDeg(L.latLng(1, 0), L.latLng(0, 0))).toBeCloseTo(180, 1);
  });
  it('returns ~270 for due west at the equator', () => {
    expect(bearingDeg(L.latLng(0, 1), L.latLng(0, 0))).toBeCloseTo(270, 1);
  });
  it('wraps to a positive value for SW headings', () => {
    const b = bearingDeg(L.latLng(40, -74), L.latLng(39, -75));
    expect(b).toBeGreaterThan(180);
    expect(b).toBeLessThan(270);
  });
});

describe('pointToSegmentMeters', () => {
  it('is ~0 for a point on the segment midpoint', () => {
    const a = L.latLng(40, -74);
    const b = L.latLng(40, -73);
    const mid = L.latLng(40, -73.5);
    expect(pointToSegmentMeters(mid, a, b)).toBeCloseTo(0, 0);
  });

  it('clamps to the start endpoint when projection is before a', () => {
    const a = L.latLng(40, -74);
    const b = L.latLng(40, -73);
    const before = L.latLng(40, -74.1);
    // Distance ≈ 0.1° lng × 111 km × cos(40°) ≈ 8.5 km
    const expected = 8500;
    expect(pointToSegmentMeters(before, a, b)).toBeGreaterThan(expected * 0.95);
    expect(pointToSegmentMeters(before, a, b)).toBeLessThan(expected * 1.05);
  });

  it('clamps to the end endpoint when projection is past b', () => {
    const a = L.latLng(40, -74);
    const b = L.latLng(40, -73);
    const after = L.latLng(40, -72.9);
    const expected = 8500;
    expect(pointToSegmentMeters(after, a, b)).toBeGreaterThan(expected * 0.95);
    expect(pointToSegmentMeters(after, a, b)).toBeLessThan(expected * 1.05);
  });

  it('measures perpendicular distance for a point off the segment', () => {
    const a = L.latLng(40, -74);
    const b = L.latLng(40, -73);
    const above = L.latLng(40.001, -73.5); // 0.001° lat above midpoint
    // Distance ≈ 0.001 × 111 km ≈ 111 m
    expect(pointToSegmentMeters(above, a, b)).toBeGreaterThan(100);
    expect(pointToSegmentMeters(above, a, b)).toBeLessThan(125);
  });

  it('handles degenerate (zero-length) segments', () => {
    const a = L.latLng(40, -74);
    const p = L.latLng(40.001, -74);
    expect(pointToSegmentMeters(p, a, a)).toBeGreaterThan(100);
    expect(pointToSegmentMeters(p, a, a)).toBeLessThan(125);
  });
});
