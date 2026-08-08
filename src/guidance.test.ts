import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import L from 'leaflet';
import { guidanceAnnouncement, setGuidanceCosting, updateGuidance, stopGuidance } from './guidance';
import { createInitialState } from './types';
import type { AppState } from './types';
import type { Route, RouteStep } from './routing';

function makeMap(): L.Map {
  return {
    removeLayer: () => undefined,
    addLayer: () => undefined,
  } as unknown as L.Map;
}

function makeRoute(coords: Array<[number, number]>, steps?: RouteStep[]): Route {
  return {
    coords: coords.map(([lat, lng]) => L.latLng(lat, lng)),
    steps: steps ?? [
      { instruction: 'Go', type: 1, lengthM: 100, durationS: 60, streetNames: [], beginShapeIndex: 0 },
    ],
    distanceM: 1000,
    durationS: 600,
  };
}

function setGuiding(
  state: AppState,
  route: Route,
  dest: { lat: number; lng: number; label: string },
): void {
  state.guidance.status = 'guiding';
  state.guidance.route = route;
  state.guidance.destination = dest;
  state.guidance.currentStepIdx = 0;
}

function fakeFix(lat: number, lng: number): L.LocationEvent {
  return {
    latlng: L.latLng(lat, lng),
    bounds: L.latLngBounds(L.latLng(lat, lng), L.latLng(lat, lng)),
    timestamp: 0,
    accuracy: 10,
    heading: NaN,
    speed: 0,
    altitude: null,
    altitudeAccuracy: 0,
    type: 'locationfound',
  } as unknown as L.LocationEvent;
}

function mockRouteFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      trip: {
        legs: [{ shape: '', maneuvers: [] }],
        summary: { length: 1, time: 60 },
      },
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('updateGuidance — status gating', () => {
  let state: AppState;
  let map: L.Map;

  beforeEach(() => {
    state = createInitialState();
    map = makeMap();
  });

  it('is a no-op when status is idle', () => {
    updateGuidance(fakeFix(40, -74), state, map);
    expect(state.guidance.status).toBe('idle');
  });

  it('is a no-op when status is routing', () => {
    state.guidance.status = 'routing';
    updateGuidance(fakeFix(40, -74), state, map);
    expect(state.guidance.status).toBe('routing');
  });

  it('is a no-op when status is arrived', () => {
    state.guidance.status = 'arrived';
    updateGuidance(fakeFix(40, -74), state, map);
    expect(state.guidance.status).toBe('arrived');
  });
});

describe('updateGuidance — arrival', () => {
  let state: AppState;
  let map: L.Map;

  beforeEach(() => {
    state = createInitialState();
    map = makeMap();
  });

  it('flips to arrived when within driving radius (25 m)', () => {
    const route = makeRoute([[40, -74], [40.001, -74]]);
    setGuiding(state, route, { lat: 40.001, lng: -74, label: 'X' });
    state.guidance.costing = 'auto';
    // ~12 m from dest (well within 25 m)
    updateGuidance(fakeFix(40.00089, -74), state, map);
    expect(state.guidance.status).toBe('arrived');
  });

  it('uses tighter pedestrian radius (10 m)', () => {
    const route = makeRoute([[40, -74], [40.001, -74]]);
    setGuiding(state, route, { lat: 40.001, lng: -74, label: 'X' });
    state.guidance.costing = 'pedestrian';
    // ~17 m from dest — outside pedestrian 10 m, would have been inside auto's 25 m
    updateGuidance(fakeFix(40.00085, -74), state, map);
    expect(state.guidance.status).toBe('guiding');
  });

  it('does not arrive when far from destination', () => {
    const route = makeRoute([[40, -74], [40.01, -74]]);
    setGuiding(state, route, { lat: 40.01, lng: -74, label: 'X' });
    state.guidance.costing = 'auto';
    updateGuidance(fakeFix(40, -74), state, map); // ~1.1 km away
    expect(state.guidance.status).toBe('guiding');
  });
});

