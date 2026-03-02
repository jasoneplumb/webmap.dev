// Intent: ESRI geocoding — search bar and reverse geocode on double-click
// Context: geosearch provides the search UI; geocodeService powers the dblclick pin drop.
//          Both use the VITE_ESRI_API_KEY env var for authentication.
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
    providers: [arcgisOnlineProvider({ maxResults: 15, apikey })],
  });
  searchControl.addTo(map);

  const results = L.layerGroup().addTo(map);
  searchControl.on('results', (data) => {
    console.log(data.text);
    results.clearLayers();
    if (data.results.length) {
      document.title = data.text;
      for (let i = data.results.length - 1; i >= 0; i--) {
        const result = data.results[i];
        if (result) {
          results.addLayer(L.marker(result.latlng).bindPopup(result.text).openPopup());
        }
      }
      // Keep current map bounds — fitBounds to results was originally commented out
      map.fitBounds(map.getBounds());
    }
  });
}

export function addReverseGeocoding(map: L.Map, state: AppState): void {
  const apikey = import.meta.env.VITE_ESRI_API_KEY;
  const geocoder = geocodeService({ apikey });
  const point = L.layerGroup().addTo(map);

  // Disable double-click zoom so dblclick can drop a pin instead
  map.doubleClickZoom.disable();

  map.on('dblclick', (e: L.LeafletMouseEvent) => {
    geocoder
      .reverse()
      .latlng(e.latlng)
      .run((error, result) => {
        if (error || !result) return;
        if (state.copyToClipboard) {
          navigator.clipboard
            .writeText(result.address.Match_addr)
            .catch((err: unknown) => {
              alert(String(err));
            });
        }
        if (!state.tracking) document.title = result.address.Match_addr;
        point.clearLayers(); // one pin at a time
        point.addLayer(
          L.marker(result.latlng).bindPopup(result.address.Match_addr).openPopup(),
        );
      });
  });
}
