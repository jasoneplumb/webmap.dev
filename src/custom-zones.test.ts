import { describe, it, expect } from 'vitest';
import { encodeCustomZones, parseCustomZones, zoneDisplayLabel, type CustomZoneFeature } from './custom-zones';

function syntheticFeature(overrides: Record<string, unknown> = {}, coordinates?: unknown): unknown {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: coordinates ?? [[0, 0], [0.001, 0.0005]],
    },
    properties: {
      kind: 'custom_zone',
      id: 'zone-1',
      created_at: '2026-07-21T00:00:00.000Z',
      ...overrides,
    },
  };
}

function collection(...features: unknown[]): string {
  return JSON.stringify({ type: 'FeatureCollection', features });
}

describe('zoneDisplayLabel', () => {
  it('returns the label when present', () => {
    expect(zoneDisplayLabel({ kind: 'custom_zone', id: '1', created_at: 'x', label: 'Bad shoulder' }))
      .toBe('Bad shoulder');
  });

  it('falls back to a generic label when absent or blank', () => {
    expect(zoneDisplayLabel({ kind: 'custom_zone', id: '1', created_at: 'x' })).toBe('Custom zone');
    expect(zoneDisplayLabel({ kind: 'custom_zone', id: '1', created_at: 'x', label: '   ' })).toBe('Custom zone');
  });
});

describe('parseCustomZones', () => {
  it('parses a valid FeatureCollection into normalized features', () => {
    const features = parseCustomZones(collection(syntheticFeature({ label: 'Narrow bridge' })));
    expect(features).toHaveLength(1);
    expect(features[0]).toEqual({
      coordinates: [[0, 0], [0.001, 0.0005]],
      properties: {
        kind: 'custom_zone',
        id: 'zone-1',
        created_at: '2026-07-21T00:00:00.000Z',
        label: 'Narrow bridge',
      },
    });
  });

  it('accepts a feature with no label', () => {
    const features = parseCustomZones(collection(syntheticFeature()));
    expect(features[0]!.properties.label).toBeUndefined();
  });

  it('parses directional: true', () => {
    const features = parseCustomZones(collection(syntheticFeature({ directional: true })));
    expect(features[0]!.properties.directional).toBe(true);
  });

  it('treats an absent directional as bidirectional (the pre-property file contract)', () => {
    const features = parseCustomZones(collection(syntheticFeature()));
    expect(features[0]!.properties.directional).toBeUndefined();
  });

  it('normalizes directional: false to undefined — one representation of bidirectional', () => {
    const features = parseCustomZones(collection(syntheticFeature({ directional: false })));
    expect(features[0]!.properties.directional).toBeUndefined();
  });

  it('throws when directional is present but not a boolean', () => {
    expect(() => parseCustomZones(collection(syntheticFeature({ directional: 'yes' }))))
      .toThrow('directional must be a boolean');
  });

  it('accepts an empty FeatureCollection', () => {
    expect(parseCustomZones(collection())).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseCustomZones('{nope')).toThrow('not valid JSON');
  });

  it('throws when the root is not a FeatureCollection', () => {
    expect(() => parseCustomZones('[]')).toThrow('not a GeoJSON FeatureCollection');
    expect(() => parseCustomZones('{"type":"Feature"}')).toThrow('not a GeoJSON FeatureCollection');
  });

  it('throws on non-LineString geometry', () => {
    const bad = { ...(syntheticFeature() as object), geometry: { type: 'Point', coordinates: [0, 0] } };
    expect(() => parseCustomZones(collection(bad))).toThrow('geometry must be a LineString');
  });

  it('throws on a LineString with fewer than 2 positions', () => {
    expect(() => parseCustomZones(collection(syntheticFeature({}, [[0, 0]])))).toThrow('at least 2 positions');
  });

  it('throws on non-numeric coordinate positions', () => {
    expect(() => parseCustomZones(collection(syntheticFeature({}, [[0, 0], ['a', 1]])))).toThrow('number pairs');
  });

  it('throws when kind is not custom_zone', () => {
    expect(() => parseCustomZones(collection(syntheticFeature({ kind: 'squeeze_zone' }))))
      .toThrow('kind must be "custom_zone"');
  });

  it('throws when id is missing or not a string', () => {
    expect(() => parseCustomZones(collection(syntheticFeature({ id: undefined }))))
      .toThrow('id must be a non-empty string');
    expect(() => parseCustomZones(collection(syntheticFeature({ id: 42 }))))
      .toThrow('id must be a non-empty string');
  });

  it('throws when created_at is missing or not a string', () => {
    expect(() => parseCustomZones(collection(syntheticFeature({ created_at: undefined }))))
      .toThrow('created_at must be a non-empty string');
  });

  it('throws when label is present but not a string', () => {
    expect(() => parseCustomZones(collection(syntheticFeature({ label: 42 }))))
      .toThrow('label must be a string');
  });

  it('throws (all-or-nothing) when only a later feature is malformed', () => {
    expect(() => parseCustomZones(collection(syntheticFeature(), syntheticFeature({ id: null }))))
      .toThrow('feature 1: property id must be a non-empty string');
  });
});

describe('encodeCustomZones', () => {
  it('round-trips through parseCustomZones', () => {
    const zones: CustomZoneFeature[] = [
      {
        coordinates: [[0, 0], [0.001, 0.0005]],
        properties: { kind: 'custom_zone', id: 'zone-1', created_at: '2026-07-21T00:00:00.000Z', label: 'Bad shoulder' },
      },
    ];
    expect(parseCustomZones(encodeCustomZones(zones))).toEqual(zones);
  });

  it('round-trips a directional zone with its vertex order intact', () => {
    const zones: CustomZoneFeature[] = [
      {
        coordinates: [[0, 0], [0.001, 0.0005], [0.002, 0.0005]],
        properties: {
          kind: 'custom_zone',
          id: 'zone-1',
          created_at: '2026-07-21T00:00:00.000Z',
          directional: true,
        },
      },
    ];
    expect(parseCustomZones(encodeCustomZones(zones))).toEqual(zones);
  });

  it('omits directional entirely for a bidirectional zone', () => {
    const encoded = JSON.parse(encodeCustomZones([
      {
        coordinates: [[0, 0], [0.001, 0.0005]],
        properties: { kind: 'custom_zone', id: 'zone-1', created_at: '2026-07-21T00:00:00.000Z' },
      },
    ])) as { features: { properties: Record<string, unknown> }[] };
    expect('directional' in encoded.features[0]!.properties).toBe(false);
  });

  it('encodes an empty list as an empty FeatureCollection', () => {
    expect(JSON.parse(encodeCustomZones([]))).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