describe('updateGuidance — off-route streak', () => {
  let state: AppState;
  let map: L.Map;

  beforeEach(() => {
    state = createInitialState();
    map = makeMap();
  });

  it('does not flip on the first off-route fix', () => {
    const route = makeRoute([[40, -74], [40, -73.99]]);
    setGuiding(state, route, { lat: 40, lng: -73.99, label: 'X' });
    state.guidance.costing = 'auto';
    // ~110 m north of midpoint — well off the auto 30 m threshold
    updateGuidance(fakeFix(40.001, -73.995), state, map);
    expect(state.guidance.offRouteStreak).toBe(1);
    expect(state.guidance.status).toBe('guiding');
  });

  it('flips to off-route on the third consecutive fix', () => {
    const route = makeRoute([[40, -74], [40, -73.99]]);
    setGuiding(state, route, { lat: 40, lng: -73.99, label: 'X' });
    state.guidance.costing = 'auto';
    updateGuidance(fakeFix(40.001, -73.995), state, map);
    updateGuidance(fakeFix(40.001, -73.995), state, map);
    expect(state.guidance.status).toBe('guiding');
    updateGuidance(fakeFix(40.001, -73.995), state, map);
    expect(state.guidance.status).toBe('off-route');
  });

  it('resets streak when fix returns to the segment', () => {
    const route = makeRoute([[40, -74], [40, -73.99]]);
    setGuiding(state, route, { lat: 40, lng: -73.99, label: 'X' });
    state.guidance.costing = 'auto';
    updateGuidance(fakeFix(40.001, -73.995), state, map);
    updateGuidance(fakeFix(40.001, -73.995), state, map);
    expect(state.guidance.offRouteStreak).toBe(2);
    updateGuidance(fakeFix(40, -73.995), state, map); // back on segment
    expect(state.guidance.offRouteStreak).toBe(0);
  });
});

describe('updateGuidance — step advance', () => {
  let state: AppState;
  let map: L.Map;

  beforeEach(() => {
    state = createInitialState();
    map = makeMap();
  });

  it('advances currentStepIdx when within step radius (10 m)', () => {
    const coords: Array<[number, number]> = [
      [40.0, -74.0],
      [40.001, -74.0], // step 2 begin
      [40.002, -74.0],
    ];
    const steps: RouteStep[] = [
      { instruction: 'Start', type: 1, lengthM: 100, durationS: 30, streetNames: [], beginShapeIndex: 0 },
      { instruction: 'Continue', type: 17, lengthM: 100, durationS: 30, streetNames: [], beginShapeIndex: 1 },
      { instruction: 'Arrive', type: 4, lengthM: 0, durationS: 0, streetNames: [], beginShapeIndex: 2 },
    ];
    const route = makeRoute(coords, steps);
    setGuiding(state, route, { lat: 40.002, lng: -74, label: 'X' });
    state.guidance.costing = 'auto';

    expect(state.guidance.currentStepIdx).toBe(0);
    // ~5 m from coords[1] — well within 10 m radius
    updateGuidance(fakeFix(40.000955, -74), state, map);
    expect(state.guidance.currentStepIdx).toBe(1);
  });
});

describe('startGuidance — re-entry', () => {
  it('shows a toast and returns when called while not idle', async () => {
    const { startGuidance } = await import('./guidance');
    const state = createInitialState();
    state.guidance.status = 'guiding';
    state.guidance.destination = { lat: 40, lng: -74, label: 'old' };
    const map = makeMap();
    const toasts: string[] = [];
    await startGuidance(
      state,
      map,
      { lat: 40.1, lng: -73.9, label: 'new' },
      (m) => toasts.push(m),
    );
    expect(state.guidance.status).toBe('guiding'); // unchanged
    expect(state.guidance.destination?.label).toBe('old');
    expect(toasts).toEqual(['Stop current navigation first']);
  });
});

