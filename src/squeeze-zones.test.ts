import { describe, it, expect } from 'vitest';
import { decodeReasons, severityColor, formatZoneLabel, parseSqueezeZones } from './squeeze-zones';

// Synthetic coordinates only — never real ride-region geometry.
function syntheticFeature(overrides: Record<string, unknown> = {}, coordinates?: unknown): unknown {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: coordinates ?? [[0, 0], [0.001, 0.0005]],
    },
    properties: {
      event_id: 57053650,
      segment_id: 57053650,
      severity: 200,
      confidence: 165,
      reasons_bitmask: 7,
      length_m: 503,
      ...overrides,
    },
  };
}

function collection(...features: unknown[]): string {
  return JSON.stringify({ type: 'FeatureCollection', features });
}

describe('decodeReasons', () => {
  it('decodes each known bit', () => {
    expect(decodeReasons(1)).toEqual(['narrow lane']);
    expect(decodeReasons(2)).toEqual(['no shoulder / bike lane']);
    expect(decodeReasons(4)).toEqual(['high-speed traffic']);
  });

  it('decodes combined bits in bit order', () => {
    expect(decodeReasons(7)).toEqual(['narrow lane', 'no shoulder / bike lane', 'high-speed traffic']);
    expect(decodeReasons(5)).toEqual(['narrow lane', 'high-speed traffic']);
  });

  it('returns empty for a zero bitmask', () => {
    expect(decodeReasons(0)).toEqual([]);
  });

  it('renders unknown bits as reserved(bit N)', () => {
    expect(decodeReasons(8)).toEqual(['reserved(bit 3)']);
    expect(decodeReasons(1 << 15)).toEqual(['reserved(bit 15)']);
    expect(decodeReasons(1 | (1 << 4))).toEqual(['narrow lane', 'reserved(bit 4)']);
  });
});

describe('severityColor', () => {
  it('buckets ≥192 to red-ish', () => {
    expect(severityColor(192)).toBe('#d63131');
    expect(severityColor(255)).toBe('#d63131');
  });

  it('buckets 128–191 to orange', () => {
    expect(severityColor(128)).toBe('#f57c00');
    expect(severityColor(191)).toBe('#f57c00');
  });

  it('buckets <128 to yellow', () => {
    expect(severityColor(0)).toBe('#fbc02d');
    expect(severityColor(127)).toBe('#fbc02d');
  });
});

describe('formatZoneLabel', () => {
  it('formats id, decoded reasons, severity, and confidence', () => {
    expect(
      formatZoneLabel({ event_id: 57053650, severity: 200, confidence: 165, reasons_bitmask: 7 }),
    ).toBe('zone 57053650 · narrow lane, no shoulder / bike lane, high-speed traffic · severity 200 · confidence 165');
  });

  it('omits the reasons segment when the bitmask is zero', () => {
    expect(
      formatZoneLabel({ event_id: 1, severity: 10, confidence: 20, reasons_bitmask: 0 }),
    ).toBe('zone 1 · severity 10 · confidence 20');
  });

  it('includes reserved labels for unknown bits', () => {
    expect(
      formatZoneLabel({ event_id: 2, severity: 130, confidence: 99, reasons_bitmask: 9 }),
    ).toBe('zone 2 · narrow lane, reserved(bit 3) · severity 130 · confidence 99');
  });
});

describe('parseSqueezeZones', () => {
  it('parses a valid FeatureCollection into normalized features', () => {
    const features = parseSqueezeZones(collection(syntheticFeature()));
    expect(features).toHaveLength(1);
    expect(features[0]).toEqual({
      coordinates: [[0, 0], [0.001, 0.0005]],
      properties: { event_id: 57053650, severity: 200, confidence: 165, reasons_bitmask: 7 },
    });
  });

  it('accepts multiple segments sharing an event_id', () => {
    const features = parseSqueezeZones(collection(
      syntheticFeature({ segment_id: 1 }),
      syntheticFeature({ segment_id: 2 }, [[0.001, 0.0005], [0.002, 0.001]]),
    ));
    expect(features).toHaveLength(2);
    expect(features[0]!.properties.event_id).toBe(features[1]!.properties.event_id);
  });

  it('accepts an empty FeatureCollection', () => {
    expect(parseSqueezeZones(collection())).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseSqueezeZones('{nope')).toThrow('not valid JSON');
  });

  it('throws when the root is not a FeatureCollection', () => {
    expect(() => parseSqueezeZones('[]')).toThrow('not a GeoJSON FeatureCollection');
    expect(() => parseSqueezeZones('{"type":"Feature"}')).toThrow('not a GeoJSON FeatureCollection');
  });

  it('throws on non-LineString geometry', () => {
    const bad = { ...(syntheticFeature() as object), geometry: { type: 'Point', coordinates: [0, 0] } };
    expect(() => parseSqueezeZones(collection(bad))).toThrow('geometry must be a LineString');
  });

  it('throws on a LineString with fewer than 2 positions', () => {
    expect(() => parseSqueezeZones(collection(syntheticFeature({}, [[0, 0]])))).toThrow('at least 2 positions');
  });

  it('throws on non-numeric coordinate positions', () => {
    expect(() => parseSqueezeZones(collection(syntheticFeature({}, [[0, 0], ['a', 1]])))).toThrow('number pairs');
  });

  it('throws when a required numeric property is missing or non-numeric', () => {
    expect(() => parseSqueezeZones(collection(syntheticFeature({ severity: undefined }))))
      .toThrow('severity must be a number');
    expect(() => parseSqueezeZones(collection(syntheticFeature({ reasons_bitmask: 'x' }))))
      .toThrow('reasons_bitmask must be a number');
  });

  it('throws (all-or-nothing) when only a later feature is malformed', () => {
    expect(() => parseSqueezeZones(collection(syntheticFeature(), syntheticFeature({ event_id: null }))))
      .toThrow('feature 1: property event_id must be a number');
  });
});
