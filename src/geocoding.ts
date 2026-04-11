/**
 * Intent: ESRI geocoding — throttled autocomplete search and reverse geocode via right-click / long-press
 * Context: geosearch provides the search UI widget; geocodeService powers reverse geocode; both authenticate via VITE_ESRI_API_KEY
 * Pattern: User input → debounced ESRI API call → results rendered into floating dropdown (search) or compact geocode-bar (reverse)
 * Future: No offline fallback for search or reverse geocode; both silently fail without internet
 */
import L from 'leaflet';
import { geosearch, arcgisOnlineProvider, geocodeService } from 'esri-leaflet-geocoder';
import type { AppState } from './types';

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

// Shared references so addSearchControl can clear the drop pin / geocode bar on marker click.
let _pinLayer: L.LayerGroup | null = null;
let _clearSearchSelection: (() => void) | null = null;
let _showGeocodeBar: ((label: string, copyText: string) => void) | null = null;

export function addSearchControl(map: L.Map, state: AppState, onNoResults: (message: string) => void): void {
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
      if (input.value.length >= MIN_CHARS) pendingSearch = true;
    } else if (e.key === 'Escape') {
      pendingSearch = false;
      collapseSearch();
      hideDropdown();
    }
  });

  input.addEventListener('blur', () => {
    if (pendingSearch) return;
    // iOS keyboard accessory "Done" button fires blur without a keydown Enter.
    // If there is enough text to search, treat the blur as a submit by firing a
    // synthetic Enter so the library's own geocode path runs.
    if (input.value.length >= MIN_CHARS) {
      pendingSearch = true;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      return;
    }
    setTimeout(collapseSearch, 150);
  });

  const results = L.featureGroup().addTo(map);
  const markerRefs: L.Marker[] = [];

  // When the search icon is clicked to expand the control, dismiss the old
  // dropdown and clear previous result pins so the user starts fresh.
  let _wasExpanded = false;
  new MutationObserver(() => {
    const isExpanded = wrapper.classList.contains('geocoder-control-expanded');
    if (isExpanded && !_wasExpanded) {
      hideDropdown();
      results.clearLayers();
      markerRefs.length = 0;
    }
    _wasExpanded = isExpanded;
  }).observe(wrapper, { attributes: true, attributeFilter: ['class'] });

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
    // Clear dropped pin markers; show geocode bar with the selected result's address and coordinates.
    _pinLayer?.clearLayers();
    const resultName = target.dataset['name'] ?? '';
    const coordText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const label = resultName !== '' ? resultName : coordText;
    const copyText = resultName !== '' ? `${resultName}\n${coordText}` : coordText;
    _showGeocodeBar?.(label, copyText);
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
            ` data-name="${escapeHtml(name)}" data-bounds="${escapeHtml(boundsJson)}" data-addr-type="${addrType}" title="${tooltip}">` +
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
    } else {
      onNoResults('No results found. Try zooming out or rewording your search.');
    }
  });
}

