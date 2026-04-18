/**
 * Intent: Application entry point — wires all modules together and owns the GPS watch refcount
 * Context: Browser entry point; imports all feature modules and passes AppState + map by reference; no framework
 * Pattern: Single AppState object threaded through all modules; updateCallback refcount lets locate and recording independently request/release GPS watching without stepping on each other
 * Future: Refcount pattern breaks silently if any module activates without a matching deactivate (e.g., on error path) — no guard or assertion currently exists
 */
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
import changelogRaw from '../CHANGELOG.md?raw';

import { hasConsent, showConsentModal } from './consent';
import { createInitialState } from './types';
import { createMap, initOfflineTileFallback, getTileLayers } from './map';
import { addLayersControl, type LayerDef, type OverlayDef } from './layers-control';
import { addLocateControl, updateLocateIcon } from './controls';
import { addSearchControl, addReverseGeocoding } from './geocoding';
import { initInfoPanel } from './bottom-sheet';
import { onLocationFound, onLocationError, clearLocationMarkers } from './location';
import { startWatching, stopWatching } from './timer';
import { createStatsBar, addRecordingControl, updateRecordingButtons, maybeRestoreTrailBackup } from './recording';
import { addOfflineDownloadControl } from './offline-download';
import { initBattery } from './battery';
import { registerSW } from 'virtual:pwa-register';

// ── Consent gate — block all interaction until terms are accepted ─────────────
if (!hasConsent()) {
  // Show modal immediately; re-show on decline (user cannot bypass)
  const waitForConsent = async (): Promise<void> => {
    let accepted = false;
    while (!accepted) {
      accepted = await showConsentModal();
    }
  };
  // The top-level await alternative requires ESM module output; use an async
  // IIFE that delays the rest of init until consent is granted.  The import
  // side-effects above (CSS, Leaflet icon config) are harmless before consent.
  void waitForConsent().then(() => initApp());
} else {
  initApp();
}

