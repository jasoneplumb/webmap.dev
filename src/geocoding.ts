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
  //
  // collapseAfterResult: false — prevents clear() from collapsing the control
  // immediately when Enter is pressed (before results arrive). We handle collapse
  // ourselves in the results handler and on blur.
  const searchControl = geosearch({
    placeholder: '',
    title: 'Search for places or addresses',
    position: 'topleft',
    expanded: false,
    useMapBounds: false,
    zoomToResult: false,
    collapseAfterResult: false,
    minCharacters: 3,
    debounceDelay: 250,
    providers: [arcgisOnlineProvider({ maxResults: 15, apikey })],
  });
  searchControl.addTo(map);

  // Grab internal DOM refs (created in onAdd, so must come after addTo).
  const input = (searchControl as unknown as { _input: HTMLInputElement })._input;
  const wrapper = (searchControl as unknown as { _wrapper: HTMLElement })._wrapper;

  // Fix: patch each provider's results() and suggest() so that on error they
  // call back with an empty array instead of propagating. Without this,
  // GeosearchCore never fires the completion event on failure and the spinner
  // stays indefinitely. Both methods must be patched: suggest() drives the
  // autocomplete spinner on each keystroke; results() drives the Enter/select path.
  const core = (searchControl as unknown as { _geosearchCore: { _providers: unknown[] } })._geosearchCore;
  for (const provider of core._providers) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = provider as any;
    for (const method of ['results', 'suggest'] as const) {
      if (typeof p[method] !== 'function') continue;
      const orig = p[method].bind(p) as (
        text: unknown, key: unknown, bounds: unknown,
        cb: (err: null, results: unknown[]) => void,
      ) => unknown;
      p[method] = function (
        text: unknown, key: unknown, bounds: unknown,
        cb: (err: null, results: unknown[]) => void,
      ): unknown {
        return orig(text, key, bounds, (error: unknown, results: unknown[]) => {
          cb(null, error ? [] : results);
        });
      };
    }
  }

  // Collapse the search control and clear the input — called after results arrive
  // or when the input loses focus.
  function collapseSearch(): void {
    input.value = '';
    (searchControl as unknown as { _lastValue: string })._lastValue = '';
    input.placeholder = '';
    L.DomUtil.removeClass(wrapper, 'geocoder-control-expanded');
  }

  // Fix: track whether a search is in flight so blur (which fires on Enter
  // keydown) does not collapse the control before results arrive.
  let pendingSearch = false;

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      // Only mark search as pending if input meets the minimum length threshold.
      // If it doesn't, no request is dispatched and the results handler never fires,
      // which would leave pendingSearch stuck true and prevent future blur-collapses.
      if (input.value.length >= 3) pendingSearch = true;
    } else if (e.key === 'Escape') {
      // Cancel in-flight guard and collapse immediately.
      pendingSearch = false;
      collapseSearch();
    }
  });

  // Collapse on blur so clicking away from the field still hides it. Use a
  // short timeout so a mousedown on a suggestion item fires first (matching the
  // existing library behaviour for suggestion clicks). Skip collapse entirely
  // if a search is in flight — the results handler will collapse when done.
  input.addEventListener('blur', () => {
    if (pendingSearch) return;
    setTimeout(collapseSearch, 150);
  });

  const results = L.layerGroup().addTo(map);
  searchControl.on('results', (data) => {
    // Search complete — clear pending flag, remove loading spinner, and collapse.
    pendingSearch = false;
    L.DomUtil.removeClass(wrapper, 'geocoder-control-loading');
    collapseSearch();
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

  function reverseGeocode(latlng: L.LatLng): void {
    geocoder
      .reverse()
      .latlng(latlng)
      .run((error, result) => {
        if (error || !result) return;
        const addr = result.address.Match_addr;

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

    // Copy coordinates to clipboard immediately within the user gesture.
    // The address (resolved async via geocode) can be copied from the info
    // sheet's "Copy address" button which provides its own user gesture.
    if (state.copyToClipboard) {
      const coords = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
      navigator.clipboard.writeText(coords).catch(() => {});
    }

    reverseGeocode(latlng);

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

  // iOS Safari long-press fallback: contextmenu fires inconsistently on iOS,
  // so we implement our own long-press via touch events. If the touch holds for
  // 500ms without moving more than ~10px and contextmenu has not already fired
  // (to avoid double-drop on browsers that do support it), drop a pin.
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressStartX = 0;
  let longPressStartY = 0;
  let contextmenuFired = false;

  map.on('contextmenu', () => {
    contextmenuFired = true;
    if (longPressTimer !== undefined) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  });

  const mapContainer = map.getContainer();
  mapContainer.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    contextmenuFired = false;
    const touch = e.touches[0];
    if (!touch) return;
    longPressStartX = touch.clientX;
    longPressStartY = touch.clientY;
    longPressTimer = setTimeout(() => {
      longPressTimer = undefined;
      if (contextmenuFired) return;
      const mapRect = mapContainer.getBoundingClientRect();
      const point = L.point(longPressStartX - mapRect.left, longPressStartY - mapRect.top);
      const latlng = map.containerPointToLatLng(point);
      dropPin(latlng);
    }, 500);
  }, { passive: true });

  mapContainer.addEventListener('touchend', () => {
    if (longPressTimer !== undefined) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  }, { passive: true });

  mapContainer.addEventListener('touchmove', (e: TouchEvent) => {
    if (longPressTimer === undefined) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - longPressStartX;
    const dy = touch.clientY - longPressStartY;
    if (dx * dx + dy * dy > 100) { // moved more than ~10px
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  }, { passive: true });
}
