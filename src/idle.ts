// Intent: Custom map idle event — Leaflet has no native idle event.
// Fires the callback once after `ms` of inactivity following a moveend,
// resetting if a new movestart arrives before the timeout expires.
// Use for debounced operations like reverse-geocoding on map pan.
import type L from 'leaflet';

export function addIdleListener(map: L.Map, callback: () => void, ms = 400): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function onMoveEnd(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(callback, ms);
  }

  function onMoveStart(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  map.on('moveend', onMoveEnd);
  map.on('movestart', onMoveStart);

  // Returns a cleanup function to remove the listeners
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    map.off('moveend', onMoveEnd);
    map.off('movestart', onMoveStart);
  };
}