function initApp(): void {

const state = createInitialState();
const map = createMap();

// Wire GPS location callbacks
// iOS Safari sometimes fires a transient PERMISSION_DENIED (code 1) when
// watchPosition is first called, even when permission is already granted,
// before delivering the first fix. Debounce it: if locationfound arrives
// within 3s of the error, the error was spurious and we discard it.
let permissionDeniedTimer: ReturnType<typeof setTimeout> | undefined;

function cancelPermissionDeniedTimer(): void {
  if (permissionDeniedTimer !== undefined) {
    clearTimeout(permissionDeniedTimer);
    permissionDeniedTimer = undefined;
  }
}

map.on('locationfound', (e: L.LocationEvent) => {
  cancelPermissionDeniedTimer();
  onLocationFound(e, state, map);
});
map.on('locationerror', (e: L.ErrorEvent) => {
  // Leaflet error code 1 = PERMISSION_DENIED (browser or OS blocked access)
  // On iOS Safari the permissions API is unreliable, so this event is the
  // only trustworthy signal that location was actually denied.
  if (e.code === 1 && state.locateState !== 'off') {
    // Defer acting on the denial — if a fix arrives first, this was spurious.
    cancelPermissionDeniedTimer();
    permissionDeniedTimer = setTimeout(() => {
      permissionDeniedTimer = undefined;
      if (state.locateState === 'off') return; // already handled
      showToast('Location access is denied. On iPhone: Settings > Privacy & Security > Location Services > Safari Websites > Allow', 0);
      state.locateState = 'off';
      // Force-stop ALL watching regardless of refcount. Without this, an active
      // recording (refcount > 1) keeps the watch alive, which re-triggers this
      // error handler in an infinite loop.
      state.updateCallback = 0;
      stopWatching(map);
      clearLocationMarkers(state, map);
      updateLocateIcon('off');
      updateRecordingButtons();
    }, 3000);
    return;
  }
  onLocationError(state);
  showToast('GPS signal lost');
});

// Polling refcount helpers — shared by locate and recording
function activatePolling(): void {
  state.updateCallback += 1;
  if (state.updateCallback === 1) startWatching(map);
}

function deactivatePolling(): void {
  state.prior = 1000;
  state.updateCallback -= 1;
  if (state.updateCallback === 0) stopWatching(map);
}

// ── Toast ────────────────────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | undefined;

// durationMs = 0 → sticky: persists until the user taps ×
function showToast(message: string, durationMs = 3000): void {
  let toast = document.getElementById('locate-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'locate-toast';
    document.getElementById('map')?.appendChild(toast);
  }
  if (toastTimer !== undefined) {
    clearTimeout(toastTimer);
    toastTimer = undefined;
  }
  toast.classList.remove('dismissible');
  toast.innerHTML = '';

  if (durationMs === 0) {
    toast.classList.add('dismissible');
    const span = document.createElement('span');
    span.textContent = message;
    const btn = document.createElement('button');
    btn.className = 'toast-close';
    btn.setAttribute('aria-label', 'Dismiss');
    btn.textContent = '×';
    btn.addEventListener('click', () => {
      toast?.classList.remove('visible', 'dismissible');
    });
    toast.appendChild(span);
    toast.appendChild(btn);
  } else {
    toast.textContent = message;
    toastTimer = setTimeout(() => {
      toast?.classList.remove('visible');
      toastTimer = undefined;
    }, durationMs);
  }

  toast.classList.add('visible');
}

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

// Offer to restore an interrupted trail if a backup exists in localStorage
if (maybeRestoreTrailBackup(state, map, activatePolling)) {
  updateRecordingButtons();
}


// Initialize custom layers control with free OSM tile sources
const tileLayers = getTileLayers();

const layerDefs: LayerDef[] = [
  {
    id: 'cyclosm',
    name: 'Trails',
    description: 'Emphasizes hiking and cycling routes',
    tileLayer: tileLayers.cyclosmLayer,
  },
  {
    id: 'osm-streets',
    name: 'Streets',
    description: 'Street map with roads and labels',
    tileLayer: tileLayers.osmStreetsLayer,
  },
  {
    id: 'topo',
    name: 'Topographic',
    description: 'Contour lines and hillshade',
    tileLayer: tileLayers.opentopoLayer,
  },
  {
    id: 'parks',
    name: 'Parks & POIs',
    description: 'Highlights parks and amenities',
    tileLayer: tileLayers.humanitarianLayer,
  },
];

const overlayDefs: OverlayDef[] = [
  {
    id: 'hillshade',
    name: 'Hillshade',
    tileLayer: tileLayers.hillshadeLayer,
  },
];

addLayersControl(map, layerDefs, overlayDefs, ['hillshade']);

initInfoPanel(map);
addOfflineDownloadControl(map, showToast);
addSearchControl(map, state, showToast);
addReverseGeocoding(map, state);

// ── Version badge + changelog panel ───────────────────────────────────────────
const versionBadge = document.createElement('button');
versionBadge.id = 'version-badge';
versionBadge.textContent = `v${__APP_VERSION__}`;
versionBadge.setAttribute('aria-expanded', 'false');
versionBadge.setAttribute('aria-controls', 'changelog-panel');
document.getElementById('map')?.appendChild(versionBadge);

const changelogPanel = document.createElement('div');
changelogPanel.id = 'changelog-panel';
changelogPanel.setAttribute('role', 'dialog');
changelogPanel.setAttribute('aria-label', 'Changelog');
changelogPanel.setAttribute('aria-hidden', 'true');

function renderChangelog(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .split('\n')
    .map(line => {
      if (/^## /.test(line)) return `<h2>${line.slice(3)}</h2>`;
      if (/^### /.test(line)) return `<h3>${line.slice(4)}</h3>`;
      if (/^- /.test(line)) {
        return `<li>${line.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</li>`;
      }
      if (line.trim() === '') return '<br>';
      return `<p>${line}</p>`;
    })
    .join('');
}

changelogPanel.innerHTML = `<div id="changelog-panel__inner"><button id="changelog-panel__close" aria-label="Close changelog">✕</button><div id="changelog-panel__body">${renderChangelog(changelogRaw)}</div></div>`;
document.getElementById('map')?.appendChild(changelogPanel);

function openChangelog(): void {
  changelogPanel.classList.add('visible');
  changelogPanel.setAttribute('aria-hidden', 'false');
  versionBadge.setAttribute('aria-expanded', 'true');
}
function closeChangelog(): void {
  changelogPanel.classList.remove('visible');
  changelogPanel.setAttribute('aria-hidden', 'true');
  versionBadge.setAttribute('aria-expanded', 'false');
}

versionBadge.addEventListener('click', () => {
  if (changelogPanel.classList.contains('visible')) closeChangelog();
  else openChangelog();
});
document.getElementById('changelog-panel__close')?.addEventListener('click', closeChangelog);
changelogPanel.addEventListener('click', (e) => {
  if (e.target === changelogPanel) closeChangelog();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && changelogPanel.classList.contains('visible')) closeChangelog();
});

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

initOfflineTileFallback(showToast);

// ── Screen-off optimization ───────────────────────────────────────────────────
// Suppress map rendering and UI updates when screen is off during recording
// to reduce CPU/GPU work. GPS data is still processed for trail recording.
document.addEventListener('visibilitychange', () => {
  state.screenOff = document.hidden;
  // When screen comes back on, re-render latest state to catch up
  if (!document.hidden) {
    if (state.locationMarker !== null && state.youAreHereLocation !== null) {
      state.locationMarker.setLatLng(state.youAreHereLocation);
    }
    if (state.accuracyCircle !== null && state.youAreHereLocation !== null && state.lastGpsAccuracy !== null) {
      state.accuracyCircle.setLatLng(state.youAreHereLocation);
      state.accuracyCircle.setRadius(state.lastGpsAccuracy);
    }
    updateLocateIcon(state.locateState);
    // keepalive is non-null iff recording or paused — reacquire in both cases
    state.keepalive?.reacquireWakeLock().catch(() => undefined);
  }
});

// ── Battery monitoring ────────────────────────────────────────────────────────
initBattery(state);

let pendingSwUpdate: (() => void) | null = null;

function applyUpdateWhenSafe(update: () => void): void {
  // Apply immediately if idle; defer if recording or paused (paused !== idle)
  if (state.recordingState === 'idle') {
    update();
    return;
  }
  if (pendingSwUpdate !== null) return; // already waiting for recording to finish
  pendingSwUpdate = update;
  showToast('App update available — will apply after recording stops', 6000);
  const poll = setInterval(() => {
    if (state.recordingState === 'idle' && pendingSwUpdate !== null) {
      clearInterval(poll);
      const fn = pendingSwUpdate;
      pendingSwUpdate = null;
      showToast('Recording saved — applying app update…', 2000);
      setTimeout(fn, 1500); // brief pause so user sees the toast
    }
  }, 2000);
}

// Note: vite-plugin-pwa also exposes onOfflineReady for first-install caching.
// Not wired here — silent first-install caching is acceptable.
const updateSW = registerSW({
  onNeedRefresh() {
    applyUpdateWhenSafe(() => updateSW(true));
  },
});

} // end initApp
