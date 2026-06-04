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
import { onLocationFound, onLocationError, clearLocationMarkers } from './location';
import { startWatching, stopWatching } from './timer';
import { addOfflineDownloadControl } from './offline-download';
import { addGuidanceControl } from './guidance';
import { addCompassControl } from './compass';
import { initBattery } from './battery';
import { registerSW } from 'virtual:pwa-register';
import { scheduleSwUpdate } from './sw-update';

// Tell the index.html boot-watchdog the bundle loaded and is executing, so it
// cancels its reload timer. If the bundle ever fails to load (a stale service
// worker serving a 404'd chunk → blank page), this line never runs and the
// watchdog reloads once to recover.
(window as unknown as { __webmapBootOk?: () => void }).__webmapBootOk?.();

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
  void waitForConsent()
    .then(() => bootApp())
    .catch((err: unknown) => {
      console.error('[webmap] consent flow failed', err);
      // Only reload if consent wasn't recorded yet — avoids a reload loop if
      // initApp() itself threw after the user already accepted (next load will
      // skip straight to initApp() via the else branch with no catch needed).
      if (!hasConsent()) {
        location.reload();
      }
    });
} else {
  bootApp();
}

// Run initApp with a one-shot self-heal: if initialization throws (e.g. a stale
// service worker serving a shell/chunk hash mismatch right after a deploy),
// reload once to pick up a consistent asset set rather than leaving a blank
// page that the user has to reload manually. The sessionStorage guard prevents
// a reload loop if the failure is persistent (then the error surfaces instead).
function bootApp(): void {
  try {
    initApp();
    try { sessionStorage.removeItem('webmap-boot-retry'); } catch { /* sessionStorage unavailable */ }
  } catch (err: unknown) {
    console.error('[webmap] app initialization failed', err);
    let retried = false;
    try { retried = sessionStorage.getItem('webmap-boot-retry') === '1'; } catch { /* ignore */ }
    if (!retried) {
      try { sessionStorage.setItem('webmap-boot-retry', '1'); } catch { /* ignore */ }
      location.reload();
    }
  }
}

function initApp(): void {

// One-shot cleanup of localStorage keys written by the now-deleted recording feature.
// Harmless if absent.
try {
  localStorage.removeItem('webmap-trail-backup');
  localStorage.removeItem('webmap-trail-backup-dismissed');
} catch { /* localStorage unavailable */ }

const state = createInitialState();
const map = createMap();

// Wire GPS location callbacks
// iOS Safari sometimes fires a transient PERMISSION_DENIED (code 1) when
// watchPosition is first called, even when permission is already granted,
// before delivering the first fix. Debounce it: if locationfound arrives
// within 3s of the error, the error was spurious and we discard it.
let permissionDeniedTimer: ReturnType<typeof setTimeout> | undefined;

// Gates the GPS-status toast so it shows at most once per loss/acquisition
// episode rather than on every error tick. Reset to false on the next fix.
let gpsToastShown = false;

// Desktop acquisition guidance is deferred behind this timer: kCLErrorLocationUnknown
// (POSITION_UNAVAILABLE) is frequently transient, so wait for a grace period of
// continued failure before showing the (sticky) "enable Location Services" help.
let gpsHelpTimer: ReturnType<typeof setTimeout> | undefined;

// Hide the shared locate toast (clears a stale GPS message once a fix arrives).
function hideToast(): void {
  document.getElementById('locate-toast')?.classList.remove('visible');
}

function cancelPermissionDeniedTimer(): void {
  if (permissionDeniedTimer !== undefined) {
    clearTimeout(permissionDeniedTimer);
    permissionDeniedTimer = undefined;
  }
}

map.on('locationfound', (e: L.LocationEvent) => {
  cancelPermissionDeniedTimer();
  if (gpsHelpTimer !== undefined) { clearTimeout(gpsHelpTimer); gpsHelpTimer = undefined; }
  gpsToastShown = false; // signal recovered — allow a future loss to toast again
  hideToast();           // clear any "looking for GPS" / "signal lost" message
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
      showToast(
        /iPhone|iPad|iPod/.test(navigator.userAgent)
          ? 'Location access is denied. On iPhone: Settings > Privacy & Security > Location Services > Safari Websites > Allow'
          : 'Location access is blocked. Click the location (or site-info) icon in your browser’s address bar and set Location to Allow, then reload.',
        0,
      );
      state.locateState = 'off';
      // Force-stop ALL watching regardless of refcount.
      state.updateCallback = 0;
      stopWatching(map);
      clearLocationMarkers(state, map);
      updateLocateIcon('off');
    }, 3000);
    return;
  }
  onLocationError(state);
  if (state.locateState === 'off') return;

  if (state.locationMarker !== null) {
    // Already had a fix — a transient drop. One gentle toast per episode.
    if (!gpsToastShown) { gpsToastShown = true; showToast('GPS signal lost'); }
    return;
  }

  // Still acquiring (no fix yet).
  if (/iPhone|iPad|iPod|Android/.test(navigator.userAgent)) {
    if (!gpsToastShown) { gpsToastShown = true; showToast('Looking for GPS signal…'); }
    return;
  }

  // Desktop: POSITION_UNAVAILABLE (e.g. macOS kCLErrorLocationUnknown) is often
  // transient, so defer the sticky help until it persists. locationfound clears
  // this timer, so a quick recovery never nags.
  if (gpsHelpTimer === undefined) {
    gpsHelpTimer = setTimeout(() => {
      gpsHelpTimer = undefined;
      if (state.locationMarker !== null || state.locateState === 'off') return;
      showToast(
        'Can’t determine your location. Enable Location Services for your browser ' +
        '(Mac: System Settings → Privacy & Security → Location Services), then fully quit and reopen it.',
        0,
      );
    }, 12000);
  }
});

