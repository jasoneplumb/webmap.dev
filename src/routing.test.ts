import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';
import { decodePolyline6, fetchRoute, VALHALLA_URL } from './routing';
import { fetchRouteValhalla } from './routing-valhalla';
import { fetchRouteOsrm, buildOsrmUrl, OSRM_BASE_URL } from './routing-osrm';
import {
  osrmManeuverToValhallaType,
  synthesizeOsrmInstruction,
} from './routing-osrm-instructions';

// Encode a list of [lat, lng] pairs to polyline6 — used to generate round-trip
// fixtures for the decoder. Mirrors the algorithm Valhalla uses.
function encodePolyline6(coords: Array<[number, number]>): string {
  let out = '';
  let lat = 0;
  let lng = 0;
  function chunk(value: number): string {
    let v = value < 0 ? ~(value << 1) >>> 0 : (value << 1) >>> 0;
    let s = '';
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>>= 5;
    }
    s += String.fromCharCode(v + 63);
    return s;
  }
  for (const [pLat, pLng] of coords) {
    const eLat = Math.round(pLat * 1e6);
    const eLng = Math.round(pLng * 1e6);
    out += chunk(eLat - lat);
    out += chunk(eLng - lng);
    lat = eLat;
    lng = eLng;
  }
  return out;
}

describe('decodePolyline6', () => {
  it('decodes a known three-point fixture', () => {
    const coords: Array<[number, number]> = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ];
    const decoded = decodePolyline6(encodePolyline6(coords));
    expect(decoded).toHaveLength(3);
    expect(decoded[0]?.lat).toBeCloseTo(38.5, 5);
    expect(decoded[0]?.lng).toBeCloseTo(-120.2, 5);
    expect(decoded[2]?.lat).toBeCloseTo(43.252, 5);
    expect(decoded[2]?.lng).toBeCloseTo(-126.453, 5);
  });

  it('round-trips dense urban polyline', () => {
    const coords: Array<[number, number]> = [
      [40.7128, -74.0060],
      [40.7130, -74.0058],
      [40.7135, -74.0050],
      [40.7140, -74.0040],
    ];
    const decoded = decodePolyline6(encodePolyline6(coords));
    decoded.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(coords[i]![0], 5);
      expect(p.lng).toBeCloseTo(coords[i]![1], 5);
    });
  });

  it('round-trips Southern Hemisphere coordinates', () => {
    // Sydney → Melbourne — exercises the negative-lat sign-extension path.
    const coords: Array<[number, number]> = [
      [-33.8688, 151.2093],
      [-37.8136, 144.9631],
    ];
    const decoded = decodePolyline6(encodePolyline6(coords));
    expect(decoded[0]?.lat).toBeCloseTo(-33.8688, 5);
    expect(decoded[1]?.lat).toBeCloseTo(-37.8136, 5);
  });

  it('returns empty array for empty input', () => {
    expect(decodePolyline6('')).toEqual([]);
  });

  it('does not throw on truncated input (documented behavior)', () => {
    // Mid-chunk truncation: past-end charCodeAt returns NaN, which bitwise-
    // ANDed with 0x1f coerces to 0. The decoder silently returns (0, 0)
    // rather than throwing. Callers needing strict validation should check
    // the returned coords against expected counts or extents.
    expect(() => decodePolyline6('_')).not.toThrow();
  });
});

describe('fetchRoute — provider dispatch + shared guards', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws before fetch when coordinates are not finite', async () => {
    // Cast around L.latLng's NaN check to exercise routing's own guard.
    const bad = { lat: NaN, lng: 0 } as L.LatLng;
    await expect(
      fetchRoute({
        start: bad,
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow(/invalid coordinates/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('dispatches to the default provider (Valhalla) via fetchRoute', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        trip: {
          legs: [{ shape: '', maneuvers: [] }],
          summary: { length: 0, time: 0 },
        },
      }),
    } as Response);
    await fetchRoute({
      start: L.latLng(0, 0),
      dest: L.latLng(1, 1),
      costing: 'auto',
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe(VALHALLA_URL);
    expect(opts.method).toBe('POST');
  });
});

