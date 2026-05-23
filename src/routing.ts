// Public routing API + provider dispatch.
//
// Two backends sit behind the same `fetchRoute()` signature:
//   - Valhalla (FOSSGIS) — POST /route, full prose instructions
//   - OSRM (OSM-DE)      — GET /route/v1, instructions synthesized client-side
//
// Provider is selected by ROUTING_PROVIDER. Runtime fallback is a separate
// issue (#TBD); today this is a const so a swap is one line + rebuild.
//
// Privacy: each request sends start + destination to a public routing service.
// ADR-006 + the consent flow document the tradeoff before any nav action.

import L from 'leaflet';
import type { UnitSystem } from './units';
import { fetchRouteValhalla, VALHALLA_URL } from './routing-valhalla';
import { fetchRouteOsrm, OSRM_BASE_URL } from './routing-osrm';

export type Costing = 'auto' | 'pedestrian' | 'bicycle';

export interface RouteStep {
  instruction: string;
  /**
   * Valhalla maneuver type number — see
   * https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/#maneuver-types
   *
   * OSRM responses are mapped onto this same numeric space so guidance.ts's
   * icon picker keeps working regardless of provider.
   */
  type: number;
  lengthM: number;
  durationS: number;
  streetNames: string[];
  /** Index into the decoded polyline where this step starts. */
  beginShapeIndex: number;
}

export interface Route {
  coords: L.LatLng[];
  steps: RouteStep[];
  distanceM: number;
  durationS: number;
}

export interface RouteRequest {
  start: L.LatLng;
  dest: L.LatLng;
  costing: Costing;
  signal?: AbortSignal;
  /** Unit system for instruction text. Only consulted by Valhalla. */
  units?: UnitSystem;
}

export type RoutingProvider = 'valhalla' | 'osrm';

/** Active routing backend. Change here + rebuild to swap providers. */
export const ROUTING_PROVIDER: RoutingProvider = 'valhalla';

export { VALHALLA_URL, OSRM_BASE_URL };

/**
 * Decode polyline6 (precision-6 polyline — same format Valhalla returns and
 * what OSRM returns when `geometries=polyline6` is requested).
 * Reference: https://valhalla.github.io/valhalla/decoding/
 */
export function decodePolyline6(s: string): L.LatLng[] {
  const out: L.LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < s.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >>> 1) : result >>> 1;
    result = 0;
    shift = 0;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >>> 1) : result >>> 1;
    out.push(L.latLng(lat / 1e6, lng / 1e6));
  }
  return out;
}

/** Fetch a route from the active provider. AbortController-friendly. */
export async function fetchRoute(req: RouteRequest): Promise<Route> {
  if (
    !isFinite(req.start.lat) || !isFinite(req.start.lng) ||
    !isFinite(req.dest.lat)  || !isFinite(req.dest.lng)
  ) {
    throw new Error('Routing failed: invalid coordinates');
  }
  return ROUTING_PROVIDER === 'osrm'
    ? fetchRouteOsrm(req)
    : fetchRouteValhalla(req);
}
