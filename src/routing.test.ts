import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';
import { decodePolyline6, fetchRoute, VALHALLA_URL } from './routing';

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

describe('fetchRoute', () => {
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
    await fetchRoute({
      start: L.latLng(40, -74),
      dest: L.latLng(40.1, -73.9),
      costing: 'auto',
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

  it.each(['auto', 'pedestrian', 'bicycle'] as const)(
    'passes costing=%s through to the request body',
    async (costing) => {
      mockOk(emptyTrip());
      await fetchRoute({
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
      fetchRoute({
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
      fetchRoute({
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
      fetchRoute({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow(/aborted/);
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
      fetchRoute({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow(/multi-leg/);
  });

  it('throws when Valhalla returns no legs', async () => {
    mockOk({ trip: { legs: [], summary: { length: 0, time: 0 } } });
    await expect(
      fetchRoute({
        start: L.latLng(0, 0),
        dest: L.latLng(1, 1),
        costing: 'auto',
      }),
    ).rejects.toThrow('no legs');
  });

  it('passes AbortSignal through to fetch', async () => {
    mockOk(emptyTrip());
    const ac = new AbortController();
    await fetchRoute({
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
    const r = await fetchRoute({
      start: L.latLng(0, 0),
      dest: L.latLng(1, 1),
      costing: 'auto',
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
    const r = await fetchRoute({
      start: L.latLng(0, 0),
      dest: L.latLng(1, 1),
      costing: 'auto',
    });
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0]?.instruction).toBe('Drive east on Main St');
    expect(r.steps[0]?.lengthM).toBe(200);
    expect(r.steps[0]?.streetNames).toEqual(['Main St']);
    expect(r.steps[1]?.streetNames).toEqual([]);
  });
});
