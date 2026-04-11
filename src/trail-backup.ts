/**
 * Intent: Persist in-progress trail data to localStorage so a page reload during recording doesn't lose the track
 * Context: Called by recording.ts on each trail point append; cleared when recording stops; checked on startup in main.ts
 * Pattern: Convert performance.now() timestamps to wall-clock milliseconds before serializing; reverse on restore
 * Future: If trail grows beyond localStorage quota (~5MB), silently degrade to memory-only (no data loss during the session)
 */
import L from 'leaflet';
import type { AppState } from './types';

const BACKUP_KEY = 'webmap-trail-backup';

interface SerializedPoint {
  lat: number;
  lng: number;
  /** Wall-clock epoch ms (Date.now() equivalent at the time the point was recorded) */
  wallMs: number;
  speedMs: number;
}

interface TrailBackup {
  /** Wall-clock epoch ms when recording started */
  recordingStartWallMs: number;
  /** Accumulated pause duration in ms */
  recordingPauseMs: number;
  trailSegments: SerializedPoint[][];
  /** Current (active) segment points */
  trailPoints: SerializedPoint[];
  totalDistance: number;
}

function toSerializedPoint(
  p: { latlng: L.LatLng; t: number; speedMs: number },
  epochOffset: number,
): SerializedPoint {
  return {
    lat: p.latlng.lat,
    lng: p.latlng.lng,
    wallMs: epochOffset + p.t,
    speedMs: p.speedMs,
  };
}

function serializeSegment(
  seg: Array<{ latlng: L.LatLng; t: number; speedMs: number }>,
  epochOffset: number,
): SerializedPoint[] {
  return seg.map((p) => toSerializedPoint(p, epochOffset));
}

/** Write the current recording state to localStorage. Silently ignores quota errors. */
export function saveTrailBackup(state: AppState): void {
  // epochOffset = wall-clock equivalent of performance.now() == 0
  const epochOffset = Date.now() - performance.now();
  const backup: TrailBackup = {
    recordingStartWallMs: epochOffset + state.recordingStartMs,
    recordingPauseMs: state.recordingPauseMs,
    trailSegments: state.trailSegments.map((seg) => serializeSegment(seg, epochOffset)),
    trailPoints: serializeSegment(state.trailPoints, epochOffset),
    totalDistance: state.totalDistance,
  };
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
  } catch {
    // Quota exceeded — silently degrade; in-memory recording continues unaffected
  }
}

/** Read a previously persisted trail backup, or null if none exists. */
export function loadTrailBackup(): TrailBackup | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TrailBackup;
  } catch {
    return null;
  }
}

/** Remove the trail backup from localStorage (call after recording stops). */
export function clearTrailBackup(): void {
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch { /* ignore */ }
}

/**
 * Restore a persisted trail backup into AppState and redraw the trail on the map.
 * Returns the number of total points restored, or 0 if backup was empty/unusable.
 */
export function applyTrailBackup(
  backup: TrailBackup,
  state: AppState,
): number {
  // Convert wall-clock timestamps back to performance.now()-relative offsets
  const epochOffset = Date.now() - performance.now();

  function restorePoints(
    pts: SerializedPoint[],
  ): Array<{ latlng: L.LatLng; t: number; speedMs: number }> {
    return pts.map((p) => ({
      latlng: L.latLng(p.lat, p.lng),
      t: p.wallMs - epochOffset,
      speedMs: p.speedMs,
    }));
  }

  const allSegs = backup.trailSegments.map(restorePoints);
  const activeSeg = restorePoints(backup.trailPoints);

  // Merge into state
  state.recordingStartMs = backup.recordingStartWallMs - epochOffset;
  state.recordingPauseMs = backup.recordingPauseMs;
  state.totalDistance = backup.totalDistance;
  state.trailSegments = allSegs;
  state.trailPoints = activeSeg;

  // Rebuild polyline from all points
  const allLatLngs: L.LatLng[] = [
    ...allSegs.flatMap((s) => s.map((p) => p.latlng)),
    ...activeSeg.map((p) => p.latlng),
  ];

  if (allLatLngs.length > 0) {
    if (state.trail) state.trail.setLatLngs(allLatLngs);
    if (state.trailGlow) state.trailGlow.setLatLngs(allLatLngs);
    const last = allLatLngs[allLatLngs.length - 1];
    if (last) {
      state.lastTrailPoint = last;
      state.lastArrowPoint = last;
    }
  }

  return allLatLngs.length;
}