export function addReverseGeocoding(map: L.Map, state: AppState): void {
  const apikey = import.meta.env.VITE_ESRI_API_KEY;
  const geocoder = geocodeService({ apikey });
  const pinLayer = L.layerGroup().addTo(map);
  _pinLayer = pinLayer;

  // Bottom sheet shown below the map when a pin is dropped.
  // Supports two snap points (peek / full) and drag-to-dismiss.
  const geocodeBar = document.createElement('div');
  geocodeBar.className = 'geocode-bar';
  geocodeBar.style.display = 'none';
  geocodeBar.innerHTML =
    '<div class="geocode-bar__handle" role="button" aria-label="Drag to resize sheet" tabindex="0">' +
    '  <div class="geocode-bar__handle-pill"></div>' +
    '</div>' +
    '<div class="geocode-bar__body">' +
    '  <button class="geocode-bar__copy" aria-label="Copy address">Copy</button>' +
    '  <span class="geocode-bar__addr"></span>' +
    '  <button class="geocode-bar__close" aria-label="Dismiss">\u00d7</button>' +
    '</div>';
  document.body.appendChild(geocodeBar);

  const barAddrEl  = geocodeBar.querySelector<HTMLElement>('.geocode-bar__addr')!;
  const barCopyBtn = geocodeBar.querySelector<HTMLButtonElement>('.geocode-bar__copy')!;
  const barHandle  = geocodeBar.querySelector<HTMLElement>('.geocode-bar__handle')!;

  // Height of the sheet visible in peek state (px), augmented by safe-area-inset-bottom
  // so the handle + action row remain fully above the home-indicator on notched phones.
  const PEEK_HEIGHT_BASE = 130;

  function getSafeAreaBottom(): number {
    // Read env(safe-area-inset-bottom) via a CSS custom property set in :root.
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--sai-bottom').trim();
    return parseInt(raw, 10) || 0;
  }

  function getPeekHeight(): number {
    return PEEK_HEIGHT_BASE + getSafeAreaBottom();
  }

  type SheetState = 'hidden' | 'peek' | 'full';
  let sheetState: SheetState = 'hidden';

  function getPeekOffset(): number {
    return geocodeBar.offsetHeight - getPeekHeight();
  }

  function applyTransform(offsetPx: number, animate: boolean): void {
    if (animate) {
      geocodeBar.style.willChange = 'transform';
      geocodeBar.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      geocodeBar.addEventListener('transitionend', () => {
        geocodeBar.style.willChange = '';
      }, { once: true });
    } else {
      geocodeBar.style.willChange = 'transform';
      geocodeBar.style.transition = 'none';
    }
    geocodeBar.style.transform = `translateX(-50%) translateY(${offsetPx}px)`;
  }

  function snapTo(target: SheetState): void {
    if (target === 'hidden') {
      // Update sheetState immediately so any concurrent showGeocodeBar call
      // takes the correct 'hidden' branch rather than calling snapTo('peek')
      // during the outgoing transition and having this transitionend listener
      // fire at the end of the NEW transition, hiding the freshly-opened sheet.
      sheetState = 'hidden';
      applyTransform(geocodeBar.offsetHeight + 20, true);
      geocodeBar.addEventListener('transitionend', () => {
        if (sheetState !== 'hidden') return; // re-opened before transition ended
        geocodeBar.style.display = 'none';
        geocodeBar.style.transform = '';
      }, { once: true });
      geocodeBar.classList.remove('geocode-bar--peek');
    } else {
      sheetState = target;
      applyTransform(target === 'peek' ? getPeekOffset() : 0, true);
      // In peek state the sheet overlay is pointer-events:none so map
      // interactions pass through; only handle and buttons remain interactive.
      geocodeBar.classList.toggle('geocode-bar--peek', target === 'peek');
    }
  }

  function showGeocodeBar(label: string, copyText: string): void {
    barAddrEl.textContent = label;
    barCopyBtn.dataset['copy'] = copyText;
    barCopyBtn.textContent = 'Copy';
    barCopyBtn.classList.remove('geocode-bar__copy--copied');

    if (sheetState === 'hidden') {
      // Render off-screen first so offsetHeight is available, then animate in.
      geocodeBar.style.display = 'flex';
      geocodeBar.style.transition = 'none';
      geocodeBar.style.transform = `translateX(-50%) translateY(${geocodeBar.offsetHeight}px)`;
      requestAnimationFrame(() => { snapTo('peek'); });
    } else {
      // Already visible — just refresh content and snap back to peek.
      snapTo('peek');
    }
  }

  function hideGeocodeBar(): void {
    snapTo('hidden');
  }

  _showGeocodeBar = showGeocodeBar;

  // ── Drag-to-snap on handle ───────────────────────────────────────────────
  let dragStartY = 0;
  let dragStartOffset = 0;
  let isDragging = false;

  barHandle.addEventListener('touchstart', (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    isDragging = true;
    dragStartY = touch.clientY;
    dragStartOffset = sheetState === 'full' ? 0 : getPeekOffset();
    geocodeBar.style.transition = 'none';
  }, { passive: true });

  barHandle.addEventListener('touchmove', (e: TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    if (!touch) return;
    const delta = touch.clientY - dragStartY;
    const clamped = Math.max(-20, Math.min(geocodeBar.offsetHeight + 20, dragStartOffset + delta));
    geocodeBar.style.transform = `translateX(-50%) translateY(${clamped}px)`;
  }, { passive: true });

  barHandle.addEventListener('touchend', (e: TouchEvent) => {
    if (!isDragging) return;
    isDragging = false;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const delta = touch.clientY - dragStartY;
    const currentOffset = dragStartOffset + delta;
    const peekOffset = getPeekOffset();
    // Dragged more than 80px below peek → dismiss
    if (currentOffset > peekOffset + 80) {
      hideGeocodeBar();
      pinLayer.clearLayers();
      return;
    }
    // Snap to nearest: below midpoint between full(0) and peek → full; above → peek
    snapTo(currentOffset < peekOffset / 2 ? 'full' : 'peek');
  }, { passive: true });

  // Click and keyboard (Enter / Space) on handle bar toggle peek ↔ full.
  // Both are required: click fires from pointer devices; keydown covers
  // keyboard and assistive-technology users (role="button" + tabindex="0").
  function handleToggle(): void {
    if (sheetState === 'peek') snapTo('full');
    else if (sheetState === 'full') snapTo('peek');
  }

  barHandle.addEventListener('click', handleToggle);
  barHandle.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle();
    }
  });

  geocodeBar.addEventListener('click', (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('.geocode-bar__close')) {
      hideGeocodeBar();
      pinLayer.clearLayers();
      return;
    }
    const copyBtn = t.closest<HTMLButtonElement>('.geocode-bar__copy');
    if (copyBtn) {
      // Haptic feedback on supported devices (Android Chrome)
      if ('vibrate' in navigator) navigator.vibrate(50);
      const text = copyBtn.dataset['copy'] ?? '';
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✓ Copied';
        copyBtn.classList.add('geocode-bar__copy--copied');
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.classList.remove('geocode-bar__copy--copied');
        }, 1500);
      }).catch((err: unknown) => {
        console.warn('Clipboard write failed:', err);
      });
    }
  });

  // Disable double-click zoom so dblclick can drop a pin instead
  map.doubleClickZoom.disable();

  function reverseGeocode(latlng: L.LatLng): void {
    const lat = latlng.lat;
    const lng = latlng.lng;
    const latStr = `${Math.abs(lat).toFixed(5)}\u00b0\u00a0${lat >= 0 ? 'N' : 'S'}`;
    const lngStr = `${Math.abs(lng).toFixed(5)}\u00b0\u00a0${lng >= 0 ? 'E' : 'W'}`;
    const coordLabel = `${latStr},  ${lngStr}`;

    geocoder
      .reverse()
      .latlng(latlng)
      .run((error, result) => {
        if (error || !result) {
          // Geocoding failed — fall back to coordinates.
          if (state.recordingState === 'idle') document.title = coordLabel;
          showGeocodeBar(coordLabel, coordLabel);
          return;
        }
        const addr = result.address.Match_addr;
        if (state.recordingState === 'idle') document.title = addr;
        showGeocodeBar(addr, addr);
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
