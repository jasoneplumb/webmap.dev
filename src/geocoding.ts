// Intent: ESRI geocoding — throttled autocomplete search and reverse geocode via
//         double-click, right-click (desktop), and long-press (mobile)
// Context: geosearch provides the search UI; geocodeService powers reverse geocode.
//          Both use the VITE_ESRI_API_KEY env var for authentication.
//          contextmenu fires on right-click (desktop) and long-press (most mobile browsers).
import L from 'leaflet';
import { geosearch, arcgisOnlineProvider, geocodeService } from 'esri-leaflet-geocoder';
import type { AppState } from './types';

export function addSearchControl(map: L.Map, state: AppState): void {
  // state is read in the results callback (for future extensibility)
  void state;

  const apikey = import.meta.env.VITE_ESRI_API_KEY;
  const searchControl = geosearch({
    placeholder: '',
    title: 'Search for places or addresses within visible region',
    position: 'topleft',
    expanded: false,
    useMapBounds: true,
    zoomToResult: false,
    minCharacters: 3,
    debounceDelay: 250,
    providers: [arcgisOnlineProvider({ maxResults: 15, apikey })],
  });
  searchControl.addTo(map);

  const results = L.layerGroup().addTo(map);
  searchControl.on('results', (data) => {
    results.clearLayers();
    if (data.results.length) {
      document.title = data.text;
      for (let i = data.results.length - 1; i >= 0; i--) {
        const result = data.results[i];
        if (result) {
          results.addLayer(L.marker(result.latlng).bindPopup(result.text).openPopup());
        }
      }
      // Smooth flyTo animation to the first result
      const firstResult = data.results[0];
      if (firstResult) {
        map.flyTo(firstResult.latlng, Math.max(map.getZoom(), 13), {
          animate: true,
          duration: 1.5,
          easeLinearity: 0.25,
        });
      }
    }
  });
}

export function addReverseGeocoding(map: L.Map, state: AppState): void {
  const apikey = import.meta.env.VITE_ESRI_API_KEY;
  const geocoder = geocodeService({ apikey });
  const pinLayer = L.layerGroup().addTo(map);

  // Disable double-click zoom so dblclick can drop a pin instead
  map.doubleClickZoom.disable();

  function reverseGeocode(pin: L.Marker, latlng: L.LatLng): void {
    geocoder
      .reverse()
      .latlng(latlng)
      .run((error, result) => {
        if (error || !result) return;
        const addr = result.address.Match_addr;
        const coords = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
        if (state.copyToClipboard) {
          navigator.clipboard
            .writeText(addr)
            .catch((err: unknown) => {
              alert(String(err));
            });
        }
        if (!state.tracking) document.title = addr;
        pin.bindPopup(`<strong>${addr}</strong><br><small>${coords}</small>`).openPopup();
      });
  }

  function dropPin(latlng: L.LatLng): void {
    pinLayer.clearLayers();
    const pin = L.marker(latlng, { draggable: true });
    pinLayer.addLayer(pin);
    reverseGeocode(pin, latlng);

    // Debounced reverse geocode as pin is dragged to a new location
    let dragDebounce: ReturnType<typeof setTimeout> | undefined;
    pin.on('dragend', () => {
      if (dragDebounce !== undefined) clearTimeout(dragDebounce);
      dragDebounce = setTimeout(() => {
        reverseGeocode(pin, pin.getLatLng());
      }, 300);
    });
  }

  // Double-click: drop pin (existing behavior)
  map.on('dblclick', (e: L.LeafletMouseEvent) => {
    dropPin(e.latlng);
  });

  // Right-click (desktop) and long-press (mobile) both fire contextmenu
  map.on('contextmenu', (e: L.LeafletMouseEvent) => {
    dropPin(e.latlng);
  });
}
