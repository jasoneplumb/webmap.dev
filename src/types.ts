// Intent: Shared mutable application state passed to all modules
// Pattern: Single state object created in main.ts and passed by reference;
//          modules mutate it directly (no event bus needed for this size app)
import type L from 'leaflet';

export interface AppState {
  // GPS position tracking
  youAreHereLocation: L.LatLng | null;
  youAreHereLocationlat: number;
  youAreHereLocationlng: number;
  prior: number; // last known accuracy in meters; used to filter redundant GPS updates

  // Control toggle states
  copyToClipboard: boolean;
  centering: boolean;
  tracking: boolean;
  initiateTracking: boolean; // true until first tracking activation (triggers auto-centering)

  // Timer/polling state
  updateCallback: number; // refcount: 0=stopped, 1=centering, 2=centering+tracking
  timer: ReturnType<typeof setTimeout> | undefined;
  initialZoom: boolean; // true until first GPS fix; zooms to level 16 on first fix
}

export function createInitialState(): AppState {
  return {
    youAreHereLocation: null,
    youAreHereLocationlat: 0,
    youAreHereLocationlng: 0,
    prior: 1000,
    copyToClipboard: false,
    centering: false,
    tracking: false,
    initiateTracking: true,
    updateCallback: 0,
    timer: undefined,
    initialZoom: true,
  };
}
