// Tests for the shared desktop-vs-handheld predicate. Two controls read it: the search box
// (starts expanded and focused on pointer devices) and the compass rose (not mounted on them).
import { describe, it, expect } from 'vitest';
import { isPointerDevice, isPointerDeviceNow, POINTER_DEVICE_QUERY } from './device';

describe('isPointerDevice', () => {
  it('is true only for devices with a precise pointer', () => {
    expect(isPointerDevice(() => ({ matches: true }))).toBe(true);
    expect(isPointerDevice(() => ({ matches: false }))).toBe(false);
  });

  it('asks about pointer and hover, never viewport width', () => {
    // Width would be the wrong proxy in both directions: a narrow laptop window is still a
    // keyboard device, and a large tablet still isn't.
    let asked = '';
    isPointerDevice((query) => { asked = query; return { matches: false }; });
    expect(asked).toBe(POINTER_DEVICE_QUERY);
    expect(asked).toContain('pointer: fine');
    expect(asked).toContain('hover: hover');
    expect(asked).not.toMatch(/width/);
  });
});

describe('isPointerDeviceNow', () => {
  it('returns false instead of throwing where matchMedia is missing', () => {
    // This environment's jsdom provides no matchMedia, which is the case being pinned: the
    // predicate is read on the boot path (consent.ts), where a throw is a blank page.
    expect(typeof window.matchMedia).not.toBe('function');
    expect(isPointerDeviceNow()).toBe(false);
  });
});
