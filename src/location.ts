/**
 * Intent: Handle GPS location events — filter jitter, update blue dot + accuracy circle, pan map, feed recording trail
 * Context: Called by main.ts on each Leaflet 'locationfound' event; also handles 'locationerror' and locate-off cleanup
 * Pattern: Filter → mutate state → update DOM markers → conditionally pan → conditionally append trail point
 * Future: Haversine jitter threshold (accuracy/2) is fixed; an adaptive threshold based on recent fix variance could be more accurate in dense urban canyons
 */
import L from 'leaflet';
import type { AppState } from './types';
import { updateLocateIcon } from './controls';
import { setWatchAccuracy } from './timer';
import { haversineDistance } from './geo';
import { updateGuidance } from './guidance';

/** Discard GPS fixes coarser than this threshold (metres). */
export const TRAIL_MAX_ACCURACY_M = 30;

/** Speed below which the user is considered stationary (m/s). 0.5 m/s ~ 1.8 km/h. */
const STATIONARY_SPEED_MS = 0.5;
/** Consecutive stationary fixes before switching to low-accuracy GPS to save battery. */
const STATIONARY_THRESHOLD = 5;

// Blue pulsing dot — styled via .blue-dot CSS in style.css.
// .blue-dot__heading is hidden until a valid GPS course (e.heading) is observed
// via the .blue-dot--has-heading class set in onLocationFound; rotation is
// driven by a CSS custom property --heading-deg.
const BLUE_DOT_HTML =
  '<div class="blue-dot__heading" aria-hidden="true"></div>' +
  '<div class="blue-dot__inner"></div>';

