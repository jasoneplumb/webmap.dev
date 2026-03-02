// Intent: GPS polling loop — schedules repeated location requests at 500ms intervals
// Context: Leaflet's map.locate() is one-shot; we reschedule after each result.
//          updateCallback is a refcount: 0=stopped, 1+=running (centering and/or tracking).
// Pattern: cancelUpdateCallback → scheduleUpdateCallback → updateLocation → repeat
import type L from 'leaflet';
import type { AppState } from './types';

export function cancelUpdateCallback(state: AppState, map: L.Map): void {
  if (state.timer !== undefined) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }
  map.stopLocate();
}

export function scheduleUpdateCallback(state: AppState, map: L.Map): void {
  if (state.timer !== undefined) {
    clearTimeout(state.timer);
  }
  state.timer = setTimeout(() => updateLocation(state, map), 500);
}

function updateLocation(state: AppState, map: L.Map): void {
  map.stopLocate();
  if (state.initialZoom) {
    map.setZoom(16);
    state.initialZoom = false;
  }
  map.locate({ setView: false, maxZoom: map.getZoom() });
  scheduleUpdateCallback(state, map);
}
