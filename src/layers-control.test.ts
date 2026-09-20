import { describe, expect, it } from 'vitest';
import L from 'leaflet';
import { isOverlayRedundantOverBase, placePopoverVertically, type OverlayDef } from './layers-control';

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

describe('placePopoverVertically', () => {
  // The real shape: the Layers button sits bottom-left, and the popover's natural height
  // is its 400px body cap plus padding and header.
  const NATURAL_H = 473;
  const BANNER_BOTTOM = 70;

  /** Landscape phone — the viewport where the popover cannot fit above its own button. */
  function landscape(topObstruction: number) {
    return placePopoverVertically({
      btnTop: 330,
      btnBottom: 364,
      height: NATURAL_H,
      viewportHeight: 390,
      topObstruction,
      margin: 10,
    });
  }

  it('clamps to the viewport edge when nothing obstructs the top', () => {
    expect(landscape(0)).toEqual({ top: 10, maxHeight: 370 });
  });

  it('starts below the guidance banner instead of under it', () => {
    // The bug: top clamped to 10 put the header — and the only close button — beneath a
    // banner painting at z-index 1600.
    expect(landscape(BANNER_BOTTOM)).toEqual({ top: 80, maxHeight: 300 });
  });

  it('keeps the bottom edge fixed when the banner shortens it', () => {
    const { top, maxHeight } = landscape(BANNER_BOTTOM);
    expect(top + (maxHeight ?? 0)).toBe(390 - 10);
    // Same lower extent as the unobstructed placement: only the top moved.
    const clear = landscape(0);
    expect(top + (maxHeight ?? 0)).toBe(clear.top + (clear.maxHeight ?? 0));
  });

  it('leaves a popover that fits above the button untouched', () => {
    // Portrait: the flip clears the banner on its own, so no clamp should be applied.
    expect(placePopoverVertically({
      btnTop: 764,
      btnBottom: 798,
      height: NATURAL_H,
      viewportHeight: 844,
      topObstruction: BANNER_BOTTOM,
      margin: 10,
    })).toEqual({ top: 764 - 10 - NATURAL_H, maxHeight: null });
  });

  it('trims a button-anchored popover in place rather than dropping it to the floor', () => {
    // Fits above the button (top 17) but still runs under the banner. The bottom edge
    // belongs to the button, so the clamp must shorten it, not slide it down the screen.
    const placement = placePopoverVertically({
      btnTop: 500,
      btnBottom: 534,
      height: NATURAL_H,
      viewportHeight: 560,
      topObstruction: BANNER_BOTTOM,
      margin: 10,
    });
    expect(placement).toEqual({ top: 80, maxHeight: 410 });
    expect(placement.top + (placement.maxHeight ?? 0)).toBe(500 - 10);
  });

  it('places below the button when there is room below', () => {
    expect(placePopoverVertically({
      btnTop: 60,
      btnBottom: 94,
      height: 200,
      viewportHeight: 844,
      topObstruction: 0,
      margin: 10,
    })).toEqual({ top: 104, maxHeight: null });
  });

  it('never collapses below a usable height', () => {
    // A banner eating almost the whole viewport would leave 30px. The ceiling gives way
    // instead, so the popover keeps a usable height and still fits on screen.
    const placement = placePopoverVertically({
      btnTop: 340,
      btnBottom: 374,
      height: NATURAL_H,
      viewportHeight: 400,
      topObstruction: 350,
      margin: 10,
    });
    expect(placement).toEqual({ top: 270, maxHeight: 120 });
    expect(placement.top + (placement.maxHeight ?? 0)).toBeLessThanOrEqual(400);
  });

  it('keeps the popover on screen when the obstruction exceeds the viewport', () => {
    // Nothing caps .guidance-banner's height — it is a flex column that wraps — so a
    // multi-line banner on a short viewport can push the raw ceiling past the bottom of
    // the screen. Following it literally would put the popover entirely below the fold,
    // stranding the close button exactly as sliding UNDER the banner did.
    const placement = placePopoverVertically({
      btnTop: 340,
      btnBottom: 374,
      height: NATURAL_H,
      viewportHeight: 400,
      topObstruction: 500,
      margin: 10,
    });
    expect(placement).toEqual({ top: 270, maxHeight: 120 });
    expect(placement.top).toBeLessThan(400);
  });

  it('falls back to the top margin when no band is usable at all', () => {
    // Degenerate viewport: there is no placement that satisfies both the ceiling and a
    // usable height, so the header wins — it carries the only way to dismiss the popover.
    expect(placePopoverVertically({
      btnTop: 40,
      btnBottom: 74,
      height: NATURAL_H,
      viewportHeight: 100,
      topObstruction: 60,
      margin: 10,
    })).toEqual({ top: 10, maxHeight: 120 });
  });
});
