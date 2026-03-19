// Intent: Application entry point — wires all modules together
// Pattern: Single AppState object threaded through all modules by reference.
//          updateCallback is a refcount so locate and recording can independently
//          request/release the GPS polling loop without stepping on each other.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'esri-leaflet-geocoder/dist/esri-leaflet-geocoder.css';
import './style.css';

import { createInitialState } from './types';
import { createMap } from './map';
import { addClipboardControl, addLocateControl, updateLocateIcon } from './controls';
import { addSearchControl, addReverseGeocoding } from './geocoding';
import { initInfoPanel } from './bottom-sheet';
import { onLocationFound, onLocationError } from './location';
import { scheduleUpdateCallback, cancelUpdateCallback } from './timer';
import { createStatsBar, addRecordingControl } from './recording';

const state = createInitialState();
const map = createMap();

// Wire GPS location callbacks
map.on('locationfound', (e: L.LocationEvent) => onLocationFound(e, state, map));
map.on('locationerror', () => {
  onLocationError(state);
  showToast('GPS signal lost');
});

// Polling refcount helpers — shared by locate and recording
function activatePolling(): void {
  state.updateCallback += 1;
  if (state.updateCallback === 1) scheduleUpdateCallback(state, map);
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
  activatePolling();
  updateLocateIcon('active');
}

addLocateControl(map, () => {
  switch (state.locateState) {
    case 'off':
      // Check permission before prompting — gracefully degrade if denied
      if ('permissions' in navigator) {
        navigator.permissions
          .query({ name: 'geolocation' })
          .then((result) => {
            if (result.state === 'denied') {
              showToast('Location access is denied. Enable it in browser settings.');
            } else {
              startLocating();
            }
          })
          .catch(() => startLocating()); // permissions API unavailable — just try
      } else {
        startLocating();
      }
      break;

    case 'active':
      // Turn off: release locate's polling refcount
      state.locateState = 'off';
      deactivatePolling();
      updateLocateIcon('off');
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
