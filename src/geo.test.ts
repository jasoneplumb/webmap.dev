import { describe, it, expect } from 'vitest';
import L from 'leaflet';
import {
  DOUBLE_TAP_GAP_MS,
  TAP_MOVE_PX,
  bearingDeg,
  isDoubleTap,
  isTapCandidate,
  normalizeDeg,
  pointToSegmentMeters,
  shortestArcDeg,
} from './geo';

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

describe('normalizeDeg', () => {
  it('leaves an in-range angle alone', () => {
    expect(normalizeDeg(90)).toBe(90);
  });

  it('wraps negatives into range', () => {
    expect(normalizeDeg(-90)).toBe(270);
  });

  it('wraps past a full turn', () => {
    expect(normalizeDeg(450)).toBe(90);
  });

  it('wraps many turns in either direction', () => {
    expect(normalizeDeg(360 * 3 + 45)).toBeCloseTo(45);
    expect(normalizeDeg(-360 * 3 - 45)).toBeCloseTo(315);
  });

  it('maps a full turn to zero, not 360', () => {
    expect(normalizeDeg(360)).toBe(0);
  });
});

describe('shortestArcDeg', () => {
  it('is zero between equal angles', () => {
    expect(shortestArcDeg(42, 42)).toBe(0);
  });

  it('is positive turning clockwise', () => {
    expect(shortestArcDeg(10, 80)).toBe(70);
  });

  it('is negative turning anticlockwise', () => {
    expect(shortestArcDeg(80, 10)).toBe(-70);
  });

  it('crosses north the short way rather than sweeping backwards', () => {
    expect(shortestArcDeg(350, 10)).toBe(20);
    expect(shortestArcDeg(10, 350)).toBe(-20);
  });

  it('stays within -180..180 for every pair', () => {
    for (let a = 0; a < 360; a += 7) {
      for (let b = 0; b < 360; b += 11) {
        const d = shortestArcDeg(a, b);
        expect(d).toBeGreaterThanOrEqual(-180);
        expect(d).toBeLessThanOrEqual(180);
      }
    }
  });

  it('lands on the target when added to the start', () => {
    expect(normalizeDeg(350 + shortestArcDeg(350, 10))).toBeCloseTo(10);
    expect(normalizeDeg(10 + shortestArcDeg(10, 350))).toBeCloseTo(350);
  });
});

describe('tap pairing', () => {
  const at = (x: number, y: number, t: number) => ({ x, y, t });

  it('accepts a still, brief touch as a tap', () => {
    expect(isTapCandidate(at(100, 100, 0), at(102, 101, 80))).toBe(true);
  });

  it('rejects a touch that travelled — that is a pan, not a tap', () => {
    // The bug this prevents: a pan ends in a touchend too, and pairing its release
    // point with a later tap zoomed the map on the everyday "drag, then tap" sequence.
    expect(isTapCandidate(at(100, 100, 0), at(100 + TAP_MOVE_PX + 1, 100, 80))).toBe(false);
  });

  it('rejects a touch held long enough to be a press', () => {
    expect(isTapCandidate(at(100, 100, 0), at(100, 100, 900))).toBe(false);
  });

  it('pairs two taps close in time and space', () => {
    expect(isDoubleTap(at(100, 100, 0), at(110, 105, 200))).toBe(true);
  });

  it('does not pair taps too far apart in time', () => {
    expect(isDoubleTap(at(100, 100, 0), at(100, 100, DOUBLE_TAP_GAP_MS + 1))).toBe(false);
  });

  it('does not pair taps too far apart on screen', () => {
    expect(isDoubleTap(at(100, 100, 0), at(200, 100, 100))).toBe(false);
  });

  it('never pairs against nothing', () => {
    expect(isDoubleTap(null, at(100, 100, 0))).toBe(false);
  });

  it('uses a gap wider than Leaflet\u2019s 200ms, which is what missed iOS double-taps', () => {
    expect(isDoubleTap(at(0, 0, 0), at(0, 0, 250))).toBe(true);
  });
});
