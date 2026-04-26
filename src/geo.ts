/**
 * Intent: Geometry helpers for guidance — bearing, point-to-segment distance, haversine.
 * Pattern: Pure functions, no DOM/Leaflet state — safe to test without the map.
 */
import L from 'leaflet';
import { haversineDistance } from './location';

export { haversineDistance };

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Initial bearing from `a` to `b` in degrees (0–360, 0=N, 90=E, 180=S, 270=W). */
export function bearingDeg(a: L.LatLng, b: L.LatLng): number {
  const φ1 = a.lat * DEG2RAD;
  const φ2 = b.lat * DEG2RAD;
  const Δλ = (b.lng - a.lng) * DEG2RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * RAD2DEG) + 360) % 360;
}

/**
 * Closest distance in meters from point `p` to the segment a→b.
 * Equirectangular projection — accurate to <1% for segments under a few kilometers.
 */
export function pointToSegmentMeters(p: L.LatLng, a: L.LatLng, b: L.LatLng): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return haversineDistance(p.lat, p.lng, a.lat, a.lng);
  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projLat = a.lat + t * dy;
  const projLng = a.lng + t * dx;
  return haversineDistance(p.lat, p.lng, projLat, projLng);
}
