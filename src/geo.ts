import L from 'leaflet';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Haversine great-circle distance between two lat/lng points (metres). */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const p = DEG2RAD;
  const f =
    0.5 -
    Math.cos((lat1 - lat2) * p) / 2 +
    (Math.cos(lat2 * p) * Math.cos(lat1 * p) * (1 - Math.cos((lng1 - lng2) * p))) / 2;
  const R = 6371000;
  return 2 * R * Math.asin(Math.sqrt(f));
}

/** Initial bearing from `a` to `b` in degrees (0–360, 0=N, 90=E, 180=S, 270=W). */
export function bearingDeg(a: L.LatLng, b: L.LatLng): number {
  const phi1 = a.lat * DEG2RAD;
  const phi2 = b.lat * DEG2RAD;
  const dLng = (b.lng - a.lng) * DEG2RAD;
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * RAD2DEG) + 360) % 360;
}

/** Wrap any angle into 0–360. Negative and >360 inputs both land in range. */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Signed shortest rotation from `from` to `to`, in -180..180.
 *
 * The reason every heading animation needs this: interpolating 350° → 10° on the raw
 * numbers sweeps 340° backwards, so a compass crossing north visibly spins the long way
 * round. Rotating by this delta instead turns 20° forward.
 */
export function shortestArcDeg(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * Closest distance in meters from point `p` to the segment a→b.
 * Equirectangular projection with cos(lat) correction so longitude/latitude
 * scale equally near the segment midpoint — accurate at any latitude for
 * segments under a few kilometers.
 */
export function pointToSegmentMeters(p: L.LatLng, a: L.LatLng, b: L.LatLng): number {
  const cosLat = Math.cos(((a.lat + b.lat) / 2) * DEG2RAD);
  const dx = (b.lng - a.lng) * cosLat;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return haversineDistance(p.lat, p.lng, a.lat, a.lng);
  let t = ((p.lng - a.lng) * cosLat * dx + (p.lat - a.lat) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projLat = a.lat + t * dy;
  const projLng = a.lng + t * (b.lng - a.lng);
  return haversineDistance(p.lat, p.lng, projLat, projLng);
}

// ── Tap pairing (pure) ────────────────────────────────────────────────────────

/** One touch sample: where it happened and when. */
export interface TapSample {
  x: number;
  y: number;
  t: number;
}

/** How far apart two taps may land and still count as the same spot (px). */
export const DOUBLE_TAP_SLOP_PX = 32;
/** Longest gap between two taps that still reads as one gesture (ms). */
export const DOUBLE_TAP_GAP_MS = 320;
/** Furthest a single touch may travel and still be a tap rather than a drag (px). */
export const TAP_MOVE_PX = 10;
/** Longest a single touch may be held and still be a tap rather than a press (ms). */
export const TAP_HOLD_MS = 500;

/**
 * Did one touch stay still enough, and end soon enough, to be a tap at all?
 *
 * Without this a pan qualifies: the finger that dragged the map across the screen still
 * produces a touchend, and pairing that with an ordinary tap nearby a moment later
 * zooms the map the user never asked to zoom. Drag-then-tap is an everyday sequence on
 * a map, so the release point of a drag must never become half of a double-tap.
 */
export function isTapCandidate(
  start: TapSample,
  end: TapSample,
  maxMovePx = TAP_MOVE_PX,
  maxHoldMs = TAP_HOLD_MS,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) <= maxMovePx
    && end.t - start.t <= maxHoldMs;
}

/** Are two taps close enough in time and space to be one double-tap? */
export function isDoubleTap(
  previous: TapSample | null,
  current: TapSample,
  maxGapMs = DOUBLE_TAP_GAP_MS,
  maxSlopPx = DOUBLE_TAP_SLOP_PX,
): boolean {
  if (previous === null) return false;
  return current.t - previous.t <= maxGapMs
    && Math.hypot(current.x - previous.x, current.y - previous.y) <= maxSlopPx;
}
