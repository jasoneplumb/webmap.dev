// OSRM client targeting the OSM-DE public backends at
// https://routing.openstreetmap.de. Each profile has its own sub-path
// (routed-car / routed-bike / routed-foot) — within a backend, the URL still
// carries the standard OSRM profile token even though the backend only serves
// one.
//
// Unlike Valhalla, OSRM returns no prose: we synthesize instructions from
// `maneuver.type` + `maneuver.modifier` + `step.name` (routing-osrm-instructions.ts).

import L from 'leaflet';
import { decodePolyline6, type Costing, type Route, type RouteRequest, type RouteStep } from './routing';
import {
  osrmManeuverToValhallaType,
  synthesizeOsrmInstruction,
} from './routing-osrm-instructions';

export const OSRM_BASE_URL = 'https://routing.openstreetmap.de' as const;

interface OsrmManeuver {
  type: string;
  modifier?: string;
  location: [number, number]; // [lon, lat]
}

interface OsrmStep {
  geometry: string;
  maneuver: OsrmManeuver;
  distance: number; // metres
  duration: number; // seconds
  name: string;
  ref?: string;
}

interface OsrmLeg {
  steps: OsrmStep[];
  distance: number;
  duration: number;
}

interface OsrmRoute {
  geometry: string;
  legs: OsrmLeg[];
  distance: number;
  duration: number;
}

interface OsrmResponse {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
}

/** OSM-DE backend path for a costing profile. */
function osrmBackend(c: Costing): string {
  switch (c) {
    case 'auto':       return 'routed-car';
    case 'bicycle':    return 'routed-bike';
    case 'pedestrian': return 'routed-foot';
  }
}

/** Standard OSRM profile token within a backend's URL. */
function osrmProfile(c: Costing): string {
  switch (c) {
    case 'auto':       return 'driving';
    case 'bicycle':    return 'cycling';
    case 'pedestrian': return 'walking';
  }
}

export function buildOsrmUrl(req: RouteRequest): string {
  const backend = osrmBackend(req.costing);
  const profile = osrmProfile(req.costing);
  const coords =
    `${req.start.lng},${req.start.lat};${req.dest.lng},${req.dest.lat}`;
  const params = 'overview=full&geometries=polyline6&steps=true';
  return `${OSRM_BASE_URL}/${backend}/route/v1/${profile}/${coords}?${params}`;
}

export async function fetchRouteOsrm(req: RouteRequest): Promise<Route> {
  const url = buildOsrmUrl(req);
  let res: Response;
  try {
    res = await fetch(url, { signal: req.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error('routing service unavailable — check your connection or try again later');
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json = (await res.json()) as OsrmResponse;
  if (json.code !== 'Ok') {
    throw new Error(`Routing failed: ${json.code}${json.message ? ` — ${json.message}` : ''}`);
  }
  const route = json.routes?.[0];
  if (!route) throw new Error('Routing returned no routes');
  if (route.legs.length > 1) {
    // Two-point requests should always return exactly one leg.
    throw new Error('Routing returned multi-leg trip — only single leg supported');
  }
  const leg = route.legs[0];
  if (!leg) throw new Error('Routing returned no legs');

  const coords: L.LatLng[] = [];
  const steps: RouteStep[] = [];
  for (const step of leg.steps) {
    const segCoords = decodePolyline6(step.geometry);
    // beginShapeIndex points to where this step starts in the unified coords
    // array. When concatenating, the last coord of the previous step is the
    // same point as the first coord of this step — dedupe and reuse its index.
    const beginShapeIndex = coords.length === 0 ? 0 : coords.length - 1;
    if (coords.length > 0 && segCoords.length > 0) {
      for (let i = 1; i < segCoords.length; i++) coords.push(segCoords[i]!);
    } else {
      for (const c of segCoords) coords.push(c);
    }
    const name = step.name ?? '';
    const streetNames: string[] = [];
    if (name) streetNames.push(name);
    steps.push({
      instruction: synthesizeOsrmInstruction(step.maneuver.type, step.maneuver.modifier, name),
      type: osrmManeuverToValhallaType(step.maneuver.type, step.maneuver.modifier),
      lengthM: step.distance,
      durationS: step.duration,
      streetNames,
      beginShapeIndex,
    });
  }

  return {
    coords,
    steps,
    distanceM: route.distance,
    durationS: route.duration,
  };
}