const BLUE_DOT_ICON = L.divIcon({
  className: 'blue-dot',
  html: BLUE_DOT_HTML,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

// Gray dot shown on GPS signal loss
function createGrayDotIcon(): L.DivIcon {
  return L.divIcon({
    className: 'blue-dot blue-dot--gray',
    html: BLUE_DOT_HTML,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

// Hold-last-bearing: GPS course is NaN at low speeds. Keep the wedge pointed in
// the last valid direction for HEADING_HOLD_MS, then fade it out.
const HEADING_HOLD_MS = 10_000;
let lastValidHeadingDeg: number | null = null;
let lastValidHeadingMs = 0;

/**
 * intent: Accept or reject a GPS fix based on whether we moved meaningfully or accuracy improved
 * method: Haversine distance from last accepted fix vs. current accuracy radius; accept if dist > accuracy/2 OR accuracy improved
 * effect: Eliminates stationary GPS jitter without introducing lag when the user actually moves
 */
export function onLocationFound(e: L.LocationEvent, state: AppState, map: L.Map): void {
  // Always track the latest GPS accuracy so the stats bar can show a weak-signal indicator
  state.lastGpsAccuracy = e.accuracy;

  // Update hysteresis counters for GPS weak-signal badge (show after 2+ weak fixes,
  // hide after 2+ strong fixes, hold state in the 25-30m deadband)
  if (e.accuracy > TRAIL_MAX_ACCURACY_M) {
    state.gpsWeakStreak++;
    state.gpsStrongStreak = 0;
    if (state.gpsWeakStreak >= 2) state.gpsWeakBadgeVisible = true;
  } else if (e.accuracy < TRAIL_MAX_ACCURACY_M - 5) {
    state.gpsStrongStreak++;
    state.gpsWeakStreak = 0;
    if (state.gpsStrongStreak >= 2) state.gpsWeakBadgeVisible = false;
  } else {
    // Deadband (25–30m): reset streaks, keep current badge state
    state.gpsWeakStreak = 0;
    state.gpsStrongStreak = 0;
  }

  const dist = haversineDistance(
    state.youAreHereLocationlat, state.youAreHereLocationlng,
    e.latlng.lat, e.latlng.lng,
  );

  // On first GPS fix, zoom to street level (defer if screen is off)
  if (state.initialZoom && !state.screenOff) {
    map.setZoom(16);
    state.initialZoom = false;
  }

  // Accept update if accuracy improved OR we've moved meaningfully
  if (e.accuracy < state.prior || dist > e.accuracy / 2) {
    state.prior = e.accuracy;
    state.youAreHereLocationlat = e.latlng.lat;
    state.youAreHereLocationlng = e.latlng.lng;
    state.youAreHereLocation = e.latlng;

    // Skip map rendering when screen is off — GPS data is still processed for recording
    if (!state.screenOff) {
      // Blue dot: create on first fix, update position on subsequent fixes
      if (state.locationMarker === null) {
        state.locationMarker = L.marker(e.latlng, {
          icon: BLUE_DOT_ICON,
          zIndexOffset: 1000,
          interactive: false,
        }).addTo(map);
      } else {
        state.locationMarker.setLatLng(e.latlng);
        // Restore blue icon in case it was grayed out from a prior signal loss
        state.locationMarker.setIcon(BLUE_DOT_ICON);
      }

      // Accuracy circle: translucent blue, no stroke, opacity fades as accuracy improves
      // Opacity: full (0.35) at 100m+ accuracy, fades to 0.1 at 5m or better
      const fillOpacity = Math.max(0.1, Math.min(0.35, e.accuracy / 300));
      if (state.accuracyCircle === null) {
        state.accuracyCircle = L.circle(e.latlng, {
          radius: e.accuracy,
          weight: 0,
          fillColor: '#4285F4',
          fillOpacity,
        }).addTo(map);
      } else {
        state.accuracyCircle.setLatLng(e.latlng);
        state.accuracyCircle.setRadius(e.accuracy);
        state.accuracyCircle.setStyle({ fillOpacity });
      }
    }

    state.lastSpeedMs = isNaN(e.speed) ? 0 : e.speed;
    state.lastAltM = (e.altitude as number | null) !== null ? e.altitude : undefined;

    // Heading wedge: rotate the cone behind the blue dot to match GPS course.
    // Hold the last valid bearing for ~10s when course is NaN (low speed);
    // fade out after that so the wedge doesn't lie about direction.
    if (state.locationMarker !== null && !state.screenOff) {
      const el = state.locationMarker.getElement();
      if (el) {
        const heading = (e as L.LocationEvent & { heading?: number }).heading;
        if (typeof heading === 'number' && !isNaN(heading)) {
          lastValidHeadingDeg = heading;
          lastValidHeadingMs = performance.now();
          el.style.setProperty('--heading-deg', `${heading}deg`);
          el.classList.add('blue-dot--has-heading');
        } else if (
          lastValidHeadingDeg !== null &&
          performance.now() - lastValidHeadingMs < HEADING_HOLD_MS
        ) {
          el.style.setProperty('--heading-deg', `${lastValidHeadingDeg}deg`);
          el.classList.add('blue-dot--has-heading');
        } else {
          el.classList.remove('blue-dot--has-heading');
        }
      }
    }

    updateGuidance(e, state, map);
  }

  // Adaptive GPS accuracy: reduce power when stationary, restore when moving
  const speed = e.speed;
  if (!isNaN(speed) && speed >= 0) {
    if (speed < STATIONARY_SPEED_MS) {
      state.stationaryFixCount++;
      if (state.stationaryFixCount >= STATIONARY_THRESHOLD && state.updateCallback > 0) {
        setWatchAccuracy(map, false);
      }
    } else {
      if (state.stationaryFixCount >= STATIONARY_THRESHOLD) {
        setWatchAccuracy(map, true);
      }
      state.stationaryFixCount = 0;
    }
  }

  // Skip UI updates when screen is off
  if (!state.screenOff) {
    updateLocateIcon(state.locateState);

    // Follow GPS position when in active (following) state — animate smoothly
    if (state.locateState === 'active' && state.youAreHereLocation !== null) {
      map.panTo(state.youAreHereLocation, { animate: true, duration: 0.25 });
    }
  }
}

// Handle GPS signal loss — gray out the dot and reset accuracy filter
export function onLocationError(state: AppState): void {
  if (state.locationMarker !== null) {
    state.locationMarker.setIcon(createGrayDotIcon());
  }
  // Only reset prior when we have no position yet; if we already have a fix,
  // preserve prior so the haversine filter doesn't accept a degraded-accuracy
  // position that would make the dot jump on signal recovery.
  if (state.locationMarker === null) {
    state.prior = 1000;
  }
}

// Remove blue dot and accuracy circle from the map (called when locate is turned off)
export function clearLocationMarkers(state: AppState, map: L.Map): void {
  if (state.locationMarker !== null) {
    map.removeLayer(state.locationMarker);
    state.locationMarker = null;
  }
  if (state.accuracyCircle !== null) {
    map.removeLayer(state.accuracyCircle);
    state.accuracyCircle = null;
  }
}
