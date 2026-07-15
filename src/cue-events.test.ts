import { describe, it, expect } from 'vitest';
import { outcomeColor, formatCueLabel, formatMarkerLabel, parseCueEvents } from './cue-events';

// Synthetic coordinates only — never real ride geometry.
function syntheticCue(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0.001, 0.0005] },
    properties: {
      kind: 'cue',
      event_id: 1977782249,
      segment_id: 1977782249,
      ride_clock: '10:27',
      lead_time_s: 15,
      severity: 200,
      confidence: 165,
      reasons_bitmask: 7,
      delivered: true,
      latency_ms: 752,
      outcome: 'useful',
      approx: true,
      ...overrides,
    },
  };
}

function syntheticMarker(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0.002, 0.001] },
    properties: {
      kind: 'marker',
      segment_id: 2626284579,
      ride_clock: '55:03',
      approx: true,
      ...overrides,
    },
  };
}

function syntheticTrack(coordinates: unknown = [[0.001, 0.0005], [0.0011, 0.00055], [0.0012, 0.0006]]): unknown {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: { kind: 'track' },
  };
}

function collection(...features: unknown[]): string {
  return JSON.stringify({ type: 'FeatureCollection', features });
}

describe('outcomeColor', () => {
  it('maps each review grade to its color', () => {
    expect(outcomeColor('useful')).toBe('#2e7d32');
    expect(outcomeColor('false_alarm')).toBe('#d63131');
    expect(outcomeColor('too_late')).toBe('#f57c00');
    expect(outcomeColor('missed_risk')).toBe('#7b1fa2');
  });

  it('maps ungraded (absent outcome) to gray', () => {
    expect(outcomeColor(undefined)).toBe('#757575');
  });
});

describe('formatCueLabel', () => {
  it('formats id, ride clock, lead time, delivery latency, outcome, and decoded reasons', () => {
    expect(
      formatCueLabel({
        kind: 'cue',
        event_id: 1977782249,
        ride_clock: '10:27',
        lead_time_s: 15,
        reasons_bitmask: 7,
        delivered: true,
        latency_ms: 752,
        outcome: 'useful',
      }),
    ).toBe('cue 1977782249 · 10:27 · lead 15 s · delivered 752 ms · useful · narrow lane, no shoulder / bike lane, high-speed traffic');
  });

  it('omits absent fields', () => {
    expect(formatCueLabel({ kind: 'cue', event_id: 42 })).toBe('cue 42');
    expect(formatCueLabel({ kind: 'cue', event_id: 42, ride_clock: '01:02' })).toBe('cue 42 · 01:02');
  });

  it('renders delivered: false as "not delivered" and suppresses latency', () => {
    expect(
      formatCueLabel({ kind: 'cue', event_id: 7, delivered: false, latency_ms: 900, outcome: 'too_late' }),
    ).toBe('cue 7 · not delivered · too late');
  });

  it('renders latency as delivered when the delivered flag is absent', () => {
    expect(formatCueLabel({ kind: 'cue', event_id: 8, latency_ms: 640 })).toBe('cue 8 · delivered 640 ms');
  });

  it('renders outcomes with spaces, not underscores', () => {
    expect(formatCueLabel({ kind: 'cue', event_id: 1, outcome: 'false_alarm' })).toBe('cue 1 · false alarm');
    expect(formatCueLabel({ kind: 'cue', event_id: 1, outcome: 'missed_risk' })).toBe('cue 1 · missed risk');
  });

  it('includes reserved labels for unknown reason bits and omits a zero bitmask', () => {
    expect(formatCueLabel({ kind: 'cue', event_id: 3, reasons_bitmask: 9 }))
      .toBe('cue 3 · narrow lane, reserved(bit 3)');
    expect(formatCueLabel({ kind: 'cue', event_id: 3, reasons_bitmask: 0 })).toBe('cue 3');
  });

  it('indicates approximate placement only when approx is true', () => {
    expect(formatCueLabel({ kind: 'cue', event_id: 9, approx: true })).toBe('cue 9 · approximate position');
    expect(formatCueLabel({ kind: 'cue', event_id: 9, approx: false })).toBe('cue 9');
    expect(formatCueLabel({ kind: 'cue', event_id: 9 })).toBe('cue 9');
  });
});

describe('formatMarkerLabel', () => {
  it('formats a rider marker with its ride clock', () => {
    expect(formatMarkerLabel({ kind: 'marker', ride_clock: '55:03' })).toBe('marked unsafe · 55:03');
  });

  it('omits an absent ride clock', () => {
    expect(formatMarkerLabel({ kind: 'marker' })).toBe('marked unsafe');
  });

  it('indicates approximate placement only when approx is true', () => {
    expect(formatMarkerLabel({ kind: 'marker', approx: true })).toBe('marked unsafe · approximate position');
    expect(formatMarkerLabel({ kind: 'marker', approx: false })).toBe('marked unsafe');
  });
});

