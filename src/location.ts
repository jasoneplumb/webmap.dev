// Intent: Handle GPS location events — apply haversine distance filter, update icon
//         states, recenter the map, and append points to the active recording trail
// Context: map.locate() fires 'locationfound' for every GPS fix. The haversine filter
//          ignores updates where we haven't moved more than half the accuracy radius
//          AND accuracy hasn't improved — reduces jitter when standing still.
import L from 'leaflet';
import type { AppState } from './types';
import { appendTrailPoint } from './recording';

export function onLocationFound(e: L.LocationEvent, state: AppState, map: L.Map): void {
  // Haversine formula: great-circle distance between previous and current position
  const p = Math.PI / 180;
  const f =
    0.5 -
    Math.cos((state.youAreHereLocationlat - e.latlng.lat) * p) / 2 +
    (Math.cos(e.latlng.lat * p) *
      Math.cos(state.youAreHereLocationlat * p) *
      (1 - Math.cos((state.youAreHereLocationlng - e.latlng.lng) * p))) /
      2;
  const R = 6371000; // Earth's radius in meters
  const dist = 2 * R * Math.asin(Math.sqrt(f));

  // Accept update if accuracy improved OR we've moved meaningfully
  if (e.accuracy < state.prior || dist > e.accuracy / 2) {
    state.prior = e.accuracy;
    state.youAreHereLocationlat = e.latlng.lat;
    state.youAreHereLocationlng = e.latlng.lng;
    state.youAreHereLocation = e.latlng;

    if (state.recordingState === 'recording') {
      const speedMs = isNaN(e.speed) ? 0 : e.speed;
      appendTrailPoint(e.latlng, speedMs, state, map);
    }
  }

  if (state.centering) {
    const cnt_img = document.getElementById('centering') as HTMLImageElement | null;
    if (cnt_img) {
      cnt_img.alt = cnt_img.title = 'Centering Toggle (Enabled)';
      cnt_img.src = '/centering-color-v1.1.svg';
    }
    if (state.youAreHereLocation !== null) {
      map.panTo(state.youAreHereLocation);
    }
  }
}
