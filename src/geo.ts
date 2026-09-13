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