describe('fetchRouteValhalla', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockOk(json: unknown): void {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => json,
    } as Response);
  }

  function emptyTrip() {
    return {
      trip: {
        legs: [{ shape: '', maneuvers: [] }],
        summary: { length: 0, time: 0 },
      },
    };
  }

  it('POSTs to Valhalla with the expected body shape', async () => {
    mockOk(emptyTrip());
    await fetchRouteValhalla({
      start: L.latLng(40, -74),
      dest: L.latLng(40.1, -73.9),
      costing: 'auto',
      units: 'metric',
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe(VALHALLA_URL);
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>)['content-type']).toBe('application/json');
    const body = JSON.parse(opts.body as string);
    expect(body.locations).toEqual([
      { lat: 40, lon: -74 },
      { lat: 40.1, lon: -73.9 },
    ]);
    expect(body.costing).toBe('auto');
    expect(body.directions_options).toEqual({ units: 'kilometers' });
  });

  it('requests miles from Valhalla and converts lengths when units=imperial', async () => {
    mockOk({
      trip: {
        legs: [{
          shape: '',
          maneuvers: [
            { type: 1, instruction: 'Drive 1 mile', length: 1, time: 60, begin_shape_index: 0 },
          ],
        }],
        summary: { length: 2, time: 120 },
      },
    });
    const r = await fetchRouteValhalla({
      start: L.latLng(0, 0),
      dest: L.latLng(1, 1),
      costing: 'auto',
      units: 'imperial',
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.directions_options).toEqual({ units: 'miles' });
    // Valhalla reports `length` in miles when miles are requested.
    expect(r.distanceM).toBeCloseTo(2 * 1609.344, 3);
    expect(r.steps[0]?.lengthM).toBeCloseTo(1609.344, 3);
  });

  it.each(['auto', 'pedestrian', 'bicycle'] as const)(
    'passes costing=%s through to the request body',
    async (costing) => {
      mockOk(emptyTrip());
      await fetchRouteValhalla({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing,
      });
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.costing).toBe(costing);
    },
  );

  it('throws on non-ok HTTP response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    await expect(
      fetchRouteValhalla({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow(/^HTTP 500$/);
  });

  it('converts a network-level fetch failure into an actionable message', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError('Failed to fetch'),
    );
    await expect(
      fetchRouteValhalla({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow(/routing service unavailable/);
  });

  it('propagates an AbortError unchanged', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException('aborted', 'AbortError'),
    );
    await expect(
      fetchRouteValhalla({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow(/aborted/);
  });

  it('throws when Valhalla returns multiple legs', async () => {
    mockOk({
      trip: {
        legs: [
          { shape: '', maneuvers: [] },
          { shape: '', maneuvers: [] },
        ],
        summary: { length: 0, time: 0 },
      },
    });
    await expect(
      fetchRouteValhalla({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow(/multi-leg/);
  });

  it('throws when Valhalla returns no legs', async () => {
    mockOk({ trip: { legs: [], summary: { length: 0, time: 0 } } });
    await expect(
      fetchRouteValhalla({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow('no legs');
  });

  it('passes AbortSignal through to fetch', async () => {
    mockOk(emptyTrip());
    const ac = new AbortController();
    await fetchRouteValhalla({
      start: L.latLng(0, 0),
      dest: L.latLng(1, 1),
      costing: 'auto',
      signal: ac.signal,
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0]![1].signal).toBe(ac.signal);
  });

  it('parses summary distance/duration into meters/seconds', async () => {
    mockOk({
      trip: {
        legs: [{ shape: '', maneuvers: [] }],
        summary: { length: 1.5, time: 300 },
      },
    });
    const r = await fetchRouteValhalla({
      start: L.latLng(0, 0),
      dest: L.latLng(1, 1),
      costing: 'auto',
      units: 'metric',
    });
    expect(r.distanceM).toBe(1500);
    expect(r.durationS).toBe(300);
  });

  it('maps maneuvers to RouteSteps', async () => {
    mockOk({
      trip: {
        legs: [{
          shape: '',
          maneuvers: [
            {
              type: 1,
              instruction: 'Drive east on Main St',
              length: 0.2,
              time: 30,
              street_names: ['Main St'],
              begin_shape_index: 0,
            },
            {
              type: 4,
              instruction: 'You have arrived',
              length: 0,
              time: 0,
              begin_shape_index: 5,
            },
          ],
        }],
        summary: { length: 0.2, time: 30 },
      },
    });
    const r = await fetchRouteValhalla({
      start: L.latLng(0, 0),
      dest: L.latLng(1, 1),
      costing: 'auto',
      units: 'metric',
    });
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0]?.instruction).toBe('Drive east on Main St');
    expect(r.steps[0]?.lengthM).toBe(200);
    expect(r.steps[0]?.streetNames).toEqual(['Main St']);
    expect(r.steps[1]?.streetNames).toEqual([]);
  });
});

describe('buildOsrmUrl', () => {
  it('serialises lon,lat coordinate pairs in OSRM order', () => {
    const url = buildOsrmUrl({
      start: L.latLng(40.7, -74.0),
      dest: L.latLng(40.8, -73.9),
      costing: 'auto',
    });
    expect(url).toContain('/-74,40.7;-73.9,40.8?');
    expect(url).toContain('overview=full');
    expect(url).toContain('geometries=polyline6');
    expect(url).toContain('steps=true');
    expect(url.startsWith(OSRM_BASE_URL)).toBe(true);
  });

  it.each([
    ['auto',       'routed-car',  'driving'],
    ['bicycle',    'routed-bike', 'cycling'],
    ['pedestrian', 'routed-foot', 'walking'],
  ] as const)('maps costing=%s to backend=%s, profile=%s', (costing, backend, profile) => {
    const url = buildOsrmUrl({
      start: L.latLng(0, 0),
      dest: L.latLng(1, 1),
      costing,
    });
    expect(url).toContain(`/${backend}/route/v1/${profile}/`);
  });
});

describe('fetchRouteOsrm', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockOk(json: unknown): void {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => json,
    } as Response);
  }

  function osrmOk(steps: Array<{
    geometry: string;
    type: string;
    modifier?: string;
    distance: number;
    duration: number;
    name?: string;
  }>, summary: { distance: number; duration: number }) {
    return {
      code: 'Ok',
      routes: [{
        geometry: '',
        legs: [{
          steps: steps.map((s) => ({
            geometry: s.geometry,
            maneuver: { type: s.type, modifier: s.modifier, location: [0, 0] },
            distance: s.distance,
            duration: s.duration,
            name: s.name ?? '',
          })),
          distance: summary.distance,
          duration: summary.duration,
        }],
        distance: summary.distance,
        duration: summary.duration,
      }],
    };
  }

  it('GETs the OSRM URL (no body) and passes AbortSignal', async () => {
    mockOk(osrmOk([], { distance: 0, duration: 0 }));
    const ac = new AbortController();
    await fetchRouteOsrm({
      start: L.latLng(40, -74),
      dest: L.latLng(40.1, -73.9),
      costing: 'auto',
      signal: ac.signal,
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/routed-car/route/v1/driving/');
    expect(opts?.method).toBeUndefined();
    expect(opts?.body).toBeUndefined();
    expect(opts.signal).toBe(ac.signal);
  });

  it('throws when OSRM returns a non-Ok code', async () => {
    mockOk({ code: 'NoRoute', message: 'no route found' });
    await expect(
      fetchRouteOsrm({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow(/NoRoute/);
  });

  it('throws on non-ok HTTP response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);
    await expect(
      fetchRouteOsrm({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow(/^HTTP 503$/);
  });

  it('converts a network-level fetch failure into an actionable message', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError('Failed to fetch'),
    );
    await expect(
      fetchRouteOsrm({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow(/routing service unavailable/);
  });

  it('propagates an AbortError unchanged', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException('aborted', 'AbortError'),
    );
    await expect(
      fetchRouteOsrm({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow(/aborted/);
  });

  it('throws when OSRM returns multiple legs', async () => {
    mockOk({
      code: 'Ok',
      routes: [{
        geometry: '',
        legs: [
          { steps: [], distance: 0, duration: 0 },
          { steps: [], distance: 0, duration: 0 },
        ],
        distance: 0,
        duration: 0,
      }],
    });
    await expect(
      fetchRouteOsrm({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow(/multi-leg/);
  });

  it('builds coords by concatenating step geometries with shared-endpoint dedup', async () => {
    const segA = encodePolyline6([[40.0, -74.0], [40.001, -74.0]]);
    const segB = encodePolyline6([[40.001, -74.0], [40.002, -74.0]]);
    const segArrive = encodePolyline6([[40.002, -74.0]]);
    mockOk(osrmOk(
      [
        { geometry: segA, type: 'depart', distance: 110, duration: 12, name: 'Main St' },
        { geometry: segB, type: 'turn', modifier: 'right', distance: 110, duration: 12, name: '2nd Ave' },
        { geometry: segArrive, type: 'arrive', distance: 0, duration: 0, name: '' },
      ],
      { distance: 220, duration: 24 },
    ));
    const r = await fetchRouteOsrm({
      start: L.latLng(40.0, -74.0),
      dest: L.latLng(40.002, -74.0),
      costing: 'auto',
    });
    expect(r.coords).toHaveLength(3);
    expect(r.coords[0]?.lat).toBeCloseTo(40.0, 5);
    expect(r.coords[1]?.lat).toBeCloseTo(40.001, 5);
    expect(r.coords[2]?.lat).toBeCloseTo(40.002, 5);
    expect(r.steps).toHaveLength(3);
    // Step 0 starts at coord index 0 (depart).
    expect(r.steps[0]?.beginShapeIndex).toBe(0);
    // Step 1 starts at the shared endpoint (index 1 in the concatenated coords).
    expect(r.steps[1]?.beginShapeIndex).toBe(1);
    // Arrive step sits at the last coord.
    expect(r.steps[2]?.beginShapeIndex).toBe(2);
    expect(r.distanceM).toBe(220);
    expect(r.durationS).toBe(24);
  });

  it('maps OSRM maneuvers to Valhalla type numbers + synthesizes instructions', async () => {
    const seg = encodePolyline6([[40.0, -74.0], [40.001, -74.0]]);
    mockOk(osrmOk(
      [
        { geometry: seg, type: 'depart', distance: 50, duration: 6, name: 'Main St' },
        { geometry: seg, type: 'turn', modifier: 'left', distance: 50, duration: 6, name: 'Elm St' },
        { geometry: seg, type: 'arrive', distance: 0, duration: 0, name: '' },
      ],
      { distance: 100, duration: 12 },
    ));
    const r = await fetchRouteOsrm({
      start: L.latLng(40.0, -74.0),
      dest: L.latLng(40.002, -74.0),
      costing: 'auto',
    });
    expect(r.steps[0]?.type).toBe(1); // start
    expect(r.steps[0]?.instruction).toBe('Head out on Main St');
    expect(r.steps[0]?.streetNames).toEqual(['Main St']);
    expect(r.steps[1]?.type).toBe(15); // left
    expect(r.steps[1]?.instruction).toBe('Turn left onto Elm St');
    expect(r.steps[2]?.type).toBe(4); // destination
    expect(r.steps[2]?.instruction).toBe('Arrive at destination');
  });

  it('uses OSRM step distance/duration directly (already metric)', async () => {
    const seg = encodePolyline6([[0, 0], [0.001, 0]]);
    mockOk(osrmOk(
      [
        { geometry: seg, type: 'depart', distance: 123.4, duration: 56, name: '' },
        { geometry: seg, type: 'arrive', distance: 0, duration: 0, name: '' },
      ],
      { distance: 123.4, duration: 56 },
    ));
    const r = await fetchRouteOsrm({
      start: L.latLng(0, 0),
      dest: L.latLng(0.001, 0),
      costing: 'auto',
    });
    expect(r.steps[0]?.lengthM).toBe(123.4);
    expect(r.steps[0]?.durationS).toBe(56);
    expect(r.distanceM).toBe(123.4);
    expect(r.durationS).toBe(56);
  });
});

describe('osrmManeuverToValhallaType', () => {
  it.each([
    ['depart',  undefined,        1],
    ['arrive',  undefined,        4],
    ['turn',    'left',           15],
    ['turn',    'right',          10],
    ['turn',    'slight left',    16],
    ['turn',    'slight right',   9],
    ['turn',    'sharp left',     14],
    ['turn',    'sharp right',    11],
    ['turn',    'uturn',          12],
    ['continue', 'straight',      8],
    ['continue', undefined,       8],
    ['new name', undefined,       8],
    ['merge',    undefined,       25],
    ['on ramp',  'right',         18],
    ['on ramp',  'left',          19],
    ['off ramp', 'right',         20],
    ['off ramp', 'left',          21],
    ['fork',     'left',          24],
    ['fork',     'right',         23],
    ['fork',     'straight',      22],
    ['roundabout', undefined,     26],
    ['rotary',    undefined,      26],
  ] as const)('maps %s/%s → %i', (type, modifier, expected) => {
    expect(osrmManeuverToValhallaType(type, modifier)).toBe(expected);
  });

  it('falls back to 0 for unknown maneuver types', () => {
    expect(osrmManeuverToValhallaType('something-new')).toBe(0);
  });
});

describe('synthesizeOsrmInstruction', () => {
  it('includes the street name when provided', () => {
    expect(synthesizeOsrmInstruction('turn', 'right', 'Main St')).toBe('Turn right onto Main St');
  });

  it('omits the onto-clause when name is empty', () => {
    expect(synthesizeOsrmInstruction('turn', 'left', '')).toBe('Turn left');
  });

  it('synthesizes a depart maneuver', () => {
    expect(synthesizeOsrmInstruction('depart', undefined, 'Highway 5')).toBe('Head out on Highway 5');
    expect(synthesizeOsrmInstruction('depart', undefined, '')).toBe('Head out');
  });

  it('synthesizes an arrive maneuver', () => {
    expect(synthesizeOsrmInstruction('arrive', undefined, '')).toBe('Arrive at destination');
  });

  it('synthesizes continue with straight modifier', () => {
    expect(synthesizeOsrmInstruction('continue', 'straight', 'Highway 5')).toBe('Continue on Highway 5');
  });

  it('synthesizes a U-turn', () => {
    expect(synthesizeOsrmInstruction('turn', 'uturn', 'Main St')).toBe('Make a U-turn onto Main St');
  });

  it('synthesizes a roundabout', () => {
    expect(synthesizeOsrmInstruction('roundabout', undefined, 'A1')).toBe('Enter the roundabout onto A1');
  });

  it('falls back to a continue instruction for unknown types', () => {
    expect(synthesizeOsrmInstruction('mystery', undefined, 'Foo')).toBe('Continue on Foo');
    expect(synthesizeOsrmInstruction('mystery', undefined, '')).toBe('Continue');
  });
});