describe('setGuidanceCosting', () => {
  it('updates the preferred costing while idle without fetching a route', async () => {
    const state = createInitialState();
    const map = makeMap();
    const fetchMock = mockRouteFetch();

    await expect(setGuidanceCosting(state, map, 'bicycle')).resolves.toBe(true);

    expect(state.guidance.costing).toBe('bicycle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches a replacement route for the current destination while guiding', async () => {
    const state = createInitialState();
    const map = makeMap();
    const route = makeRoute([[40, -74], [40, -73.99]]);
    const fetchMock = mockRouteFetch();
    const routeLine = { setStyle: vi.fn() } as unknown as L.Polyline;
    const routeGlow = { setStyle: vi.fn() } as unknown as L.Polyline;
    state.youAreHereLocation = L.latLng(40, -74);
    setGuiding(state, route, { lat: 40, lng: -73.99, label: 'X' });
    state.guidance.routePolyline = routeLine;
    state.guidance.routeGlow = routeGlow;

    await expect(setGuidanceCosting(state, map, 'pedestrian')).resolves.toBe(true);

    expect(state.guidance.costing).toBe('pedestrian');
    expect(state.guidance.status).toBe('guiding');
    expect(routeLine.setStyle).toHaveBeenCalledWith(expect.objectContaining({ color: '#9333ea' }));
    expect(routeGlow.setStyle).toHaveBeenCalledWith(expect.objectContaining({ color: 'rgba(147,51,234,0.25)' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { costing: string };
    expect(body.costing).toBe('pedestrian');
  });
});

describe('stopGuidance', () => {
  it('is a no-op when already idle', () => {
    const state = createInitialState();
    const map = makeMap();
    stopGuidance(state, map);
    expect(state.guidance.status).toBe('idle');
  });

  it('clears route refs and destination on stop', () => {
    const state = createInitialState();
    const map = makeMap();
    state.guidance.status = 'guiding';
    state.guidance.routePolyline = {} as L.Polyline;
    state.guidance.routeGlow = {} as L.Polyline;
    state.guidance.destMarker = {} as L.Marker;
    state.guidance.destination = { lat: 0, lng: 0, label: 'X' };
    state.guidance.route = makeRoute([[0, 0], [0, 1]]);
    state.guidance.currentStepIdx = 5;
    state.guidance.offRouteStreak = 2;

    stopGuidance(state, map);

    expect(state.guidance.status).toBe('idle');
    expect(state.guidance.destination).toBeNull();
    expect(state.guidance.route).toBeNull();
    expect(state.guidance.routePolyline).toBeNull();
    expect(state.guidance.routeGlow).toBeNull();
    expect(state.guidance.destMarker).toBeNull();
    expect(state.guidance.currentStepIdx).toBe(0);
    expect(state.guidance.offRouteStreak).toBe(0);
  });

  it('aborts in-flight recalc on stop', () => {
    const state = createInitialState();
    const map = makeMap();
    state.guidance.status = 'off-route';
    const ac = new AbortController();
    state.guidance.recalcInFlight = ac;
    stopGuidance(state, map);
    expect(ac.signal.aborted).toBe(true);
    expect(state.guidance.recalcInFlight).toBeNull();
  });
});

describe('guidanceAnnouncement', () => {
  const dest = { lat: 1, lng: 1, label: 'Pike Place Market' };

  it('says nothing when idle', () => {
    expect(guidanceAnnouncement(createInitialState())).toBe('');
  });

  it('is unchanged when only distance and ETA move', () => {
    // The whole point of #258: these fields change on every accepted GPS fix,
    // and the banner shows them. If they leaked into the announcement, a screen
    // reader would re-read the instruction about once a second.
    const state = createInitialState();
    setGuiding(state, makeRoute([[0, 0], [1, 1]]), dest);

    state.guidance.distanceToManeuverM = 400;
    state.guidance.distanceToDestinationM = 1200;
    const first = guidanceAnnouncement(state);

    state.guidance.distanceToManeuverM = 120;
    state.guidance.distanceToDestinationM = 900;
    expect(guidanceAnnouncement(state)).toBe(first);
  });

  it('changes when the maneuver advances', () => {
    const state = createInitialState();
    setGuiding(state, makeRoute([[0, 0], [1, 1]], [
      { instruction: 'Turn left onto Pine', type: 15, lengthM: 100, durationS: 60, streetNames: [], beginShapeIndex: 0 },
      { instruction: 'Turn right onto 1st', type: 10, lengthM: 100, durationS: 60, streetNames: [], beginShapeIndex: 1 },
    ]), dest);

    expect(guidanceAnnouncement(state)).toBe('Turn left onto Pine');
    state.guidance.currentStepIdx = 1;
    expect(guidanceAnnouncement(state)).toBe('Turn right onto 1st');
  });

  it('announces each status transition distinctly', () => {
    const state = createInitialState();
    setGuiding(state, makeRoute([[0, 0], [1, 1]]), dest);

    state.guidance.status = 'routing';
    expect(guidanceAnnouncement(state)).toBe('Routing to Pike Place Market');
    state.guidance.status = 'off-route';
    expect(guidanceAnnouncement(state)).toBe('Off route, recalculating');
    state.guidance.status = 'arrived';
    expect(guidanceAnnouncement(state)).toBe('Arrived at Pike Place Market');
  });

  it('survives a step index past the end of the route', () => {
    const state = createInitialState();
    setGuiding(state, makeRoute([[0, 0], [1, 1]]), dest);
    state.guidance.currentStepIdx = 99;
    expect(guidanceAnnouncement(state)).toBe('Go');
  });
});
