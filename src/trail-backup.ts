/**
 * Intent: Persist in-progress trail data to localStorage so a page reload during recording doesn't lose the track
 * Context: Called by recording.ts on each trail point append (throttled); cleared when recording stops; checked on startup in main.ts
 * Pattern: Convert performance.now() timestamps to wall-clock milliseconds before serializing; reverse on restore
 * Future: If trail grows beyond localStorage quota (~5MB), silently degrade to memory-only (no data loss during the session)
 */
import L from 'leaflet';
import type { AppState } from './types';

const BACKUP_KEY = 'webmap-trail-backup';
const DISMISSED_KEY = 'webmap-trail-backup-dismissed';
const CURRENT_VERSION = 1;

interface SerializedPoint {
  lat: number;
  lng: number;
  /** Wall-clock epoch ms (Date.now() equivalent at the time the point was recorded) */
  wallMs: number;
  speedMs: number;
}

interface TrailBackup {
  /** Schema version — bump when fields change so stale backups can be discarded cleanly */
  version: 1;
  /** Wall-clock epoch ms when recording started */
  recordingStartWallMs: number;
  /**
   * Accumulated pause duration in ms.
   * Known limitation: recordingState ('recording' | 'paused') is not serialized.
   * If the page reloads while recording is paused, the in-progress pause duration
   * (performance.now() - recordingPauseStart) is lost and will not be subtracted
   * from the elapsed time, slightly inflating the displayed time. This is a low-
   * probability corner case (crash during pause) and acceptable for now.
   */
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

// ── Throttled write ───────────────────────────────────────────────────────────
// Serialize the whole trail on the first point of a burst, then at most once
// every 5 seconds. Timer is NOT reset on each call — resetting would turn this
// into a debounce and the trailing flush would never fire under continuous GPS input.

let _backupDirty = false;
let _backupTimer: ReturnType<typeof setTimeout> | null = null;
// Stashed state ref so the beforeunload handler can flush without a closure over state.
let _currentState: AppState | null = null;

function flushBackup(state: AppState): void {
  const epochOffset = Date.now() - performance.now();
  const backup: TrailBackup = {
    version: CURRENT_VERSION,
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

function beforeUnloadHandler(): void {
  // Flush any dirty points on intentional tab close so the trailing-edge timer
  // (which won't fire after unload) doesn't leave up to 5s of data unpersisted.
  // _backupDirty is intentionally NOT reset here: if the user cancels the unload
  // ("stay on page"), the timer is still running and will flush correctly on expiry.
  if (_backupDirty && _currentState !== null) {
    flushBackup(_currentState);
  }
}

/**
 * Write the current recording state to localStorage, throttled to at most once per 5s.
 * Leading-edge write fires immediately on the first call; trailing flush catches any
 * points that arrived during the 5s window. A beforeunload handler ensures intentional
 * tab-close also flushes any dirty state.
 */
export function saveTrailBackup(state: AppState): void {
  _currentState = state;
  if (_backupTimer === null) {
    // First call — write immediately for fast initial persistence, then arm the timer
    flushBackup(state);
    _backupDirty = false;
    _backupTimer = setTimeout(() => {
      if (_backupDirty && _currentState !== null) flushBackup(_currentState);
      _backupDirty = false;
      _backupTimer = null;
    }, 5000);
    // addEventListener deduplicates same-reference listeners per the spec, so calling
    // this on every leading-edge burst is safe — it effectively registers once per session.
    window.addEventListener('beforeunload', beforeUnloadHandler);
  } else {
    // Timer already running — mark dirty so the trailing flush picks up the latest points
    _backupDirty = true;
  }
}

/** Read a previously persisted trail backup, or null if none exists or shape is invalid. */
export function loadTrailBackup(): TrailBackup | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // Runtime shape guard: discard stale/partial data from schema changes or other apps
    const p = parsed as Record<string, unknown>;
    const trailPoints = p['trailPoints'];
    const trailSegments = p['trailSegments'];
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      p['version'] !== CURRENT_VERSION ||
      !Array.isArray(trailPoints) ||
      !Array.isArray(trailSegments) ||
      typeof p['totalDistance'] !== 'number' ||
      typeof p['recordingStartWallMs'] !== 'number' ||
      typeof p['recordingPauseMs'] !== 'number'
    ) {
      localStorage.removeItem(BACKUP_KEY);
      return null;
    }
    // Intentional spot-check: validates only the first element of each array.
    // Full-scan would be O(n) on load; self-written data makes deep corruption unlikely.
    function isValidPoint(pt: unknown): boolean {
      return (
        typeof pt === 'object' && pt !== null &&
        typeof (pt as Record<string, unknown>)['lat'] === 'number' &&
        typeof (pt as Record<string, unknown>)['lng'] === 'number'
      );
    }
    const firstPoint = trailPoints[0];
    if (firstPoint !== undefined && !isValidPoint(firstPoint)) {
      localStorage.removeItem(BACKUP_KEY);
      return null;
    }
    for (const seg of trailSegments) {
      if (!Array.isArray(seg)) { localStorage.removeItem(BACKUP_KEY); return null; }
      const firstSeg = seg[0];
      if (firstSeg !== undefined && !isValidPoint(firstSeg)) {
        localStorage.removeItem(BACKUP_KEY);
        return null;
      }
    }
    return parsed as TrailBackup;
  } catch {
    return null;
  }
}

/**
 * Mark a backup as dismissed by the user so the restore prompt is not shown again
 * for this specific recording session. The backup itself is kept intact in case
 * confirm() was suppressed by the browser (PWA mode) rather than genuinely cancelled.
 * Call when the user declines the restore prompt.
 */
export function dismissTrailBackup(recordingStartWallMs: number): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(recordingStartWallMs));
  } catch { /* ignore */ }
}

/**
 * Returns true if the user has already dismissed the restore prompt for this backup.
 * Used to prevent the prompt from re-appearing on every page load after a genuine cancel.
 */
export function isTrailBackupDismissed(recordingStartWallMs: number): boolean {
  try {
    const stored = localStorage.getItem(DISMISSED_KEY);
    return stored !== null && Number(stored) === recordingStartWallMs;
  } catch {
    return false;
  }
}

/** Remove the trail backup and dismissed marker from localStorage (call after recording stops). */
export function clearTrailBackup(): void {
  if (_backupTimer !== null) {
    clearTimeout(_backupTimer);
    _backupTimer = null;
  }
  _backupDirty = false;
  _currentState = null;
  window.removeEventListener('beforeunload', beforeUnloadHandler);
  try {
    localStorage.removeItem(BACKUP_KEY);
    localStorage.removeItem(DISMISSED_KEY);
  } catch { /* ignore */ }
}

/**
 * Restore a persisted trail backup into AppState and redraw the trail on the map.
 *
 * Known limitation: direction-arrow markers are NOT restored — the trail line appears
 * correct but has no chevrons for the pre-reload portion. Arrow markers are cheap to
 * lose (purely decorative) and expensive to reconstruct without re-running the full
 * append loop. Acceptable trade-off for now.
 *
 * Known limitation: pause-segment boundaries are merged into a single flat polyline
 * for the restored visual. The per-segment data is preserved in state.trailSegments,
 * so GPX export will still emit correct <trkseg> splits.
 */
export function applyTrailBackup(
  backup: TrailBackup,
  state: AppState,
): void {
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

  // Rebuild polyline from all points (segments merged into one visual line —
  // see "Known limitation" above for why segment gaps are not preserved visually)
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
}
