/**
 * Intent: Trail recording state machine, real-time stats overlay, and GPX export
 * Context: appendTrailPoint is called by location.ts on every accepted GPS fix; recording controls are mounted by main.ts
 * Pattern: State machine (idle → recording → paused → idle) with refcount-based GPS polling; stats bar updates on a 1s interval
 * Future: GPX export has no pause segment markers — paused sections appear as continuous track; very long trails (1000+ points) may affect map render performance
 */
import L from 'leaflet';
import type { AppState } from './types';
import { saveTrailBackup, clearTrailBackup, loadTrailBackup, applyTrailBackup, dismissTrailBackup, isTrailBackupDismissed } from './trail-backup';

// tradeoff: 5m minimum distance filters GPS jitter at walking pace without skipping real movement; lower values add noise, higher values miss tight turns
const MIN_TRAIL_DIST_M = 5;
const MIN_ARROW_DIST_M = 50;  // minimum metres between direction-arrow markers

// Shared polyline options — used in both startRecording and maybeRestoreTrailBackup
// to avoid style drift between the two code paths.
const TRAIL_LINE_OPTS: L.PolylineOptions = { color: '#4287f5', weight: 4, smoothFactor: 2, interactive: false };
const TRAIL_GLOW_OPTS: L.PolylineOptions = { color: 'rgba(66,135,245,0.25)', weight: 14, smoothFactor: 2, interactive: false };

// ── Geometry helpers ─────────────────────────────────────────────────────────

