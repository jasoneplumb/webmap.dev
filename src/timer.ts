/**
 * Intent: GPS watch management with adaptive accuracy to save battery
 * Context: Called by main.ts refcount logic; supports switching between high/low accuracy based on motion state
 * Pattern: Wraps Leaflet's map.locate({ watch: true }) with accuracy toggling — high accuracy uses GPS hardware (power hungry), low accuracy uses WiFi/cell (power efficient)
 */
import type L from 'leaflet';

let highAccuracy = true;

export function startWatching(map: L.Map): void {
  highAccuracy = true;
  map.locate({ watch: true, setView: false, enableHighAccuracy: true });
}

export function stopWatching(map: L.Map): void {
  map.stopLocate();
}

/**
 * Switch between high/low GPS accuracy to save battery when stationary.
 * High accuracy uses GPS hardware (power-hungry); low accuracy uses WiFi/cell (efficient).
 * Restarts the watch with new settings — brief gap between fixes is acceptable.
 */
export function setWatchAccuracy(map: L.Map, high: boolean): void {
  if (high === highAccuracy) return;
  highAccuracy = high;
  map.stopLocate();
  map.locate({
    watch: true,
    setView: false,
    enableHighAccuracy: high,
    maximumAge: high ? 0 : 5000,
  });
}

export function isHighAccuracy(): boolean {
  return highAccuracy;
}
