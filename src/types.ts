// Intent: Shared mutable application state passed to all modules
// Pattern: Single state object created in main.ts and passed by reference;
//          modules mutate it directly (no event bus needed for this size app)
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
  lastTrailPoint: L.LatLng | null;
  lastArrowPoint: L.LatLng | null;
  lastSpeedMs: number;
  trail: L.Polyline | null;
  trailGlow: L.Polyline | null;
  trailPoints: Array<{ latlng: L.LatLng; t: number; speedMs: number }>;
  trailSegments: Array<Array<{ latlng: L.LatLng; t: number; speedMs: number }>>;
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
    lastTrailPoint: null,
    lastArrowPoint: null,
    lastSpeedMs: 0,
    trail: null,
    trailGlow: null,
    trailPoints: [],
    trailSegments: [],
    arrowMarkers: [],
    statsTimer: null,
  };
}
