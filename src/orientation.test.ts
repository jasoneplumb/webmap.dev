import { describe, it, expect } from 'vitest';
import { extractHeading } from './orientation';

function fakeEvent(props: Partial<DeviceOrientationEvent> & { webkitCompassHeading?: number }): DeviceOrientationEvent {
  return props as DeviceOrientationEvent;
}

describe('extractHeading', () => {
  it('prefers iOS webkitCompassHeading when present', () => {
    const e = fakeEvent({ alpha: 200, webkitCompassHeading: 90 });
    expect(extractHeading(e)).toBe(90);
  });

  it('falls back to (360 - alpha) when webkitCompassHeading is absent', () => {
    expect(extractHeading(fakeEvent({ alpha: 90 }))).toBe(270);
    expect(extractHeading(fakeEvent({ alpha: 0 }))).toBe(0);
    expect(extractHeading(fakeEvent({ alpha: 359 }))).toBe(1);
  });

  it('normalises negative or out-of-range webkitCompassHeading into 0–360', () => {
    expect(extractHeading(fakeEvent({ alpha: 0, webkitCompassHeading: -10 }))).toBe(350);
    expect(extractHeading(fakeEvent({ alpha: 0, webkitCompassHeading: 720 }))).toBe(0);
  });

  it('returns null when neither field is usable', () => {
    expect(extractHeading(fakeEvent({ alpha: null }))).toBeNull();
    expect(extractHeading(fakeEvent({ alpha: NaN }))).toBeNull();
    expect(extractHeading(fakeEvent({ alpha: NaN, webkitCompassHeading: NaN }))).toBeNull();
  });

  it('skips webkitCompassHeading if it is NaN and falls back to alpha', () => {
    expect(extractHeading(fakeEvent({ alpha: 90, webkitCompassHeading: NaN }))).toBe(270);
  });
});
