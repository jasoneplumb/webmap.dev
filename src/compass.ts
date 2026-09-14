// Compass widget — bottom-left SVG rose that rotates by -deviceHeading so N points at true north.
//
// The rose is no longer the only consumer of the heading: every reading is low-passed into
// state.compassHeadingDeg, which heading-indicator.ts uses to give a standing user a direction
// at all. Before this, the heading was read and then spent entirely on a 38 px glyph.
import L from 'leaflet';
import type { AppState } from './types';
import { requestOrientationPermission, subscribeOrientation, type OrientationPermission } from './orientation';
import {
  HEADING_EASE_PER_SEC,
  HEADING_MAX_FRAME_S,
  easeUnwrappedDeg,
  smoothHeadingDeg,
  unwrapHeadingDeg,
} from './heading';
import { scheduleHeadingIndicatorUpdate } from './heading-indicator';

const COMPASS_HTML = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="20" cy="20" r="18" fill="rgba(255,255,255,0.92)" stroke="#444" stroke-width="1.5"/>
  <polygon points="20,4 24,18 16,18" fill="#d33"/>
  <polygon points="20,36 24,22 16,22" fill="#666"/>
  <text x="20" y="14" font-size="9" font-weight="700" text-anchor="middle" fill="#222" font-family="sans-serif">N</text>
</svg>`;

/**
 * Fraction of the remaining arc closed per orientation event. A raw magnetometer wanders
 * several degrees at rest, and both the rose and the position ring read that as a shiver.
 * Applied per event rather than per second because orientation delivery rate is what it is.
 */
const COMPASS_SMOOTH_FACTOR = 0.25;

export interface CompassControl {
  /**
   * Adopt a permission decided somewhere else — in practice the first-run consent grant —
   * and start streaming without waiting for a tap on the rose.
   */
  applyPermission(permission: OrientationPermission): void;
}

export function addCompassControl(map: L.Map, state: AppState): CompassControl {
  let unsubscribe: (() => void) | null = null;
  let button: HTMLButtonElement | null = null;
  /**
   * The angle actually written to CSS, kept unwrapped rather than normalized. See
   * unwrapHeadingDeg: the rose's `transition: transform` interpolates whatever number it is
   * given, so a normalized heading turns every pass through north into a full spin the wrong
   * way. Null until the first reading, which lands without easing.
   */
  let roseDeg: number | null = null;
  /** Latest stage-1 heading the rose is easing toward, unwrapped like roseDeg. */
  let roseTargetDeg: number | null = null;
  let roseRaf: number | null = null;
  let roseLastMs: number | null = null;

  /**
   * Second filtering stage for the rose, on a frame clock rather than the event clock.
   *
   * compass.ts low-passes the raw magnetometer into state.compassHeadingDeg (stage 1) and
   * the position marker then eases the angle it DRAWS toward that value (stage 2) — noise
   * rejection and animation being separate jobs. The rose only ever had stage 1, so on a
   * handset delivering orientation at 60 Hz its fixed per-event fraction converged within
   * a frame or two and it rendered the noise directly. That is the shiver (#323).
   *
   * It cannot simply reuse the marker's eased value: above walking pace the marker draws
   * GPS course, and a north indicator that swung to travel direction would be answering a
   * different question. So the rose eases its own device-facing angle, with the marker's
   * rate and formula so the two settle alike.
   */
  function stepRose(nowMs: number): void {
    roseRaf = null;
    if (button === null || roseTargetDeg === null) return;
    if (roseDeg === null || roseLastMs === null) {
      // First reading lands directly — easing in from zero would spin the rose from north.
      roseDeg = roseTargetDeg;
    } else {
      const dtS = Math.min(HEADING_MAX_FRAME_S, Math.max(0, (nowMs - roseLastMs) / 1000));
      roseDeg = easeUnwrappedDeg(roseDeg, roseTargetDeg, dtS * HEADING_EASE_PER_SEC);
    }
    roseLastMs = nowMs;
    button.style.setProperty('--heading-deg', `${roseDeg}deg`);
    // Keep stepping until the drawn angle has caught up, then idle: a rose that has
    // settled should not hold a rAF open behind a stationary phone.
    if (Math.abs(roseTargetDeg - roseDeg) > 0.05) scheduleRose();
  }

  function scheduleRose(): void {
    if (roseRaf !== null) return;
    roseRaf = requestAnimationFrame(stepRose);
  }

  /** Button presentation only — the caller owns state.compassPermission. */
  function markUnavailable(title: string): void {
    if (button === null) return;
    button.classList.remove('compass-rose--active');
    button.classList.add('compass-rose--unavailable');
    button.title = title;
    button.setAttribute('aria-label', title);
  }

  function startStreaming(): void {
    if (unsubscribe !== null) return;
    if (button !== null) {
      button.classList.remove('compass-rose--unavailable');
      button.classList.add('compass-rose--active');
      button.title = 'Compass';
      button.setAttribute('aria-label', 'Compass');
    }
    unsubscribe = subscribeOrientation((heading) => {
      // First reading lands directly; easing from a null start would sweep in from north.
      state.compassHeadingDeg = state.compassHeadingDeg === null
        ? heading
        : smoothHeadingDeg(state.compassHeadingDeg, heading, COMPASS_SMOOTH_FACTOR);
      // Negated: rotating the rose the other way is what keeps N pointing at true north.
      const target = -state.compassHeadingDeg;
      roseTargetDeg = roseTargetDeg === null ? target : unwrapHeadingDeg(roseTargetDeg, target);
      scheduleRose();
      scheduleHeadingIndicatorUpdate(state);
    });
  }

  function applyPermission(permission: OrientationPermission): void {
    state.compassPermission = permission;
    if (permission === 'granted') {
      startStreaming();
    } else {
      markUnavailable(permission === 'denied' ? 'Compass permission denied' : 'Compass not supported');
    }
  }

  const Control = L.Control.extend({
    onAdd() {
      button = L.DomUtil.create('button', 'compass-rose') as HTMLButtonElement;
      button.type = 'button';
      button.title = 'Compass — tap to enable';
      button.setAttribute('aria-label', 'Compass — tap to enable');
      button.innerHTML = COMPASS_HTML;

      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.disableScrollPropagation(button);

      // Hide entirely if the platform doesn't expose orientation events at all (desktop).
      if (typeof DeviceOrientationEvent === 'undefined') {
        button.classList.add('compass-rose--unavailable');
        state.compassPermission = 'unsupported';
        return button;
      }

      // Still tappable, and still the whole story for anyone who declined the opt-in or
      // whose install predates it.
      L.DomEvent.on(button, 'click', () => {
        if (state.compassPermission === 'granted') return;
        void requestOrientationPermission().then(applyPermission);
      });

      // A grant that arrived before the control existed (consent resolves first on a fresh
      // install) still has to start the stream.
      if (state.compassPermission === 'granted') startStreaming();

      return button;
    },
    onRemove() {
      if (unsubscribe !== null) {
        unsubscribe();
        unsubscribe = null;
      }
      // Drop the accumulators with the button they were driving, so a later remount starts
      // from the first reading instead of unwinding from a stale angle.
      if (roseRaf !== null) {
        cancelAnimationFrame(roseRaf);
        roseRaf = null;
      }
      roseDeg = null;
      roseTargetDeg = null;
      roseLastMs = null;
      button = null;
    },
  });

  new Control({ position: 'bottomleft' }).addTo(map);

  return { applyPermission };
}
