import { describe, expect, it } from 'vitest';
import {
  COURSE_FRESH_MS,
  HEADING_HOLD_MS,
  STATIONARY_SPEED_MS,
  selectHeading,
  smoothHeadingDeg,
  type HeadingInputs,
} from './heading';

function inputs(over: Partial<HeadingInputs> = {}): HeadingInputs {
  return {
    speedMs: 0,
    courseDeg: null,
    courseAgeMs: 0,
    compassDeg: null,
    ...over,
  };
}

describe('selectHeading', () => {
  it('uses GPS course while moving', () => {
    const r = selectHeading(inputs({ speedMs: 5.5, courseDeg: 42 }));
    expect(r).toEqual({ source: 'course', deg: 42 });
  });

  it('prefers travel over facing while moving, even with a compass reading', () => {
    // The phone can face somewhere other than the direction of travel — bar bag, pocket,
    // held sideways. Travel is the answer a moving user wants.
    const r = selectHeading(inputs({ speedMs: 5.5, courseDeg: 90, compassDeg: 270 }));
    expect(r).toEqual({ source: 'course', deg: 90 });
  });

  it('falls back to the compass when stopped', () => {
    const r = selectHeading(inputs({ speedMs: 0, compassDeg: 17, courseDeg: null }));
    expect(r).toEqual({ source: 'compass', deg: 17 });
  });

  it('uses the compass when moving but course is NaN', () => {
    // A fix can report speed without a course; nothing should be inferred from travel then.
    const r = selectHeading(inputs({ speedMs: 5.5, courseDeg: null, compassDeg: 200 }));
    expect(r).toEqual({ source: 'compass', deg: 200 });
  });

  it('treats exactly the stationary threshold as moving', () => {
    const r = selectHeading(inputs({ speedMs: STATIONARY_SPEED_MS, courseDeg: 10 }));
    expect(r.source).toBe('course');
  });

  it('treats just under the threshold as stopped', () => {
    const r = selectHeading(inputs({ speedMs: STATIONARY_SPEED_MS - 0.01, courseDeg: 10, compassDeg: 99 }));
    expect(r).toEqual({ source: 'compass', deg: 99 });
  });

  it('falls back to a held course just under the threshold with no compass', () => {
    const r = selectHeading(inputs({ speedMs: STATIONARY_SPEED_MS - 0.01, courseDeg: 10, courseAgeMs: 900 }));
    expect(r).toEqual({ source: 'held-course', deg: 10 });
  });

  it('holds a recent course when stopped with no compass at all', () => {
    // Pre-compass behavior, preserved for devices that deny or lack orientation.
    const r = selectHeading(inputs({ courseDeg: 123, courseAgeMs: 2_000 }));
    expect(r).toEqual({ source: 'held-course', deg: 123 });
  });

  it('drops a held course once it goes stale rather than lie', () => {
    const r = selectHeading(inputs({ courseDeg: 123, courseAgeMs: HEADING_HOLD_MS }));
    expect(r).toEqual({ source: 'none', deg: null });
  });

  it('prefers a live compass over a held course when stopped', () => {
    const r = selectHeading(inputs({ compassDeg: 5, courseDeg: 123, courseAgeMs: 100 }));
    expect(r.source).toBe('compass');
  });

  // ── Regression: a gap between fixes must not flip a moving rider to facing ──────
  // Speed comes from the last fix and does not age on its own. When "usable course"
  // expired after one fix interval, any longer gap left speed reading "moving" with the
  // course nulled, so the ring fell through to the compass and turned amber mid-ride —
  // and because orientation drives redraws at ~60 Hz, it stayed amber for the whole gap.
  it('keeps showing travel while moving when the course is older than one fix interval', () => {
    const r = selectHeading(inputs({
      speedMs: 5.5,
      courseDeg: 90,
      courseAgeMs: COURSE_FRESH_MS * 2,
      compassDeg: 270,
    }));
    expect(r.source).toBe('held-course');
    expect(r.deg).toBe(90);
  });

  it('labels a course fresh or held by age, but draws both as travel', () => {
    const common = { speedMs: 5.5, courseDeg: 90, compassDeg: 270 };
    expect(selectHeading(inputs({ ...common, courseAgeMs: COURSE_FRESH_MS - 1 })).source).toBe('course');
    expect(selectHeading(inputs({ ...common, courseAgeMs: COURSE_FRESH_MS })).source).toBe('held-course');
  });

  it('gives up on travel and switches to facing once the hold window passes', () => {
    // Signal genuinely lost: at this point a stale speed reading is no reason to keep
    // claiming a direction of travel.
    const r = selectHeading(inputs({
      speedMs: 5.5,
      courseDeg: 90,
      courseAgeMs: HEADING_HOLD_MS,
      compassDeg: 270,
    }));
    expect(r).toEqual({ source: 'compass', deg: 270 });
  });

  it('shows nothing when moving with a stale course and no compass', () => {
    const r = selectHeading(inputs({ speedMs: 5.5, courseDeg: 90, courseAgeMs: HEADING_HOLD_MS }));
    expect(r).toEqual({ source: 'none', deg: null });
  });

  it('shows nothing when no source is available', () => {
    expect(selectHeading(inputs())).toEqual({ source: 'none', deg: null });
  });

  it('normalizes out-of-range inputs', () => {
    expect(selectHeading(inputs({ compassDeg: -90 })).deg).toBe(270);
    expect(selectHeading(inputs({ speedMs: 3, courseDeg: 450 })).deg).toBe(90);
  });
});

describe('smoothHeadingDeg', () => {
  it('closes the given fraction of the gap', () => {
    expect(smoothHeadingDeg(0, 100, 0.25)).toBeCloseTo(25);
  });

  it('takes the short way across north instead of spinning backwards', () => {
    // The bug this exists to prevent: naive interpolation from 350 to 10 sweeps 340
    // degrees the wrong way. One quarter-step should land at 355, not 265.
    expect(smoothHeadingDeg(350, 10, 0.25)).toBeCloseTo(355);
  });

  it('takes the short way in the other direction too', () => {
    expect(smoothHeadingDeg(10, 350, 0.25)).toBeCloseTo(5);
  });

  it('reaches the target exactly at factor 1', () => {
    expect(smoothHeadingDeg(350, 10, 1)).toBeCloseTo(10);
  });

  it('does not move at factor 0', () => {
    expect(smoothHeadingDeg(123, 300, 0)).toBeCloseTo(123);
  });

  it('clamps an overshooting factor so a long frame cannot sail past the target', () => {
    expect(smoothHeadingDeg(0, 90, 4)).toBeCloseTo(90);
  });

  it('clamps a negative factor rather than moving away from the target', () => {
    expect(smoothHeadingDeg(0, 90, -2)).toBeCloseTo(0);
  });

  it('always returns a normalized angle', () => {
    expect(smoothHeadingDeg(-10, -20, 1)).toBeCloseTo(340);
  });

  it('converges on the target when applied repeatedly across north', () => {
    let h = 355;
    for (let n = 0; n < 60; n++) h = smoothHeadingDeg(h, 5, 0.2);
    expect(h).toBeCloseTo(5, 3);
  });
});