function haversineM(a: L.LatLng, b: L.LatLng): number {
  const R = 6371000;
  const p = Math.PI / 180;
  const dLat = (b.lat - a.lat) * p;
  const dLng = (b.lng - a.lng) * p;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingDeg(a: L.LatLng, b: L.LatLng): number {
  const p = Math.PI / 180;
  const dLng = (b.lng - a.lng) * p;
  const y = Math.sin(dLng) * Math.cos(b.lat * p);
  const x =
    Math.cos(a.lat * p) * Math.sin(b.lat * p) -
    Math.sin(a.lat * p) * Math.cos(b.lat * p) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ── Time and formatting helpers ──────────────────────────────────────────────

function elapsedMs(state: AppState): number {
  const currentPause =
    state.recordingPauseStart !== null ? performance.now() - state.recordingPauseStart : 0;
  return performance.now() - state.recordingStartMs - state.recordingPauseMs - currentPause;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h)}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * intent: Detect whether the user's locale uses imperial units (miles/mph) at module load time
 * method: Intl.Locale.measurementSystem where supported; region tag fallback (US/LR/MM) otherwise
 * effect: Single boolean used by formatDistance and formatSpeed — avoids per-call locale parsing
 */
// constraint: measurementSystem is not yet in all TypeScript lib defs, so we use an unknown cast
function usesImperial(): boolean {
  try {
    const locale = new Intl.Locale(navigator.language);
    const ms = (locale as unknown as { measurementSystem?: string }).measurementSystem;
    if (ms) return ms === 'ussystem' || ms === 'uksystem';
  } catch { /* ignore */ }
  // Fallback: check region from language tag (e.g. "en-US" → "US")
  const region = navigator.language.split('-')[1]?.toUpperCase();
  return region === 'US' || region === 'LR' || region === 'MM';
}

const IMPERIAL = usesImperial();
const M_PER_MI = 1609.344;
const M_PER_FT = 0.3048;

function formatDistance(m: number): string {
  if (IMPERIAL) {
    const miles = m / M_PER_MI;
    return miles >= 0.1 ? `${miles.toFixed(2)} mi` : `${Math.round(m / M_PER_FT)} ft`;
  }
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function formatSpeed(ms: number): string {
  if (IMPERIAL) {
    const mph = ms * 3600 / M_PER_MI;
    return mph < 0.3 ? '-- mph' : `${mph.toFixed(1)} mph`;
  }
  const kmh = ms * 3.6;
  return kmh < 0.5 ? '-- km/h' : `${kmh.toFixed(1)} km/h`;
}

// ── Stats bar DOM ─────────────────────────────────────────────────────────────

export function createStatsBar(): void {
  if (document.getElementById('recording-stats')) return;

  const bar = document.createElement('div');
  bar.id = 'recording-stats';
  bar.style.display = 'none';
  bar.innerHTML =
    '<div class="rec-indicator">' +
    '<span class="rec-dot"></span>' +
    '<span id="rec-status-label">RECORDING</span>' +
    '</div>' +
    '<div class="stat-item">' +
    '<span class="stat-label">Time</span>' +
    '<span class="stat-value" id="stat-time">00:00</span>' +
    '</div>' +
    '<div class="stat-item">' +
    '<span class="stat-label">Dist</span>' +
    '<span class="stat-value" id="stat-dist">0 m</span>' +
    '</div>' +
    '<div class="stat-item">' +
    '<span class="stat-label">Speed</span>' +
    `<span class="stat-value" id="stat-speed">-- ${IMPERIAL ? 'mph' : 'km/h'}</span>` +
    '</div>';

  document.getElementById('map')?.appendChild(bar);
}

function updateStatsBar(state: AppState): void {
  const timeEl = document.getElementById('stat-time');
  const distEl = document.getElementById('stat-dist');
  const speedEl = document.getElementById('stat-speed');
  const labelEl = document.getElementById('rec-status-label');
  const dotEl = document.querySelector<HTMLElement>('.rec-dot');

  if (timeEl) timeEl.textContent = formatElapsed(elapsedMs(state));
  if (distEl) distEl.textContent = formatDistance(state.totalDistance);
  if (speedEl) speedEl.textContent = formatSpeed(state.lastSpeedMs);
  if (labelEl) labelEl.textContent = state.recordingState === 'paused' ? 'PAUSED' : 'RECORDING';
  if (dotEl) {
    if (state.recordingState === 'paused') {
      dotEl.classList.add('rec-dot-paused');
    } else {
      dotEl.classList.remove('rec-dot-paused');
    }
  }
}

function setStatsBarVisible(visible: boolean): void {
  const bar = document.getElementById('recording-stats');
  if (bar) bar.style.display = visible ? 'flex' : 'none';
}

// ── Recording control panel ───────────────────────────────────────────────────

let recControlContainer: HTMLElement | null = null;

// Module-level refs so updateRecordingButtons can re-render from outside
let storedState: AppState | null = null;
let storedActivatePolling: (() => void) | null = null;
let storedDeactivatePolling: (() => void) | null = null;
let storedMap: L.Map | null = null;

export function addRecordingControl(
  map: L.Map,
  state: AppState,
  activatePolling: () => void,
  deactivatePolling: () => void,
): void {
  storedState = state;
  storedActivatePolling = activatePolling;
  storedDeactivatePolling = deactivatePolling;
  storedMap = map;

  const RecCtrl = L.Control.extend({
    onAdd(): HTMLElement {
      const container = L.DomUtil.create('div', 'recording-panel');
      recControlContainer = container;
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      renderButtons(state, activatePolling, deactivatePolling, map);
      return container;
    },
  });

  new (RecCtrl as new (opts: L.ControlOptions) => L.Control)({
    position: 'bottomright',
  }).addTo(map);
}

/** Re-render recording buttons (call when locate state changes) */
export function updateRecordingButtons(): void {
  if (storedState && storedActivatePolling && storedDeactivatePolling && storedMap) {
    renderButtons(storedState, storedActivatePolling, storedDeactivatePolling, storedMap);
  }
}

function renderButtons(
  state: AppState,
  activatePolling: () => void,
  deactivatePolling: () => void,
  map: L.Map,
): void {
  const c = recControlContainer;
  if (!c) return;
  c.innerHTML = '';

  if (state.recordingState === 'idle') {
    const btn = makeBtn('⏺ Record', 'rec-btn rec-btn-start', () => {
      startRecording(state, map, activatePolling);
      renderButtons(state, activatePolling, deactivatePolling, map);
    });
    if (state.locateState === 'off') {
      btn.disabled = true;
      btn.title = 'Enable location first';
    }
    c.appendChild(btn);
  } else if (state.recordingState === 'recording') {
    c.appendChild(
      makeBtn('⏸ Pause', 'rec-btn rec-btn-pause', () => {
        pauseRecording(state);
        renderButtons(state, activatePolling, deactivatePolling, map);
      }),
    );
    c.appendChild(
      makeBtn('⏹ Stop', 'rec-btn rec-btn-stop', () => {
        if (confirmStop()) {
          stopRecording(state, deactivatePolling);
          renderButtons(state, activatePolling, deactivatePolling, map);
        }
      }),
    );
  } else {
    // paused
    c.appendChild(
      makeBtn('▶ Resume', 'rec-btn rec-btn-resume', () => {
        resumeRecording(state);
        renderButtons(state, activatePolling, deactivatePolling, map);
      }),
    );
    c.appendChild(
      makeBtn('⏹ Stop', 'rec-btn rec-btn-stop', () => {
        if (confirmStop()) {
          stopRecording(state, deactivatePolling);
          renderButtons(state, activatePolling, deactivatePolling, map);
        }
      }),
    );
  }
}

function makeBtn(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.className = className;
  btn.addEventListener('click', onClick);
  return btn;
}

function confirmStop(): boolean {
  return confirm('Stop recording? The track will be finalized.');
}

// ── State machine ─────────────────────────────────────────────────────────────

function startRecording(
  state: AppState,
  map: L.Map,
  activatePolling: () => void,
): void {
  // Clear any trail left from a previous session
  if (state.trail) {
    map.removeLayer(state.trail);
    state.trail = null;
  }
  if (state.trailGlow) {
    map.removeLayer(state.trailGlow);
    state.trailGlow = null;
  }
  state.arrowMarkers.forEach((m) => map.removeLayer(m));
  state.arrowMarkers = [];

  state.recordingState = 'recording';
  state.recordingStartMs = performance.now();
  state.recordingPauseMs = 0;
  state.recordingPauseStart = null;
  state.totalDistance = 0;
  state.lastTrailPoint = null;
  state.lastArrowPoint = null;
  state.lastSpeedMs = 0;
  state.trailPoints = [];
  state.trailSegments = [];

  // Glow layer beneath the main trail line
  state.trailGlow = L.polyline([], TRAIL_GLOW_OPTS).addTo(map);

  // Main trail line
  state.trail = L.polyline([], TRAIL_LINE_OPTS).addTo(map);

  activatePolling(); // recording refcount

  setStatsBarVisible(true);
  if (state.statsTimer !== null) clearInterval(state.statsTimer);
  state.statsTimer = setInterval(() => updateStatsBar(state), 1000);
}

function pauseRecording(state: AppState): void {
  if (state.recordingState !== 'recording') return;
  state.recordingState = 'paused';
  state.recordingPauseStart = performance.now();
  updateStatsBar(state);
}

function resumeRecording(state: AppState): void {
  if (state.recordingState !== 'paused') return;
  if (state.recordingPauseStart !== null) {
    state.recordingPauseMs += performance.now() - state.recordingPauseStart;
  }
  state.recordingPauseStart = null;
  state.recordingState = 'recording';
  // Save current segment and start a new one to avoid straight-line artifact
  // across the pause gap in the exported GPX (each segment becomes a <trkseg>).
  if (state.trailPoints.length > 0) {
    state.trailSegments.push(state.trailPoints);
  }
  state.trailPoints = [];
  updateStatsBar(state);
}

function stopRecording(state: AppState, deactivatePolling: () => void): void {
  if (state.recordingState === 'idle') return;

  if (state.trailPoints.length > 0 || state.trailSegments.length > 0) {
    downloadGpx(state);
  }

  state.recordingState = 'idle';
  deactivatePolling(); // recording refcount

  clearTrailBackup();

  if (state.statsTimer !== null) {
    clearInterval(state.statsTimer);
    state.statsTimer = null;
  }
  setStatsBarVisible(false);
}

// ── GPX export ────────────────────────────────────────────────────────────────

/**
 * intent: Serialize the recorded trail to a GPX 1.1 XML string for download
 * method: Compute a single epoch offset (Date.now() - performance.now()) at call time; apply it to each performance.now() timestamp to get wall-clock ISO times
 * effect: All GPX timestamps are consistent relative to each other regardless of clock drift during the recording session
 */
function buildGpx(state: AppState): string {
  // tradeoff: epoch offset captured once per export, not per point — avoids per-point Date.now() calls and keeps timestamps monotonically consistent
  const epochOffset = Date.now() - performance.now();
  const startDate = new Date(epochOffset + state.recordingStartMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const trackName = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())} ${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`;

  // Collect all segments: completed segments from pause/resume + current active segment
  const allSegments = [...state.trailSegments];
  if (state.trailPoints.length > 0) {
    allSegments.push(state.trailPoints);
  }

  const formatPoint = ({ latlng, t, speedMs, altM }: { latlng: L.LatLng; t: number; speedMs: number; altM?: number }): string => {
    const pointTime = new Date(epochOffset + t).toISOString();
    const eleTag = altM !== undefined ? `<ele>${altM.toFixed(1)}</ele>` : '';
    const timeTag = `<time>${pointTime}</time>`;
    const speedTag =
      speedMs > 0
        ? `<extensions><speed>${speedMs.toFixed(4)}</speed></extensions>`
        : '';
    return (
      `      <trkpt lat="${latlng.lat.toFixed(7)}" lon="${latlng.lng.toFixed(7)}">` +
      `${eleTag}${timeTag}${speedTag}</trkpt>`
    );
  };

  const trksegs = allSegments
    .map((seg) => '    <trkseg>\n' + seg.map(formatPoint).join('\n') + '\n    </trkseg>')
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="webmap.dev"\n' +
    '     xmlns="http://www.topografix.com/GPX/1/1">\n' +
    '  <trk>\n' +
    `    <name>${trackName}</name>\n` +
    trksegs + '\n' +
    '  </trk>\n' +
    '</gpx>'
  );
}

function gpxFilename(state: AppState): string {
  const d = new Date(Date.now() - (performance.now() - state.recordingStartMs));
  const pad = (n: number): string => String(n).padStart(2, '0');
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  return `track-${year}-${month}-${day}-${hh}${mm}.gpx`;
}

function downloadGpx(state: AppState): void {
  const gpx = buildGpx(state);
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = gpxFilename(state);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revokeObjectURL to avoid race condition; download is initiated asynchronously
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ── Trail point appending (called from location.ts) ───────────────────────────

export function appendTrailPoint(
  latlng: L.LatLng,
  speedMs: number,
  state: AppState,
  map: L.Map,
  altM?: number,
): void {
  if (state.recordingState !== 'recording') return;

  state.lastSpeedMs = speedMs;

  if (state.lastTrailPoint !== null) {
    const dist = haversineM(state.lastTrailPoint, latlng);
    if (dist < MIN_TRAIL_DIST_M) return; // jitter filter
    state.totalDistance += dist;
  }

  state.trail?.addLatLng(latlng);
  state.trailGlow?.addLatLng(latlng);
  state.lastTrailPoint = latlng;
  state.trailPoints.push({ latlng, t: performance.now(), speedMs, altM });

  // Persist to localStorage so a page reload doesn't lose the in-progress trail
  saveTrailBackup(state);

  // Direction arrow: add between lastArrowPoint and current point when far enough apart
  if (state.lastArrowPoint !== null) {
    const arrowDist = haversineM(state.lastArrowPoint, latlng);
    if (arrowDist >= MIN_ARROW_DIST_M) {
      addArrowMarker(state.lastArrowPoint, latlng, state, map);
      state.lastArrowPoint = latlng;
    }
  } else {
    state.lastArrowPoint = latlng;
  }
}

function addArrowMarker(
  from: L.LatLng,
  to: L.LatLng,
  state: AppState,
  map: L.Map,
): void {
  const bearing = bearingDeg(from, to);
  const icon = L.divIcon({
    html: `<div class="trail-arrow" style="transform:rotate(${String(bearing)}deg)">▲</div>`,
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  const mid = L.latLng((from.lat + to.lat) / 2, (from.lng + to.lng) / 2);
  const marker = L.marker(mid, { icon, interactive: false }).addTo(map);
  state.arrowMarkers.push(marker);
}

// ── Trail backup restore (called from main.ts on startup) ─────────────────────

/**
 * Check for a persisted trail backup and, if found, prompt the user to restore it.
 * Restores recording state and redraws the trail on the map; starts the stats bar timer.
 * Returns true if a backup was applied, false otherwise.
 */
export function maybeRestoreTrailBackup(
  state: AppState,
  map: L.Map,
  activatePolling: () => void,
): boolean {
  const backup = loadTrailBackup();
  if (!backup) return false;

  const totalPoints =
    backup.trailPoints.length +
    backup.trailSegments.reduce((n, s) => n + s.length, 0);
  if (totalPoints === 0) {
    clearTrailBackup();
    return false;
  }

  // If the user already dismissed this backup on a previous page load, skip the prompt
  // without clearing the backup (preserves it in case the earlier dismiss was a
  // browser-suppressed confirm() rather than a genuine user cancel).
  if (isTrailBackupDismissed(backup.recordingStartWallMs)) {
    return false;
  }

  // window.confirm() is intentional here: it fires synchronously at app startup
  // before any recording state is live, so blocking the event loop is harmless.
  // The rest of the app uses showToast() for non-blocking feedback, but a restore
  // prompt must block initialization until the user decides — a toast action button
  // would require async startup machinery that isn't worth the complexity.
  //
  // Known limitation: some browsers (Firefox on Android, certain PWA installations on
  // Chromium) suppress confirm() without user interaction and silently return false.
  // To prevent silent discard in these cases, we do NOT call clearTrailBackup() on
  // cancel — the backup stays intact. Instead we write a dismissed marker keyed to this
  // backup's start time so the prompt won't re-appear on subsequent loads. If confirm()
  // was truly suppressed (not a genuine cancel), the marker won't match on a new
  // session's backup, so data from a new recording won't be silently skipped.
  if (!confirm(`Restore interrupted recording? (${totalPoints} GPS points recovered)`)) {
    dismissTrailBackup(backup.recordingStartWallMs);
    return false;
  }

  // Recreate polylines so applyTrailBackup can populate them
  state.trailGlow = L.polyline([], TRAIL_GLOW_OPTS).addTo(map);
  state.trail = L.polyline([], TRAIL_LINE_OPTS).addTo(map);

  applyTrailBackup(backup, state);
  state.recordingState = 'recording';

  activatePolling(); // recording refcount

  setStatsBarVisible(true);
  if (state.statsTimer !== null) clearInterval(state.statsTimer);
  state.statsTimer = setInterval(() => updateStatsBar(state), 1000);

  return true;
}