// Polling refcount helpers — shared by locate and recording
function activatePolling(): void {
  state.updateCallback += 1;
  if (import.meta.env.DEV && state.updateCallback > 2) {
    console.warn('[webmap] updateCallback > 2 — possible activatePolling() leak', state.updateCallback);
  }
  if (state.updateCallback === 1) startWatching(map);
}

function deactivatePolling(): void {
  state.prior = 1000;
  state.updateCallback -= 1;
  if (import.meta.env.DEV && state.updateCallback < 0) {
    console.warn('[webmap] updateCallback < 0 — possible deactivatePolling() leak', state.updateCallback);
  }
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
  // Zoom to the user on the next fix. Set on every off → active activation
  // (not just the session's first fix) so tapping locate always frames the
  // user at neighborhood zoom. passive → active uses reactivateLocate(), which
  // intentionally preserves the current zoom instead.
  state.initialZoom = true;
  activatePolling();
  updateLocateIcon('active');
}

function reactivateLocate(): void {
  state.locateState = 'active';
  if (state.youAreHereLocation !== null) {
    map.flyTo(state.youAreHereLocation, map.getZoom(), { animate: true, duration: 0.8 });
  }
  updateLocateIcon('active');
}

addLocateControl(map, () => {
  switch (state.locateState) {
    case 'off':
      // Start locating synchronously so map.locate() fires within the user
      // gesture — iOS Safari silently denies the permission prompt otherwise.
      startLocating();
      break;

    case 'active':
      // Turn off: release locate's polling refcount and remove location markers
      state.locateState = 'off';
      deactivatePolling();
      clearLocationMarkers(state, map);
      updateLocateIcon('off');
      break;

    case 'passive':
      reactivateLocate();
      break;
  }
});
startLocating();

// Drag and wheel-zoom move the view off the user's position; button-zoom is deliberate so it keeps active.
function dropToPassive(showTouchHint: boolean): void {
  if (state.locateState !== 'active') return;
  state.locateState = 'passive';
  updateLocateIcon('passive');

  if (showTouchHint && navigator.maxTouchPoints > 0 && !sessionStorage.getItem('locate-hint-shown')) {
    sessionStorage.setItem('locate-hint-shown', '1');
    showToast('Double-tap map to re-center', 2500);
  }

  const locateImg = document.getElementById('locate');
  if (locateImg) {
    locateImg.classList.remove('locate-passive-pulse');
    // Force reflow so re-adding the class restarts the animation
    void locateImg.offsetWidth;
    locateImg.classList.add('locate-passive-pulse');
    locateImg.addEventListener('animationend', () => {
      locateImg.classList.remove('locate-passive-pulse');
    }, { once: true });
  }
}

