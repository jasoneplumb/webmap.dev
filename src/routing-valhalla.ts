// FOSSGIS Valhalla client. POST /route with JSON; response is verbose but
// already carries prose instruction strings, so no synthesis is needed.

import { decodePolyline6, type Route, type RouteRequest, type RouteStep } from './routing';
import { unitSystem, valhallaUnits, metersPerValhallaUnit } from './units';

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route' as const;

interface ValhallaManeuver {
  type: number;
  instruction: string;
  length: number; // in the units requested via directions_options
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
      length: number; // in the units requested via directions_options
      time: number; // seconds
    };
  };
}

export async function fetchRouteValhalla(req: RouteRequest): Promise<Route> {
  const system = req.units ?? unitSystem();
  const body = {
    locations: [
      { lat: req.start.lat, lon: req.start.lng },
      { lat: req.dest.lat, lon: req.dest.lng },
    ],
    costing: req.costing,
    directions_options: { units: valhallaUnits(system) },
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
  const mPerUnit = metersPerValhallaUnit(system);
  const coords = decodePolyline6(leg.shape);
  const steps: RouteStep[] = leg.maneuvers.map((m) => ({
    instruction: m.instruction,
    type: m.type,
    lengthM: m.length * mPerUnit,
    durationS: m.time,
    streetNames: m.street_names ?? [],
    beginShapeIndex: m.begin_shape_index,
  }));
  return {
    coords,
    steps,
    distanceM: json.trip.summary.length * mPerUnit,
    durationS: json.trip.summary.time,
  };
}
