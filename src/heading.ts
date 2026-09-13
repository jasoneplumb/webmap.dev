/**
 * Intent: Decide which direction the position indicator should show, and move it there smoothly
 * Context: Pure helpers consumed by heading-indicator.ts; no DOM, no Leaflet, no AppState
 * Pattern: selectHeading() picks a source from the current inputs; smoothHeadingDeg() eases toward it
 *
 * The problem this module exists to solve: GPS course is the only heading the map used to
 * consume, and it is NaN below walking pace. The device compass is a true-north heading that
 * is good precisely when course is not — while standing still. Neither source is correct on
 * its own, so the choice has to be made per fix, from the motion state.
 */
import { normalizeDeg, shortestArcDeg } from './geo';

/**
 * Speed below which the user is treated as stationary (m/s). 0.5 m/s ~ 1.8 km/h.
 * Shared with location.ts's adaptive-accuracy logic: "is the user moving" should not be
 * able to answer differently in two places.
 */
export const STATIONARY_SPEED_MS = 0.5;

/**
 * How long a course reading stays usable after it goes NaN, for devices with no compass
 * to fall back on. Keeps the pre-compass behavior intact rather than blanking the
 * indicator sooner than it used to.
 */
export const HEADING_HOLD_MS = 10_000;

/**
 * How long a course counts as current rather than held — roughly one fix interval. This
 * only labels the source; both labels draw as travel. Crossing it must not change WHICH
 * source wins, or a widened gap between fixes would flip the indicator to facing mid-ride.
 */
export const COURSE_FRESH_MS = 1_500;

export type HeadingSource = 'course' | 'compass' | 'held-course' | 'none';

export interface HeadingInputs {
  /** Speed from the most recent GPS fix. Callers pass 0 when it is NaN or negative. */
  speedMs: number;
  /**
   * Most recent GPS course over ground, or null if none has ever been reported. Deliberately
   * NOT pre-filtered for staleness by the caller: age is passed alongside so this function
   * is the only place that decides what "still usable" means.
   */
  courseDeg: number | null;
  /** Age of courseDeg in ms. Irrelevant when courseDeg is null. */
  courseAgeMs: number;
  /** Smoothed device-compass heading, or null with no grant or no reading yet. */
  compassDeg: number | null;
}

export interface HeadingChoice {
  source: HeadingSource;
  /** Degrees clockwise from true north, or null when nothing should be drawn. */
  deg: number | null;
}

/**
 * Pick the heading to display, in priority order:
 *
 * 1. Moving with a course still inside the hold window — the direction of travel, which is
 *    what a moving user means by "which way am I pointing".
 * 2. A compass reading — correct while stopped, and the reason a standing user now sees
 *    anything at all.
 * 3. A course inside the hold window — reached when stopped with no compass, so devices
 *    that deny or lack orientation behave exactly as they did before.
 * 4. Nothing. Better than a bearing we know is stale.
 *
 * Note the deliberate asymmetry in rule 1: while moving, a compass reading is ignored even
 * when present. The phone can face somewhere other than the direction of travel — bar bag,
 * jersey pocket, held sideways at a junction — and travel is the answer the user wants then.
 *
 * Rule 1 gates the course on HEADING_HOLD_MS, not on COURSE_FRESH_MS, and that distinction
 * is load-bearing. Speed comes from the last fix and does not age on its own, so if "usable
 * course" expired after one fix interval, any gap between fixes longer than that would leave
 * speed still reading "moving" with no course to pair it with — dropping through to rule 2
 * and flipping the indicator to facing, in amber, part-way through a ride. Fix intervals are
 * not guaranteed and widen under weak signal, so that gap is ordinary rather than exotic.
 * Both branches of rule 1 draw as travel; freshness only picks the label. Trust in the fix
 * expires once, at the hold window, for speed and course together.
 */
export function selectHeading(i: HeadingInputs): HeadingChoice {
  const moving = i.speedMs >= STATIONARY_SPEED_MS;
  const courseUsable = i.courseDeg !== null && i.courseAgeMs < HEADING_HOLD_MS;

  if (moving && courseUsable) {
    return {
      source: i.courseAgeMs < COURSE_FRESH_MS ? 'course' : 'held-course',
      deg: normalizeDeg(i.courseDeg as number),
    };
  }
  if (i.compassDeg !== null) {
    return { source: 'compass', deg: normalizeDeg(i.compassDeg) };
  }
  if (courseUsable) {
    return { source: 'held-course', deg: normalizeDeg(i.courseDeg as number) };
  }
  return { source: 'none', deg: null };
}

/**
 * Ease `current` toward `target` by `factor` of the shortest arc between them.
 *
 * Going through shortestArcDeg is what keeps a compass crossing north from spinning the
 * long way round, and low-passing at all is what keeps a raw magnetometer — which jitters
 * by several degrees at rest — from making the indicator shiver.
 *
 * `factor` is clamped to 0..1, so a caller deriving it from elapsed time cannot overshoot
 * past the target on a long frame.
 */
export function smoothHeadingDeg(current: number, target: number, factor: number): number {
  const k = Math.max(0, Math.min(1, factor));
  return normalizeDeg(current + shortestArcDeg(normalizeDeg(current), normalizeDeg(target)) * k);
}
