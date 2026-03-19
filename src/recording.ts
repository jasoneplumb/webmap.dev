// Intent: Track recording state machine, trail visualization, and real-time stats overlay
// Pattern: Plugs into AppState; exposes initRecording for main.ts wiring and
//          appendTrailPoint for location.ts to call on each GPS fix.
import L from 'leaflet';
import type { AppState } from './types';

const MIN_TRAIL_DIST_M = 5;   // minimum metres between trail points (GPS jitter filter)
const MIN_ARROW_DIST_M = 50;  // minimum metres between direction-arrow markers

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

function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function formatSpeed(ms: number): string {
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
    '<span class="stat-value" id="stat-speed">-- km/h</span>' +
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

  // Glow layer beneath the main trail line
  state.trailGlow = L.polyline([], {
    color: 'rgba(66,135,245,0.25)',
    weight: 14,
    smoothFactor: 2,
    interactive: false,
  }).addTo(map);

  // Main trail line
  state.trail = L.polyline([], {
    color: '#4287f5',
    weight: 4,
    smoothFactor: 2,
    interactive: false,
  }).addTo(map);

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
  updateStatsBar(state);
}

function stopRecording(state: AppState, deactivatePolling: () => void): void {
  if (state.recordingState === 'idle') return;
  state.recordingState = 'idle';
  deactivatePolling(); // recording refcount

  if (state.statsTimer !== null) {
    clearInterval(state.statsTimer);
    state.statsTimer = null;
  }
  setStatsBarVisible(false);
}

// ── Trail point appending (called from location.ts) ───────────────────────────

export function appendTrailPoint(
  latlng: L.LatLng,
  speedMs: number,
  state: AppState,
  map: L.Map,
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
