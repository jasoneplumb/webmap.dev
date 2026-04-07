// Intent: GPS watch management — start/stop continuous location tracking
// Context: Uses Leaflet's map.locate({ watch: true }) which wraps the browser's
//          watchPosition API. A single call starts streaming locationfound events;
//          no polling timer needed.
import type L from 'leaflet';

export function startWatching(map: L.Map): void {
  map.locate({ watch: true, setView: false });
}

export function stopWatching(map: L.Map): void {
  map.stopLocate();
}