map.on('dragstart', () => dropToPassive(true));
// passive: true — we observe only; Leaflet owns wheel-zoom mechanics.
map.getContainer().addEventListener('wheel', () => dropToPassive(false), { passive: true });

// Double-tap on the map re-activates locate (mobile) — when the user has panned
// away (active → passive), a double-tap snaps back to their position without
// requiring them to reach the locate button.
// Intercepted at capture phase so e.preventDefault() suppresses the browser's
// synthesized dblclick event (which would zoom instead of re-centering).
{
  let lastTouchEnd = 0;
  map.getContainer().addEventListener('touchend', (e: TouchEvent) => {
    if (e.touches.length !== 0 || e.changedTouches.length !== 1) return; // multi-touch
    const now = Date.now();
    if (state.locateState === 'passive' && now - lastTouchEnd < 300) {
      e.preventDefault(); // suppress synthesized dblclick → prevents zoom-in
      reactivateLocate();
      lastTouchEnd = 0;   // reset so a third tap starts a fresh sequence
    } else {
      lastTouchEnd = now;
    }
  }, { capture: true, passive: false });
}

// Initialize custom layers control with free OSM tile sources
const tileLayers = getTileLayers();

const layerDefs: LayerDef[] = [
  {
    id: 'cycle',
    name: 'Cycle',
    description: 'Bike routes & cycling map (OpenCycleMap)',
    tileLayer: tileLayers.cycleLayer,
  },
  {
    id: 'outdoors',
    name: 'Outdoors',
    description: 'Hiking trails & terrain',
    tileLayer: tileLayers.outdoorsLayer,
  },
  {
    id: 'osm-streets',
    name: 'Streets',
    description: 'Street map with roads and labels',
    tileLayer: tileLayers.osmStreetsLayer,
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
  {
    id: 'hiking-routes',
    name: 'Hiking routes',
    tileLayer: tileLayers.hikingLayer,
  },
  {
    id: 'cycling-routes',
    name: 'Cycling routes',
    tileLayer: tileLayers.cyclingLayer,
  },
];

addLayersControl(map, layerDefs, overlayDefs, ['hillshade', 'hiking-routes', 'cycling-routes']);

addOfflineDownloadControl(map, showToast);
addSearchControl(map, state, showToast);
addReverseGeocoding(map, state, showToast);
addGuidanceControl(map, state, activatePolling, deactivatePolling);
addCompassControl(map, state);

// ── Version badge + changelog panel ───────────────────────────────────────────
const versionBadge = document.createElement('button');
versionBadge.id = 'version-badge';
versionBadge.textContent = `v${__APP_VERSION__}`;
versionBadge.setAttribute('aria-expanded', 'false');
versionBadge.setAttribute('aria-controls', 'changelog-panel');
// Append to the bottom-left Leaflet cluster so the badge stacks naturally
// with scale + zoom rather than living as an absolute-positioned overlay.
// The cluster is guaranteed to exist here because createMap() registers
// scale + zoom at bottomleft before this code runs; throw loudly rather
// than silently fall back if that invariant ever breaks.
const bottomLeftCluster = document.querySelector('.leaflet-bottom.leaflet-left');
if (!bottomLeftCluster) {
  throw new Error('version-badge: .leaflet-bottom.leaflet-left not found — createMap() must register a bottomleft control before main.ts wires the badge');
}
bottomLeftCluster.appendChild(versionBadge);

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
  }
});

// ── Battery monitoring ────────────────────────────────────────────────────────
initBattery(state);

// Note: vite-plugin-pwa also exposes onOfflineReady for first-install caching.
// Not wired here — silent first-install caching is acceptable.
const updateSW = registerSW({
  onNeedRefresh() {
    // Apply the update only after the page is visible AND a real paint has
    // happened — otherwise workbox-window's reload races first paint and leaves
    // a blank page (the user then has to reload manually). scheduleSwUpdate owns
    // the visibility + post-paint gating so the logic stays unit-testable.
    scheduleSwUpdate({
      isHidden: () => document.hidden,
      onVisible: (cb) => {
        const onChange = (): void => {
          if (document.hidden) return;
          document.removeEventListener('visibilitychange', onChange);
          cb();
        };
        document.addEventListener('visibilitychange', onChange);
      },
      raf: (cb) => requestAnimationFrame(cb),
      apply: () => { updateSW(true); },
    });
  },
});

} // end initApp
