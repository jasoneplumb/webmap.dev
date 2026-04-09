/**
 * Intent: GPS watch management — start/stop continuous location tracking
 * Context: Called by main.ts refcount logic; each activate increments the refcount, each deactivate decrements — watch starts at 1, stops at 0
 * Pattern: Thin wrapper over Leaflet's map.locate({ watch: true }), which itself wraps the browser watchPosition API; no polling timer needed
 * Future: No accuracy timeout or stale-fix detection; a fix could be cached and never refresh on some devices
 */
import type L from 'leaflet';

export function startWatching(map: L.Map): void {
  map.locate({ watch: true, setView: false });
}

export function stopWatching(map: L.Map): void {
  map.stopLocate();
}
