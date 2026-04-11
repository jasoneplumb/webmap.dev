/**
 * Intent: Shared mutable application state passed to all modules
 * Context: Created once in main.ts and threaded by reference through every module; no store or event bus
 * Pattern: Single state object mutated directly — works because this is a single-page app with no concurrent writers
 * Future: Will become unwieldy if state grows significantly; consider splitting into domain sub-objects
 */
import type L from 'leaflet';

// Three-state location button: off → active (following) → passive (dot visible, not following)
export type LocateState = 'off' | 'active' | 'passive';

export type RecordingState = 'idle' | 'recording' | 'paused';

export interface AppState {
  // GPS position tracking
  youAreHereLocation: L.LatLng | null;
  youAreHereLocationlat: number;
  youAreHereLocationlng: number;
  prior: number; // last known accuracy in meters; used to filter redundant GPS updates

  // Control toggle states
  locateState: LocateState; // three-state location button (replaces centering boolean)

  // Watch/polling state
  updateCallback: number; // refcount: 0=stopped; each consumer (locate, recording) adds 1
  initialZoom: boolean; // true until first GPS fix; zooms to level 16 on first fix

  // Persistent location marker refs (updated in place instead of adding new layers)
  locationMarker: L.Marker | null;
  accuracyCircle: L.Circle | null;

  // Recording state machine
  recordingState: RecordingState;
  recordingStartMs: number;
  recordingPauseMs: number;
  recordingPauseStart: number | null;
  totalDistance: number;
  totalAscent: number;
  lastTrailPoint: L.LatLng | null;
  lastArrowPoint: L.LatLng | null;
  lastSpeedMs: number;
  lastAltM: number | undefined;
  trail: L.Polyline | null;
  trailGlow: L.Polyline | null;
  trailPoints: Array<{ latlng: L.LatLng; t: number; speedMs: number; altM?: number }>;
  trailSegments: Array<Array<{ latlng: L.LatLng; t: number; speedMs: number; altM?: number }>>;
  arrowMarkers: L.Marker[];
  statsTimer: ReturnType<typeof setInterval> | null;
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
    recordingState: 'idle',
    recordingStartMs: 0,
    recordingPauseMs: 0,
    recordingPauseStart: null,
    totalDistance: 0,
    totalAscent: 0,
    lastTrailPoint: null,
    lastArrowPoint: null,
    lastSpeedMs: 0,
    lastAltM: undefined,
    trail: null,
    trailGlow: null,
    trailPoints: [],
    trailSegments: [],
    arrowMarkers: [],
    statsTimer: null,
  };
}
