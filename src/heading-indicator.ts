/**
 * Intent: Draw the chosen heading on the GPS position marker
 * Context: Called from location.ts on every fix, and from compass.ts on every orientation event
 * Pattern: Read AppState → selectHeading() → ease → write --heading-deg + marker classes
 *
 * Split from location.ts because the indicator has two independent clocks. GPS fixes arrive
 * around 1 Hz; orientation events arrive around 60 Hz. Driving the marker only from fixes
 * would make a stationary compass heading update once a second, which reads as broken.
 */
import type { AppState } from './types';
import { selectHeading, smoothHeadingDeg } from './heading';

/**
 * Fraction of the remaining arc closed per second. At 60 Hz this eases visibly without
 * lagging a real turn; at the 1 Hz of a fix-only update it clamps to a direct jump, which
 * is what the pre-compass indicator already did.
 */
const EASE_PER_SEC = 6;

/** Longest frame the easing will integrate, so a backgrounded tab does not resume mid-sweep. */
const MAX_FRAME_S = 0.25;

let lastUpdateMs: number | null = null;
let rafHandle: number | null = null;

/**
 * Recompute and draw the heading. Safe to call at any rate and from either clock.
 *
 * Note the two-stage filtering: compass.ts low-passes the raw magnetometer into
 * state.compassHeadingDeg to kill jitter, and this eases the drawn angle toward whatever
 * source won. They are separate jobs — noise rejection versus animation — and collapsing
 * them into one would force a single time constant to do both.
 */
export function updateHeadingIndicator(state: AppState, nowMs: number = performance.now()): void {
  const marker = state.locationMarker;
  if (marker === null || state.screenOff) return;
  const el = marker.getElement();
  if (!el) return;

  const courseAgeMs = state.lastValidHeadingDeg === null
    ? Number.POSITIVE_INFINITY
    : nowMs - state.lastValidHeadingMs;
  // location.ts is the only writer and already maps NaN to 0, so this only has to floor a
  // negative reading rather than re-validate what cannot arrive.
  const speedMs = Math.max(0, state.lastSpeedMs);

  // Staleness is not applied here on purpose: selectHeading gets the raw course and its age
  // and owns every decision about what is still usable, so the two cannot disagree about
  // whether a fix is live.
  const choice = selectHeading({
    speedMs,
    courseDeg: state.lastValidHeadingDeg,
    courseAgeMs,
    compassDeg: state.compassPermission === 'granted' ? state.compassHeadingDeg : null,
  });

  if (choice.deg === null) {
    el.classList.remove('blue-dot--has-heading');
    el.classList.remove('blue-dot--heading-facing');
    state.shownHeadingDeg = null;
    lastUpdateMs = nowMs;
    return;
  }

  if (state.shownHeadingDeg === null || lastUpdateMs === null) {
    // First heading of a session lands directly. Easing from an arbitrary zero would
    // spin the ring in from north on the very first fix.
    state.shownHeadingDeg = choice.deg;
  } else {
    const dtS = Math.min(MAX_FRAME_S, Math.max(0, (nowMs - lastUpdateMs) / 1000));
    state.shownHeadingDeg = smoothHeadingDeg(state.shownHeadingDeg, choice.deg, dtS * EASE_PER_SEC);
  }
  lastUpdateMs = nowMs;

  el.style.setProperty('--heading-deg', `${state.shownHeadingDeg}deg`);
  el.classList.add('blue-dot--has-heading');
  // Facing and travelling are different claims, so they are drawn differently — see
  // .blue-dot--heading-facing in style.css.
  el.classList.toggle('blue-dot--heading-facing', choice.source === 'compass');
}

/**
 * Coalesce a burst of orientation events into one write per frame. Orientation fires far
 * faster than the display refreshes, and every extra write is a style recalculation for a
 * position the user cannot see yet.
 */
export function scheduleHeadingIndicatorUpdate(state: AppState): void {
  if (rafHandle !== null) return;
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;
    updateHeadingIndicator(state);
  });
}

/** Drop the easing origin when the marker goes away, so the next locate session starts clean. */
export function resetHeadingIndicator(state: AppState): void {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  lastUpdateMs = null;
  state.shownHeadingDeg = null;
}
