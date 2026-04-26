/**
 * Intent: Shared mutable application state passed to all modules
 * Context: Created once in main.ts and threaded by reference through every module; no store or event bus
 * Pattern: Single state object mutated directly — works because this is a single-page app with no concurrent writers
 * Future: Will become unwieldy if state grows significantly; consider splitting into domain sub-objects
 */
import type L from 'leaflet';
import type { Keepalive } from './keepalive';

// Three-state location button: off → active (following) → passive (dot visible, not following)
export type LocateState = 'off' | 'active' | 'passive';

export interface AppState {
  // GPS position tracking
  youAreHereLocation: L.LatLng | null;
  youAreHereLocationlat: number;
  youAreHereLocationlng: number;
  prior: number; // last known accuracy in meters; used to filter redundant GPS updates

  // Control toggle states
  locateState: LocateState; // three-state location button (replaces centering boolean)

  // Watch/polling state
  updateCallback: number; // refcount: 0=stopped; each consumer (locate, future guidance) adds 1
  initialZoom: boolean; // true until first GPS fix; zooms to level 16 on first fix

  // Persistent location marker refs (updated in place instead of adding new layers)
  locationMarker: L.Marker | null;
  accuracyCircle: L.Circle | null;

  // GPS-fix metadata kept across location updates — reused by guidance later
  lastSpeedMs: number;
  lastAltM: number | undefined;
  lastGpsAccuracy: number | null; // most recent GPS fix accuracy (metres)

  // Hysteresis state for GPS weak-signal badge — prevents flicker in marginal signal
  gpsWeakStreak: number;        // consecutive fixes with accuracy > TRAIL_MAX_ACCURACY_M
  gpsStrongStreak: number;      // consecutive fixes with accuracy < (TRAIL_MAX_ACCURACY_M - 5)
  gpsWeakBadgeVisible: boolean; // debounced badge state: true after 2+ weak, false after 2+ strong

  // Battery efficiency: adaptive GPS accuracy
  stationaryFixCount: number;   // consecutive fixes with no significant movement

  // Battery efficiency: screen-off optimization
  screenOff: boolean;           // true when document is hidden (Page Visibility API)

  // Battery efficiency: battery monitoring
  batteryLevel: number | null;          // current battery level 0–1, null if API unavailable
  batteryCharging: boolean;             // true if device is charging
  batteryDrainStartLevel: number | null; // battery level when recording started
  batteryDrainStartMs: number;          // performance.now() when drain tracking began

  // Background GPS keepalive: screen wake lock + silent audio loop
  keepalive: Keepalive | null;
}

export function createInitialState(): AppState {
  return {
    youAreHereLocation: null,
    youAreHereLocationlat: 0,
    youAreHereLocationlng: 0,
    prior: 1000,
    locateState: 'off',
    updateCallback: 0,
    initialZoom: true,
    locationMarker: null,
    accuracyCircle: null,
    lastSpeedMs: 0,
    lastAltM: undefined,
    lastGpsAccuracy: null,
    gpsWeakStreak: 0,
    gpsStrongStreak: 0,
    gpsWeakBadgeVisible: false,
    stationaryFixCount: 0,
    screenOff: false,
    batteryLevel: null,
    batteryCharging: false,
    batteryDrainStartLevel: null,
    batteryDrainStartMs: 0,
    keepalive: null,
  };
}
