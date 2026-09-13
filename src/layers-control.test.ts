import { describe, expect, it } from 'vitest';
import L from 'leaflet';
import { isOverlayRedundantOverBase, type OverlayDef } from './layers-control';

function overlay(redundantOverBases?: string[]): OverlayDef {
  const def: OverlayDef = {
    id: 'cycle-blend',
    name: 'Cycle blend',
    tileLayer: L.tileLayer('https://example.com/{z}/{x}/{y}.png'),
  };
  if (redundantOverBases) def.redundantOverBases = redundantOverBases;
  return def;
}

describe('isOverlayRedundantOverBase', () => {
  it('is redundant over a base it lists', () => {
    expect(isOverlayRedundantOverBase(overlay(['cycle']), 'cycle')).toBe(true);
  });

  it('is not redundant over a base it does not list', () => {
    // The case the overlay exists for: Cycle route ink over Satellite imagery is real
    // work, not a layer compositing against its own source.
    expect(isOverlayRedundantOverBase(overlay(['cycle']), 'satellite')).toBe(false);
  });

  it('is never redundant when it declares no redundant bases', () => {
    expect(isOverlayRedundantOverBase(overlay(), 'cycle')).toBe(false);
  });

  it('matches any listed base, not just the first', () => {
    expect(isOverlayRedundantOverBase(overlay(['outdoors', 'cycle']), 'cycle')).toBe(true);
  });

  it('is not redundant before a base is active', () => {
    // activeBaseId is null until the control is added to a map. Treating that as
    // "redundant" would strand the overlay off the map on first paint.
    expect(isOverlayRedundantOverBase(overlay(['cycle']), null)).toBe(false);
  });
});
