import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import L from 'leaflet';
import {
  createCustomZonesOverlay,
  encodeCustomZones,
  parseCustomZones,
  zoneDisplayLabel,
  type CustomZoneFeature,
} from './custom-zones';

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

describe('createCustomZonesOverlay — per-zone rendering (#281)', () => {
  const STORAGE_KEY = 'webmap-custom-squeeze-zones-geojson';

  beforeEach(() => {
    localStorage.setItem(STORAGE_KEY, collection(
      syntheticFeature({ id: 'zone-a', label: 'A' }),
      syntheticFeature({ id: 'zone-b', label: 'B' }, [[1, 1], [1.001, 1.0005]]),
    ));
  });

  afterEach(() => localStorage.clear());

  function polylines(group: L.LayerGroup): L.Polyline[] {
    const found: L.Polyline[] = [];
    group.eachLayer((layer) => {
      if (layer instanceof L.Polyline) found.push(layer);
      else if (layer instanceof L.LayerGroup) found.push(...polylines(layer));
    });
    return found;
  }

  function popupFor(group: L.LayerGroup, label: string): HTMLElement {
    const line = polylines(group).find((l) => l.getTooltip()?.getContent() === label);
    if (!line) throw new Error(`no zone labelled ${label}`);
    return line.getPopup()!.getContent() as HTMLElement;
  }

  function button(popup: HTMLElement, text: string): HTMLButtonElement {
    const btn = [...popup.querySelectorAll('button')].find((b) => b.textContent === text);
    if (!btn) throw new Error(`no ${text} button`);
    return btn;
  }

  function draftInZoneA(group: L.LayerGroup): { label: HTMLInputElement; directional: HTMLInputElement } {
    const popup = popupFor(group, 'A');
    const label = popup.querySelector<HTMLInputElement>('input[type="text"]')!;
    const directional = popup.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    label.value = 'unsaved draft';
    directional.checked = true;
    return { label, directional };
  }

  function expectDraftSurvives(group: L.LayerGroup, draft: { label: HTMLInputElement; directional: HTMLInputElement }): void {
    const popup = popupFor(group, 'A');
    expect(popup.contains(draft.label)).toBe(true);
    expect(draft.label.value).toBe('unsaved draft');
    expect(draft.directional.checked).toBe(true);
  }

  it('keeps an unsaved edit in one popup when another zone is saved', () => {
    const overlay = createCustomZonesOverlay(() => {});
    const draft = draftInZoneA(overlay.group);
    const popupB = popupFor(overlay.group, 'B');
    popupB.querySelector<HTMLInputElement>('input[type="text"]')!.value = 'B renamed';
    button(popupB, 'Save').click();

    expectDraftSurvives(overlay.group, draft);
    expect(polylines(overlay.group).map((l) => l.getTooltip()?.getContent()).sort()).toEqual(['A', 'B renamed']);
  });

  it('keeps an unsaved edit in one popup when another zone is reversed', () => {
    const overlay = createCustomZonesOverlay(() => {});
    const draft = draftInZoneA(overlay.group);
    const popupB = popupFor(overlay.group, 'B');
    const directionalB = popupB.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    directionalB.checked = true;
    directionalB.dispatchEvent(new Event('change')); // enables Reverse, as a real tap would
    const reverseB = button(popupB, 'Reverse');
    expect(reverseB.disabled).toBe(false);
    reverseB.click();

    expectDraftSurvives(overlay.group, draft);
  });

  it('keeps an unsaved edit in one popup when another zone is deleted', () => {
    const overlay = createCustomZonesOverlay(() => {});
    const draft = draftInZoneA(overlay.group);
    button(popupFor(overlay.group, 'B'), 'Delete').click();

    expectDraftSurvives(overlay.group, draft);
    expect(polylines(overlay.group)).toHaveLength(1);
  });

  it('keeps an unsaved edit in an existing popup when a new zone is added', () => {
    const overlay = createCustomZonesOverlay(() => {});
    const draft = draftInZoneA(overlay.group);
    overlay.addZone([[2, 2], [2.001, 2.0005]]);

    expectDraftSurvives(overlay.group, draft);
    expect(polylines(overlay.group)).toHaveLength(3);
  });

  it('adds and removes direction arrows for only the saved zone', () => {
    const overlay = createCustomZonesOverlay(() => {});
    const arrowCount = (): number => {
      let n = 0;
      overlay.group.eachLayer((layer) => {
        if (layer instanceof L.LayerGroup) layer.eachLayer((l) => { if (l instanceof L.Marker) n++; });
      });
      return n;
    };
    expect(arrowCount()).toBe(0);

    const popupB = popupFor(overlay.group, 'B');
    const directionalB = popupB.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    directionalB.checked = true;
    button(popupB, 'Save').click();
    expect(arrowCount()).toBe(1); // zone B has one edge; zone A stays bidirectional

    const reopenedB = popupFor(overlay.group, 'B');
    reopenedB.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = false;
    button(reopenedB, 'Save').click();
    expect(arrowCount()).toBe(0);
  });

  it('renders and deletes zones independently even when an imported file repeats an id', () => {
    localStorage.setItem(STORAGE_KEY, collection(
      syntheticFeature({ id: 'dup', label: 'A' }),
      syntheticFeature({ id: 'dup', label: 'B' }, [[1, 1], [1.001, 1.0005]]),
    ));
    const overlay = createCustomZonesOverlay(() => {});
    expect(polylines(overlay.group)).toHaveLength(2);

    button(popupFor(overlay.group, 'B'), 'Delete').click();
    expect(polylines(overlay.group).map((l) => l.getTooltip()?.getContent())).toEqual(['A']);
    expect(parseCustomZones(localStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
  });
});
