// Intent: Application entry point — wires all modules together
// Pattern: Single AppState object threaded through all modules by reference.
//          updateCallback is a refcount so locate and recording can independently
//          request/release the GPS polling loop without stepping on each other.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet's default marker icon paths broken by Vite's asset pipeline
L.Icon.Default.mergeOptions({
  iconUrl: '/marker-icon.png',
  iconRetinaUrl: '/marker-icon-2x.png',
  shadowUrl: '/marker-shadow.png',
});
import 'esri-leaflet-geocoder/dist/esri-leaflet-geocoder.css';
import './style.css';

import { createInitialState } from './types';
import { createMap } from './map';
import { addClipboardControl, addLocateControl, updateLocateIcon } from './controls';
import { addSearchControl, addReverseGeocoding } from './geocoding';
import { initInfoPanel } from './bottom-sheet';
import { onLocationFound, onLocationError, clearLocationMarkers } from './location';
import { scheduleUpdateCallback, cancelUpdateCallback } from './timer';
import { createStatsBar, addRecordingControl, updateRecordingButtons } from './recording';

const state = createInitialState();
const map = createMap();

// Wire GPS location callbacks
map.on('locationfound', (e: L.LocationEvent) => onLocationFound(e, state, map));
map.on('locationerror', (e: L.ErrorEvent) => {
  // Leaflet error code 1 = PERMISSION_DENIED (browser or OS blocked access)
  // On iOS Safari the permissions API is unreliable, so this event is the
  // only trustworthy signal that location was actually denied.
  if (e.code === 1 && state.locateState !== 'off') {
    showToast('Location access is denied. Enable it in browser settings.');
    state.locateState = 'off';
    // Force-stop ALL polling regardless of refcount. Without this, an active
    // recording (refcount > 1) keeps the timer alive — timer fires map.locate()
    // every 500 ms, which re-triggers this error handler in an infinite loop.
    state.updateCallback = 0;
    cancelUpdateCallback(state, map);
    clearLocationMarkers(state, map);
    updateLocateIcon('off');
    updateRecordingButtons();
    return;
  }
  onLocationError(state);
  showToast('GPS signal lost');
});

// Polling refcount helpers — shared by locate and recording
function activatePolling(): void {
  state.updateCallback += 1;
  // Use a longer initial delay (3 s) so the immediate map.locate() call in
  // startLocating has time to resolve before the first poll cycle fires and
  // cancels it with map.stopLocate().  Subsequent activations (recording while
  // locate is already running) don't reach this branch, so their poll interval
  // is unaffected.
  if (state.updateCallback === 1) scheduleUpdateCallback(state, map, 3000);
}

function deactivatePolling(): void {
  state.prior = 1000;
  state.updateCallback -= 1;
  if (state.updateCallback === 0) cancelUpdateCallback(state, map);
}

// ── Toast ────────────────────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(message: string, durationMs = 3000): void {
  let toast = document.getElementById('locate-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'locate-toast';
    document.getElementById('map')?.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast?.classList.remove('visible');
    toastTimer = undefined;
  }, durationMs);
}

// ── Clipboard ────────────────────────────────────────────────────────────────

addClipboardControl(map, () => {
  state.copyToClipboard = !state.copyToClipboard;
  const img = document.getElementById('clip') as HTMLImageElement | null;
  if (img) {
    img.alt = img.title = state.copyToClipboard
      ? 'Copy dropped pin to clipboard (Enabled)'
      : 'Copy dropped pin to clipboard (Disabled)';
    img.src = state.copyToClipboard
      ? '/copy-pin-to-clipboard-color-v1.1.svg'
      : '/copy-pin-to-clipboard-lines-v1.1.svg';
  }
});

// ── Three-state locate button ─────────────────────────────────────────────────
// States: off → active (following) → passive (dot visible, not following)
// Pan while active automatically drops to passive.

function startLocating(): void {
  state.locateState = 'active';
  // Request location immediately within the user gesture so iOS Safari
  // shows the permission prompt (the gesture expires before the 500ms polling timer fires)
  map.locate({ setView: false, maxZoom: map.getZoom() });
  activatePolling();
  updateLocateIcon('active');
}

addLocateControl(map, () => {
  switch (state.locateState) {
    case 'off':
      // Start locating synchronously so map.locate() fires within the user
      // gesture — iOS Safari silently denies the permission prompt otherwise.
      startLocating();
      updateRecordingButtons();
      break;

    case 'active':
      // Turn off: release locate's polling refcount and remove location markers
      state.locateState = 'off';
      deactivatePolling();
      clearLocationMarkers(state, map);
      updateLocateIcon('off');
      updateRecordingButtons();
      break;

    case 'passive':
      // Re-center: fly to current position and resume following
      state.locateState = 'active';
      if (state.youAreHereLocation !== null) {
        map.flyTo(state.youAreHereLocation, map.getZoom(), { animate: true, duration: 0.8 });
      }
      updateLocateIcon('active');
      break;
  }
});

// Pan while following → drop to passive (map stays on user's panned position)
map.on('dragstart', () => {
  if (state.locateState === 'active') {
    state.locateState = 'passive';
    updateLocateIcon('passive');
  }
});

// ── Recording (trail with stats) ──────────────────────────────────────────────

createStatsBar();
addRecordingControl(map, state, activatePolling, deactivatePolling);

initInfoPanel(map);
addSearchControl(map, state);
addReverseGeocoding(map, state);

// ── Version badge ─────────────────────────────────────────────────────────────
const versionBadge = document.createElement('div');
versionBadge.id = 'version-badge';
versionBadge.textContent = `v${__APP_VERSION__}`;
document.getElementById('map')?.appendChild(versionBadge);

// Focus map for keyboard zoom shortcuts
document.getElementById('map')?.focus();
document.body.style.zoom = '100%';

// ── Offline detection ─────────────────────────────────────────────────────────
function updateOfflineBanner(): void {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  if (navigator.onLine) {
    banner.classList.remove('visible');
  } else {
    banner.classList.add('visible');
  }
}

window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);
updateOfflineBanner();

// ── PWA update — guard against reload during active recording ─────────────────
// registerType: 'prompt' prevents automatic reload; we apply the update only
// when it is safe to do so (i.e. no recording in progress).
import { registerSW } from 'virtual:pwa-register';

let pendingSwUpdate: (() => void) | null = null;

function applyUpdateWhenSafe(update: () => void): void {
  if (state.recordingState === 'idle') {
    update();
    return;
  }
  pendingSwUpdate = update;
  showToast('App update available — will apply after recording stops', 6000);
  const poll = setInterval(() => {
    if (state.recordingState === 'idle' && pendingSwUpdate !== null) {
      clearInterval(poll);
      const fn = pendingSwUpdate;
      pendingSwUpdate = null;
      fn();
    }
  }, 2000);
}

const updateSW = registerSW({
  onNeedRefresh() {
    applyUpdateWhenSafe(() => updateSW(true));
  },
});
