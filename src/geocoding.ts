// Intent: ESRI geocoding — throttled autocomplete search and reverse geocode via
//         double-click, right-click (desktop), and long-press (mobile)
// Context: geosearch provides the search UI; geocodeService powers reverse geocode.
//          Both use the VITE_ESRI_API_KEY env var for authentication.
//          contextmenu fires on right-click (desktop) and long-press (most mobile browsers).
//          Results are displayed in the bottom sheet (mobile) / side panel (desktop)
//          rather than Leaflet popups.
import L from 'leaflet';
import { geosearch, arcgisOnlineProvider, geocodeService } from 'esri-leaflet-geocoder';
import type { AppState } from './types';
import { showSheet } from './bottom-sheet';

// Escape text for safe insertion into innerHTML
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function addSearchControl(map: L.Map, state: AppState): void {
  // state is read in the results callback (for future extensibility)
  void state;

  const apikey = import.meta.env.VITE_ESRI_API_KEY;

  // Warn if API key is missing at startup
  if (!apikey) {
    console.warn(
      'VITE_ESRI_API_KEY is not configured. ' +
      'Search functionality will not work. ' +
      'Set VITE_ESRI_API_KEY in your .env file.'
    );
  }

  // Disable useMapBounds: at low zoom (initial map view), the visible bbox is the
  // entire world, causing ESRI to return no results. Instead, rely on ESRI's
  // location biasing which intelligently prioritizes results near the map center.
  const searchControl = geosearch({
    placeholder: '',
    title: 'Search for places or addresses',
    position: 'topleft',
    expanded: false,
    useMapBounds: false,
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

      // Add markers (no popup — info panel handles the UI)
      for (let i = data.results.length - 1; i >= 0; i--) {
        const result = data.results[i];
        if (result) {
          results.addLayer(L.marker(result.latlng));
        }
      }

      // Build results list for the info panel
      const itemsHtml = data.results
        .map((r) => {
          if (!r) return '';
          const name = escapeHtml(r.text);
          const lat = r.latlng.lat.toFixed(6);
          const lng = r.latlng.lng.toFixed(6);
          return (
            `<li class="sheet-result" data-lat="${lat}" data-lng="${lng}">` +
            `  <span class="sheet-result__name">${name}</span>` +
            `  <span class="sheet-result__arrow">&#x203A;</span>` +
            `</li>`
          );
        })
        .join('');

      const count = data.results.length;
      showSheet({
        title: escapeHtml(data.text),
        subtitle: count === 1 ? '1 result' : `${count} results`,
        bodyHtml: `<ul class="sheet-results">${itemsHtml}</ul>`,
      });

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

  // Initiate a clipboard write within the current user-gesture context.
  // Browsers gate navigator.clipboard on transient activation — by the time
  // the async geocode response arrives the gesture has expired, so writeText
  // fails silently. ClipboardItem accepts a Promise<Blob> that we resolve
  // once the address is known, capturing the gesture at write() time.
  function deferClipboardWrite(): ((text: string) => void) | undefined {
    if (!state.copyToClipboard) return undefined;
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return undefined;

    let resolveBlob: ((blob: Blob) => void) | undefined;
    const blobPromise = new Promise<Blob>((r) => { resolveBlob = r; });

    navigator.clipboard
      .write([new ClipboardItem({ 'text/plain': blobPromise })])
      .catch(() => {});

    return (text: string) => {
      resolveBlob?.(new Blob([text], { type: 'text/plain' }));
    };
  }

  function reverseGeocode(latlng: L.LatLng, resolveClipboard?: (text: string) => void): void {
    geocoder
      .reverse()
      .latlng(latlng)
      .run((error, result) => {
        if (error || !result) return;
        const addr = result.address.Match_addr;

        // Prefer the deferred write (initiated during user gesture) if available,
        // otherwise fall back to direct writeText (works in Chrome on HTTPS).
        if (resolveClipboard) {
          resolveClipboard(addr);
        } else if (state.copyToClipboard) {
          navigator.clipboard.writeText(addr).catch(() => {});
        }
        if (state.recordingState === 'idle') document.title = addr;

        // Format coordinates for display
        const lat = latlng.lat;
        const lng = latlng.lng;
        const latStr = `${Math.abs(lat).toFixed(6)}\u00b0\u00a0${lat >= 0 ? 'N' : 'S'}`;
        const lngStr = `${Math.abs(lng).toFixed(6)}\u00b0\u00a0${lng >= 0 ? 'E' : 'W'}`;
        const addrEsc = escapeHtml(addr);

        showSheet({
          title: addrEsc,
          subtitle: `${latStr},  ${lngStr}`,
          bodyHtml:
            `<div class="sheet-address">` +
            `  <div class="sheet-address__line">${addrEsc}</div>` +
            `  <div class="sheet-address__coords">${latStr} &nbsp; ${lngStr}</div>` +
            `</div>` +
            `<div class="sheet-actions">` +
            `  <button class="sheet-btn" data-copy="${escapeHtml(addr)}">Copy address</button>` +
            `</div>`,
        });
      });
  }

  function dropPin(latlng: L.LatLng): void {
    pinLayer.clearLayers();
    const pin = L.marker(latlng, { draggable: true });
    pinLayer.addLayer(pin);
    reverseGeocode(latlng, deferClipboardWrite());

    // Debounced reverse geocode as pin is dragged to a new location
    let dragDebounce: ReturnType<typeof setTimeout> | undefined;
    pin.on('dragend', () => {
      if (dragDebounce !== undefined) clearTimeout(dragDebounce);
      dragDebounce = setTimeout(() => {
        reverseGeocode(pin.getLatLng());
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
