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

function createNumberedIcon(n: number): L.DivIcon {
  return L.divIcon({
    html: `<div>${n}</div>`,
    className: 'numbered-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function createActiveNumberedIcon(n: number): L.DivIcon {
  return L.divIcon({
    html: `<div>${n}</div>`,
    className: 'numbered-marker numbered-marker--active',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Apply a zoom-level CSS class to the map container so markers can
// respond to zoom via CSS without per-marker JS icon swaps.
// far  (zoom  < 7):  dot only — numbers unreadable at world scale
// mid  (zoom  7–11): medium circle — readable but compact
// close (zoom >= 12): full-size — default styles apply
function applyMapZoomClass(map: L.Map): void {
  const z = map.getZoom();
  const el = map.getContainer();
  el.classList.toggle('map-zoom-far',   z < 7);
  el.classList.toggle('map-zoom-mid',   z >= 7 && z < 12);
  el.classList.toggle('map-zoom-close', z >= 12);
}

function zoomForAddrType(addrType: string): number {
  switch (addrType) {
    case 'PointAddress': case 'StreetAddress': case 'SubAddress': case 'StreetInt': return 17;
    case 'Locality': case 'Neighborhood': case 'Sublocality': return 14;
    case 'City': case 'Municipal': return 12;
    case 'Region': case 'State': case 'Province': return 8;
    case 'Country': return 5;
    default: return 15;
  }
}

// Shared reference so addSearchControl can clear the drop pin on marker click.
let _pinLayer: L.LayerGroup | null = null;
let _clearSearchSelection: (() => void) | null = null;

export function addSearchControl(map: L.Map, state: AppState): void {
  // state is read in the results callback (for future extensibility)
  void state;

  const apikey = import.meta.env.VITE_ESRI_API_KEY;

  // Without an API key the search control is non-functional — skip adding it
  // entirely so users see no broken UI rather than a silently broken one.
  if (!apikey) {
    console.warn(
      'VITE_ESRI_API_KEY is not configured. ' +
      'Search functionality will not work. ' +
      'Set VITE_ESRI_API_KEY in your .env file.'
    );
    return;
  }

  // Wrap a provider so that errors in results() and suggest() are logged and
  // silenced rather than propagated. Wrapping before construction avoids
  // accessing private internals of GeosearchCore after the fact.
  // Both methods must be wrapped: suggest() drives the autocomplete spinner on
  // each keystroke; results() drives the Enter/select path.
  function wrapProvider(provider: unknown): unknown {
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
          if (error) console.warn('Search provider error:', error);
          cb(null, error ? [] : results);
        });
      };
    }
    return provider;
  }

  // useMapBounds accepts a zoom threshold: below this zoom level bounds are not
  // sent (avoiding the "entire world" bbox that returns no results at initial
  // view); at or above it, results are constrained to the visible map area.
  //
  // collapseAfterResult: false — prevents clear() from collapsing the control
  // immediately when Enter is pressed (before results arrive). We handle collapse
  // ourselves in the results handler and on blur.
  const MIN_CHARS = 3;
  const searchControl = geosearch({
    placeholder: '',
    title: 'Search for places or addresses',
    position: 'topleft',
    expanded: false,
    useMapBounds: 7,
    zoomToResult: false,
    collapseAfterResult: false,
    minCharacters: MIN_CHARS,
    debounceDelay: 250,
    providers: [wrapProvider(arcgisOnlineProvider({ maxResults: 15, apikey, outFields: 'Addr_type,City,Region,Postal' }))],
  });
  searchControl.addTo(map);

  // Resolve DOM refs via the public getContainer() API (created in onAdd, so
  // must come after addTo). Guard against future library changes that might
  // restructure the DOM. Re-bind to non-nullable types after the guard so
  // closures below do not require non-null assertions.
  const container = searchControl.getContainer();
  const inputEl = container?.querySelector('input') as HTMLInputElement | null;
  if (!container || !inputEl) {
    console.warn('Search control DOM not found — search disabled.');
    return;
  }
  const input: HTMLInputElement = inputEl;
  const wrapper: HTMLElement = container;

  // Floating search results dropdown — appended to document.body so it can
  // overflow the Leaflet map container without being clipped. Positioned via
  // showDropdown() using the control's bounding rect at the time results arrive.
  const dropdownEl = document.createElement('div');
  dropdownEl.className = 'search-dropdown';
  dropdownEl.style.display = 'none';
  document.body.appendChild(dropdownEl);

  function hideDropdown(): void {
    dropdownEl.style.display = 'none';
    // Preserve innerHTML so it can be restored when clicking a marker.
  }

  function showDropdown(): void {
    const rect = wrapper.getBoundingClientRect();
    dropdownEl.style.top = `${rect.bottom + 2}px`;
    dropdownEl.style.left = `${Math.max(4, rect.left)}px`;
    dropdownEl.style.display = 'block';
  }

  // Dropdown is dismissed only via the close button inside it.
  dropdownEl.addEventListener('click', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.search-dropdown__close')) hideDropdown();
  });

  // Collapse the search control and clear the input — called after results arrive
  // or when the input loses focus. Does not close the dropdown (results stay visible).
  function collapseSearch(): void {
    input.value = '';
    input.placeholder = '';
    input.dispatchEvent(new Event('input'));
    L.DomUtil.removeClass(wrapper, 'geocoder-control-expanded');
  }

  // Track whether a search is in flight so blur does not collapse the control
  // before results arrive.
  let pendingSearch = false;

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (input.value.length >= MIN_CHARS) {
        pendingSearch = true;
        // Clear previous results immediately so old pins/dropdown don't linger
        // while the new request is in flight.
        hideDropdown();
        results.clearLayers();
        markerRefs.length = 0;
      }
    } else if (e.key === 'Escape') {
      pendingSearch = false;
      collapseSearch();
      hideDropdown();
    }
  });

  input.addEventListener('blur', () => {
    if (pendingSearch) return;
    setTimeout(collapseSearch, 150);
  });

  const results = L.featureGroup().addTo(map);
  const markerRefs: L.Marker[] = [];

  function clearSelection(): void {
    dropdownEl.querySelectorAll<HTMLElement>('.sheet-result--active').forEach(el => {
      el.classList.remove('sheet-result--active');
    });
    markerRefs.forEach((marker, idx) => {
      marker.setIcon(createNumberedIcon(idx + 1));
    });
  }
  _clearSearchSelection = clearSelection;

  function activateSelection(index: number): void {
    const marker = markerRefs[index];
    if (marker) marker.setIcon(createActiveNumberedIcon(index + 1));
  }

  // Event delegation on dropdown — wired once; fires for any result-item click.
  dropdownEl.addEventListener('click', (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-lat]');
    if (target === null) return;
    const lat = parseFloat(target.dataset['lat'] ?? '');
    const lng = parseFloat(target.dataset['lng'] ?? '');
    if (isNaN(lat) || isNaN(lng)) return;
    clearSelection();
    target.classList.add('sheet-result--active');
    const idx = parseInt(target.dataset['index'] ?? '', 10);
    if (!isNaN(idx)) activateSelection(idx);
    const boundsRaw = target.dataset['bounds'] ?? '';
    if (boundsRaw !== '') {
      try {
        const parsed = JSON.parse(boundsRaw) as unknown;
        if (Array.isArray(parsed) && parsed.length === 2 &&
            Array.isArray(parsed[0]) && Array.isArray(parsed[1])) {
          map.flyToBounds(L.latLngBounds(parsed as [[number, number], [number, number]]), {
            paddingTopLeft:     [50, 50],
            paddingBottomRight: [50, 50],
            maxZoom: 17,
          });
        } else {
          map.flyTo(L.latLng(lat, lng), zoomForAddrType(target.dataset['addrType'] ?? ''));
        }
      } catch {
        map.flyTo(L.latLng(lat, lng), zoomForAddrType(target.dataset['addrType'] ?? ''));
      }
    } else {
      map.flyTo(L.latLng(lat, lng), zoomForAddrType(target.dataset['addrType'] ?? ''));
    }
  });

  // Keep marker size in sync with map zoom level via CSS classes.
  map.on('zoomend', () => applyMapZoomClass(map));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchControl.on('results', (data: any) => {
    pendingSearch = false;
    L.DomUtil.removeClass(wrapper, 'geocoder-control-loading');
    collapseSearch();
    results.clearLayers();
    markerRefs.length = 0;
    if (data.results.length) {
      document.title = data.text;

      // Add numbered markers in reverse order so marker #1 renders on top.
      for (let i = data.results.length - 1; i >= 0; i--) {
        const result = data.results[i];
        if (result) {
          const marker = L.marker(result.latlng, { icon: createNumberedIcon(i + 1) });
          markerRefs[i] = marker;
          results.addLayer(marker);
          marker.on('click', (e: L.LeafletMouseEvent) => {
            // Stop propagation so the map click handler doesn't immediately re-hide the dropdown.
            L.DomEvent.stopPropagation(e);
            clearSelection();
            marker.setIcon(createActiveNumberedIcon(i + 1));
            // Restore dropdown if the user had dismissed it.
            if (dropdownEl.innerHTML !== '') showDropdown();
            // Clear any dropped pin.
            _pinLayer?.clearLayers();
            // Update page title.
            document.title = result.text;
            const li = dropdownEl.querySelector<HTMLElement>(`.sheet-result[data-index="${i}"]`);
            if (li) {
              li.classList.add('sheet-result--active');
              li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          });
        }
      }

      // Build results list HTML
      const itemsHtml = data.results
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any, i: number) => {
          if (!r) return '';
          const name = escapeHtml(r.text);
          const lat = r.latlng.lat.toFixed(6);
          const lng = r.latlng.lng.toFixed(6);
          const boundsJson = r.bounds
            ? JSON.stringify([[r.bounds.getSouth(), r.bounds.getWest()],
                              [r.bounds.getNorth(), r.bounds.getEast()]])
            : '';
          const strProp = (v: unknown): string => (typeof v === 'string' ? v : '');
          const addrType = escapeHtml(strProp(r.properties?.Addr_type));
          const subtitle = ['City', 'Region', 'Postal']
            .map((k) => strProp(r.properties?.[k]))
            .filter(Boolean)
            .map(escapeHtml)
            .join(', ');
          const tooltipParts = [name, subtitle, addrType, `${lat}, ${lng}`].filter(Boolean);
          const tooltip = escapeHtml(tooltipParts.join(' · '));
          return (
            `<li class="sheet-result" data-index="${i}" data-lat="${lat}" data-lng="${lng}"` +
            ` data-bounds="${escapeHtml(boundsJson)}" data-addr-type="${addrType}" title="${tooltip}">` +
            `  <div class="sheet-result__main">` +
            `    <span class="sheet-result__name">${name}</span>` +
            (subtitle ? `    <span class="sheet-result__subtitle">${subtitle}</span>` : '') +
            `  </div>` +
            (addrType ? `  <span class="sheet-result__badge">${addrType}</span>` : '') +
            `  <span class="sheet-result__arrow">&#x203A;</span>` +
            `</li>`
          );
        })
        .join('');

      // Populate the dropdown (replaces showSheet for search results).
      const count = data.results.length;
      const countLabel = count === 1 ? '1 result' : `${count} results`;
      dropdownEl.innerHTML =
        `<div class="search-dropdown__header">` +
        `  <span>${escapeHtml(data.text)} &mdash; ${countLabel}</span>` +
        `  <button class="search-dropdown__close" aria-label="Close">\u00d7</button>` +
        `</div>` +
        `<ul class="sheet-results">${itemsHtml}</ul>`;
      showDropdown();

      applyMapZoomClass(map);

      // Fit map to results. Single result uses its ESRI extent for geographic
      // scale; multiple results use the marker group bounds.
      const singleResult = data.results.length === 1 ? data.results[0] : null;
      const boundsToFly: L.LatLngBounds =
        (singleResult?.bounds as L.LatLngBounds | undefined) ?? results.getBounds();
      map.flyToBounds(boundsToFly, {
        paddingTopLeft:     [50, 50] as [number, number],
        paddingBottomRight: [50, 50] as [number, number],
        maxZoom: 16,
        animate: true,
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }
  });
}

