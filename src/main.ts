// Intent: Application entry point — wires all modules together
// Pattern: Single AppState object threaded through all modules by reference.
//          updateCallback is a refcount so centering and recording can independently
//          request/release the GPS polling loop without stepping on each other.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'esri-leaflet-geocoder/dist/esri-leaflet-geocoder.css';
import './style.css';

import { createInitialState } from './types';
import { createMap } from './map';
import { addClipboardControl, addCenteringControl } from './controls';
import { addSearchControl, addReverseGeocoding } from './geocoding';
import { initInfoPanel } from './bottom-sheet';
import { onLocationFound } from './location';
import { scheduleUpdateCallback, cancelUpdateCallback } from './timer';
import { createStatsBar, addRecordingControl } from './recording';

const state = createInitialState();
const map = createMap();

// Wire GPS location callback
map.on('locationfound', (e: L.LocationEvent) => onLocationFound(e, state, map));

// Polling refcount helpers — shared by centering and recording
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

// Recording: Start/Pause/Resume/Stop state machine with real-time stats and styled trail
createStatsBar();
addRecordingControl(map, state, activatePolling, deactivatePolling);

initInfoPanel(map);
addSearchControl(map, state);
addReverseGeocoding(map, state);

// Focus map for keyboard zoom shortcuts
document.getElementById('map')?.focus();
document.body.style.zoom = '100%';
