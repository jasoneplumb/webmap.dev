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

/** Discard GPS fixes coarser than this threshold for trail recording (metres). */
export const TRAIL_MAX_ACCURACY_M = 30;

/** Haversine great-circle distance between two lat/lng points (metres). */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const p = Math.PI / 180;
  const f =
    0.5 -
    Math.cos((lat1 - lat2) * p) / 2 +
    (Math.cos(lat2 * p) *
      Math.cos(lat1 * p) *
      (1 - Math.cos((lng1 - lng2) * p))) /
      2;
  const R = 6371000; // Earth's radius in metres
  return 2 * R * Math.asin(Math.sqrt(f));
}

/** Speed below which the user is considered stationary (m/s). 0.5 m/s ~ 1.8 km/h. */
const STATIONARY_SPEED_MS = 0.5;
/** Consecutive stationary fixes before switching to low-accuracy GPS to save battery. */
const STATIONARY_THRESHOLD = 5;

// divIcon HTML for the blue pulsing dot — styled via .blue-dot CSS in style.css
const BLUE_DOT_ICON = L.divIcon({
  className: 'blue-dot',
  html: '<div class="blue-dot__inner"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

// Gray dot shown on GPS signal loss
function createGrayDotIcon(): L.DivIcon {
  return L.divIcon({
    className: 'blue-dot blue-dot--gray',
    html: '<div class="blue-dot__inner"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

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

    // Track speed + altitude so a future guidance feature can read them off
    // AppState without re-reading the GPS event.
    state.lastSpeedMs = isNaN(e.speed) ? 0 : e.speed;
    state.lastAltM = (e.altitude as number | null) !== null ? e.altitude : undefined;
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