export function addReverseGeocoding(map: L.Map, state: AppState): void {
  const apikey = import.meta.env.VITE_ESRI_API_KEY;
  const geocoder = geocodeService({ apikey });
  const pinLayer = L.layerGroup().addTo(map);
  _pinLayer = pinLayer;

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

  const redIcon = new L.Icon({
    iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize:    [25, 41],
    iconAnchor:  [12, 41],
    popupAnchor: [1, -34],
    shadowSize:  [41, 41],
    className:   'marker-red',
  });

  function dropPin(latlng: L.LatLng): void {
    pinLayer.clearLayers();
    _clearSearchSelection?.();
    const pin = L.marker(latlng, { draggable: true, icon: redIcon });
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

  // Right-click (desktop) and long-press (mobile) both fire contextmenu.
  // A second contextmenu handler below sets contextmenuFired=true so the iOS
  // touch-fallback doesn't double-drop on browsers that do fire contextmenu.
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

  // Guard: if contextmenu fired natively, cancel the touch fallback timer
  // so browsers that do support long-press contextmenu don't double-drop.
  map.on('contextmenu', () => {
    contextmenuFired = true;
    if (longPressTimer !== undefined) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  });

  const mapContainer = map.getContainer();
  mapContainer.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      cancelLongPress(); // second finger joined mid-hold — cancel timer
      return;
    }
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

  function cancelLongPress(): void {
    if (longPressTimer !== undefined) {
      clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  }

  mapContainer.addEventListener('touchend', cancelLongPress, { passive: true });
  // touchcancel fires when the OS interrupts a touch (e.g. incoming call);
  // clear the timer to prevent a spurious pin drop after the interruption.
  mapContainer.addEventListener('touchcancel', cancelLongPress, { passive: true });

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
