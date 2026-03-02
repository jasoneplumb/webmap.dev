// Intent: Application entry point — wires all modules together
// Pattern: Single AppState object threaded through all modules by reference.
//          updateCallback is a refcount so centering and tracking can independently
//          request/release the GPS polling loop without stepping on each other.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'esri-leaflet-geocoder/dist/esri-leaflet-geocoder.css';
import './style.css';

import { createInitialState } from './types';
import { createMap } from './map';
import { addClipboardControl, addCenteringControl, addTrackingControl } from './controls';
import { addSearchControl, addReverseGeocoding } from './geocoding';
import { onLocationFound } from './location';
import { scheduleUpdateCallback, cancelUpdateCallback } from './timer';

const state = createInitialState();
const map = createMap();

// Wire GPS location callback
map.on('locationfound', (e: L.LocationEvent) => onLocationFound(e, state, map));

// Polling refcount helpers — shared by centering and tracking
function activatePolling(): void {
  state.updateCallback += 1;
  if (state.updateCallback === 1) scheduleUpdateCallback(state, map);
}

function deactivatePolling(): void {
  state.prior = 1000;
  state.updateCallback -= 1;
  if (state.updateCallback === 0) cancelUpdateCallback(state, map);
}

// Clipboard: copy reverse-geocoded address to clipboard on pin drop
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

// Centering: keep map panned to current GPS position
addCenteringControl(map, () => {
  state.centering = !state.centering;
  if (state.centering) {
    activatePolling();
  } else {
    deactivatePolling();
    const img = document.getElementById('centering') as HTMLImageElement | null;
    if (img) {
      img.alt = img.title = 'Centering Toggle (Disabled)';
      img.src = '/centering-lines-v1.1.svg';
    }
  }
});

// Tracking: record GPS breadcrumb trail; also auto-enables centering on first activation
addTrackingControl(map, () => {
  state.tracking = !state.tracking;
  if (state.tracking) {
    if (state.initiateTracking) {
      // First-ever tracking activation: auto-enable centering too
      state.initiateTracking = false;
      document.title = 'You are here';
      state.centering = true;
      activatePolling(); // centering's refcount
    }
    activatePolling(); // tracking's refcount
  } else {
    deactivatePolling(); // tracking's refcount
    const img = document.getElementById('tracking') as HTMLImageElement | null;
    if (img) {
      img.alt = img.title = 'Tracking Toggle (Disabled)';
      img.src = '/logging-lines-v1.1.svg';
    }
  }
});

addSearchControl(map, state);
addReverseGeocoding(map, state);

// Focus map for keyboard zoom shortcuts
document.getElementById('map')?.focus();
document.body.style.zoom = '100%';