describe('parseCueEvents', () => {
  it('parses a valid FeatureCollection into normalized features', () => {
    const features = parseCueEvents(collection(syntheticCue(), syntheticMarker()));
    expect(features).toHaveLength(2);
    expect(features[0]).toEqual({
      coordinate: [0.001, 0.0005],
      properties: {
        kind: 'cue',
        event_id: 1977782249,
        ride_clock: '10:27',
        lead_time_s: 15,
        reasons_bitmask: 7,
        delivered: true,
        latency_ms: 752,
        outcome: 'useful',
        approx: true,
      },
    });
    expect(features[1]).toEqual({
      coordinate: [0.002, 0.001],
      properties: { kind: 'marker', ride_clock: '55:03', approx: true },
    });
  });

  it('accepts a cue with only the required fields (ungraded, no sidecar)', () => {
    const bare = syntheticCue({
      ride_clock: undefined,
      lead_time_s: undefined,
      reasons_bitmask: undefined,
      delivered: undefined,
      latency_ms: undefined,
      outcome: undefined,
      approx: undefined,
    });
    const features = parseCueEvents(collection(bare));
    expect(features[0]!.properties).toEqual({ kind: 'cue', event_id: 1977782249 });
  });

  it('accepts an empty FeatureCollection', () => {
    expect(parseCueEvents(collection())).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseCueEvents('{nope')).toThrow('not valid JSON');
  });

  it('throws when the root is not a FeatureCollection', () => {
    expect(() => parseCueEvents('[]')).toThrow('not a GeoJSON FeatureCollection');
    expect(() => parseCueEvents('{"type":"Feature"}')).toThrow('not a GeoJSON FeatureCollection');
  });

  it('throws on non-Point geometry', () => {
    const bad = { ...(syntheticCue() as object), geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } };
    expect(() => parseCueEvents(collection(bad))).toThrow('geometry must be a Point');
  });

  it('throws on non-numeric coordinates', () => {
    const bad = { ...(syntheticCue() as object), geometry: { type: 'Point', coordinates: ['a', 1] } };
    expect(() => parseCueEvents(collection(bad))).toThrow('number pair');
  });

  it('throws on an unknown kind', () => {
    expect(() => parseCueEvents(collection(syntheticCue({ kind: 'zone' }))))
      .toThrow('kind must be "cue", "marker", or "track"');
    expect(() => parseCueEvents(collection(syntheticCue({ kind: undefined }))))
      .toThrow('kind must be "cue", "marker", or "track"');
  });

  it('throws when a cue is missing event_id', () => {
    expect(() => parseCueEvents(collection(syntheticCue({ event_id: undefined }))))
      .toThrow('event_id must be a number');
  });

  it('throws when an optional field has the wrong type', () => {
    expect(() => parseCueEvents(collection(syntheticCue({ latency_ms: '752' }))))
      .toThrow('latency_ms must be a number');
    expect(() => parseCueEvents(collection(syntheticCue({ delivered: 'yes' }))))
      .toThrow('delivered must be a boolean');
    expect(() => parseCueEvents(collection(syntheticCue({ ride_clock: 627 }))))
      .toThrow('ride_clock must be a string');
    expect(() => parseCueEvents(collection(syntheticCue({ approx: 'yes' }))))
      .toThrow('approx must be a boolean');
  });

  it('parses a track feature into its coordinate list', () => {
    const features = parseCueEvents(collection(syntheticTrack(), syntheticCue({ approx: undefined })));
    expect(features).toHaveLength(2);
    expect(features[0]).toEqual({
      coordinates: [[0.001, 0.0005], [0.0011, 0.00055], [0.0012, 0.0006]],
      properties: { kind: 'track' },
    });
  });

  it('throws when a track is not a LineString', () => {
    const bad = { ...(syntheticTrack() as object), geometry: { type: 'Point', coordinates: [0, 0] } };
    expect(() => parseCueEvents(collection(bad))).toThrow('track geometry must be a LineString');
  });

  it('throws when a track has fewer than 2 positions', () => {
    expect(() => parseCueEvents(collection(syntheticTrack([[0.001, 0.0005]]))))
      .toThrow('track must have at least 2 positions');
    expect(() => parseCueEvents(collection(syntheticTrack([]))))
      .toThrow('track must have at least 2 positions');
  });

  it('throws when a track position is not a [lng, lat] number pair', () => {
    expect(() => parseCueEvents(collection(syntheticTrack([[0.001, 0.0005], ['a', 1]]))))
      .toThrow('track positions must be [lng, lat] number pairs');
    expect(() => parseCueEvents(collection(syntheticTrack([[0.001, 0.0005], 7]))))
      .toThrow('track positions must be [lng, lat] number pairs');
  });

  it('throws on more than one track feature', () => {
    expect(() => parseCueEvents(collection(syntheticTrack(), syntheticTrack())))
      .toThrow('feature 1: more than one track feature');
  });

  it('throws on an unknown outcome grade', () => {
    expect(() => parseCueEvents(collection(syntheticCue({ outcome: 'great' }))))
      .toThrow('outcome must be one of useful, false_alarm, too_late, missed_risk');
  });

  it('throws (all-or-nothing) when only a later feature is malformed', () => {
    expect(() => parseCueEvents(collection(syntheticCue(), syntheticMarker({ ride_clock: 5 }))))
      .toThrow('feature 1: property ride_clock must be a string');
  });
});
