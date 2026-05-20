// Privacy: each request sends start + destination to the public FOSSGIS Valhalla
// instance. ADR-006 + the consent flow document the tradeoff before any nav action.
import L from 'leaflet';

export type Costing = 'auto' | 'pedestrian' | 'bicycle';

export interface RouteStep {
  instruction: string;
  /** Valhalla maneuver type number — see https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/#maneuver-types */
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
}

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route' as const;

/**
 * Decode Valhalla's polyline6 (precision 6 — twice the resolution of standard Google polyline5).
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

interface ValhallaManeuver {
  type: number;
  instruction: string;
  length: number; // km (we requested kilometers)
  time: number; // seconds
  street_names?: string[];
  begin_shape_index: number;
}

interface ValhallaResponse {
  trip: {
    legs: Array<{
      shape: string;
      maneuvers: ValhallaManeuver[];
    }>;
    summary: {
      length: number; // km
      time: number; // seconds
    };
  };
}

/** Fetch a route from Valhalla. AbortController-friendly. */
export async function fetchRoute(req: RouteRequest): Promise<Route> {
  if (
    !isFinite(req.start.lat) || !isFinite(req.start.lng) ||
    !isFinite(req.dest.lat)  || !isFinite(req.dest.lng)
  ) {
    throw new Error('Routing failed: invalid coordinates');
  }
  const body = {
    locations: [
      { lat: req.start.lat, lon: req.start.lng },
      { lat: req.dest.lat, lon: req.dest.lng },
    ],
    costing: req.costing,
    directions_options: { units: 'kilometers' },
  };
  let res: Response;
  try {
    res = await fetch(VALHALLA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal,
    });
  } catch (err) {
    // An aborted request must propagate unchanged so callers can detect it.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // fetch() rejects with a TypeError for any network-level failure (DNS,
    // connection refused, TLS, blocked CORS preflight). The browser surfaces
    // these in the console as an opaque "CORS request did not succeed" with a
    // null status — there is no HTTP response to inspect. Convert it into a
    // message a user can act on instead of leaking the raw TypeError.
    throw new Error('routing service unavailable — check your connection or try again later');
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json = (await res.json()) as ValhallaResponse;
  if (json.trip.legs.length > 1) {
    // Two-point requests should always return exactly one leg. Guard against
    // a future change that introduces multi-waypoint without updating
    // distance/duration aggregation.
    throw new Error('Routing returned multi-leg trip — only single leg supported');
  }
  const leg = json.trip.legs[0];
  if (!leg) throw new Error('Routing returned no legs');
  const coords = decodePolyline6(leg.shape);
  const steps: RouteStep[] = leg.maneuvers.map((m) => ({
    instruction: m.instruction,
    type: m.type,
    lengthM: m.length * 1000,
    durationS: m.time,
    streetNames: m.street_names ?? [],
    beginShapeIndex: m.begin_shape_index,
  }));
  return {
    coords,
    steps,
    distanceM: json.trip.summary.length * 1000,
    durationS: json.trip.summary.time,
  };
}
