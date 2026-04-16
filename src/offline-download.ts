/**
 * Intent: Region pre-download for offline tile coverage — lets users select a bounding box and zoom range to pre-cache tiles
 * Context: Existing offline strategy caches only previously-viewed tiles; this adds proactive bulk caching via the Cache API
 * Pattern: User selects region via draggable rectangle + zoom slider, estimates tile count, then fetches/caches tiles in background chunks
 * Future: Only caches OSM tiles (the SW-cached layer); Mapbox/Google layers are not cached and won't benefit from pre-download
 */
import L from 'leaflet';
import { OSM_TILE_CACHE_NAME } from './sw-constants';

// ── Constants ────────────────────────────────────────────────────────────────

const AVG_TILE_BYTES = 15_000; // ~15KB average OSM tile size
const SAFARI_QUOTA_BYTES = 50 * 1024 * 1024; // ~50MB Safari cache quota
const CONCURRENT_FETCHES = 6; // max parallel tile fetches (browser limit per domain is 6)
const OSM_SUBDOMAINS = ['a', 'b', 'c'] as const;
const MIN_ZOOM = 1;
const MAX_ZOOM = 18;

// ── Tile coordinate math ─────────────────────────────────────────────────────

function lng2tile(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}

function lat2tile(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      Math.pow(2, z),
  );
}

interface TileRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function getTileRange(bounds: L.LatLngBounds, z: number): TileRange {
  const maxTile = Math.pow(2, z) - 1;
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  return {
    xMin: Math.max(0, lng2tile(sw.lng, z)),
    xMax: Math.min(maxTile, lng2tile(ne.lng, z)),
    yMin: Math.max(0, lat2tile(ne.lat, z)), // NE has smaller y (top of map)
    yMax: Math.min(maxTile, lat2tile(sw.lat, z)),
  };
}

function countTiles(bounds: L.LatLngBounds, zMin: number, zMax: number): number {
  let total = 0;
  for (let z = zMin; z <= zMax; z++) {
    const r = getTileRange(bounds, z);
    total += (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);
  }
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Tile URL generation ──────────────────────────────────────────────────────

function tileUrl(x: number, y: number, z: number): string {
  const sub = OSM_SUBDOMAINS[(x + y + z) % OSM_SUBDOMAINS.length];
  return `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

function generateTileUrls(bounds: L.LatLngBounds, zMin: number, zMax: number): string[] {
  const urls: string[] = [];
  for (let z = zMin; z <= zMax; z++) {
    const r = getTileRange(bounds, z);
    for (let x = r.xMin; x <= r.xMax; x++) {
      for (let y = r.yMin; y <= r.yMax; y++) {
        urls.push(tileUrl(x, y, z));
      }
    }
  }
  return urls;
}

// ── Download engine ──────────────────────────────────────────────────────────

interface DownloadProgress {
  total: number;
  done: number;
  cached: number;
  failed: number;
}

type ProgressCallback = (progress: DownloadProgress) => void;

let _abortController: AbortController | null = null;

async function downloadTiles(
  urls: string[],
  onProgress: ProgressCallback,
): Promise<DownloadProgress> {
  _abortController = new AbortController();
  const signal = _abortController.signal;
  const cache = await caches.open(OSM_TILE_CACHE_NAME);

  const progress: DownloadProgress = {
    total: urls.length,
    done: 0,
    cached: 0,
    failed: 0,
  };

  // Filter out already-cached tiles first
  const uncached: string[] = [];
  for (const url of urls) {
    if (signal.aborted) break;
    const existing = await cache.match(url);
    if (existing) {
      progress.cached++;
      progress.done++;
    } else {
      uncached.push(url);
    }
  }
  onProgress(progress);

  // Fetch uncached tiles in parallel chunks
  let idx = 0;
  const fetchOne = async (): Promise<void> => {
    while (idx < uncached.length) {
      if (signal.aborted) return;
      const url = uncached[idx++];
      if (url === undefined) return;
      try {
        const resp = await fetch(url, { signal });
        if (resp.ok) {
          await cache.put(url, resp);
        } else {
          progress.failed++;
        }
      } catch {
        if (!signal.aborted) progress.failed++;
      }
      progress.done++;
      onProgress(progress);
    }
  };

  const workers = Array.from({ length: CONCURRENT_FETCHES }, () => fetchOne());
  await Promise.all(workers);

  _abortController = null;
  return progress;
}

function cancelDownload(): void {
  if (_abortController) {
    _abortController.abort();
    _abortController = null;
  }
}

// ── Cached region overlay ────────────────────────────────────────────────────

let _cachedOverlay: L.Rectangle | null = null;

function showCachedOverlay(map: L.Map, bounds: L.LatLngBounds): void {
  clearCachedOverlay(map);
  _cachedOverlay = L.rectangle(bounds, {
    color: '#4287f5',
    weight: 2,
    opacity: 0.5,
    fillColor: '#4287f5',
    fillOpacity: 0.08,
    dashArray: '6, 4',
    interactive: false,
  }).addTo(map);
}

function clearCachedOverlay(map: L.Map): void {
  if (_cachedOverlay) {
    map.removeLayer(_cachedOverlay);
    _cachedOverlay = null;
  }
}

// ── Draggable selection rectangle ────────────────────────────────────────────

interface SelectionRect {
  rectangle: L.Rectangle;
  handles: L.Marker[];
  cleanup: () => void;
}

function createDragHandle(latlng: L.LatLng): L.Marker {
  const icon = L.divIcon({
    className: 'offline-dl-handle',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  return L.marker(latlng, { icon, draggable: true, zIndexOffset: 2000 });
}

function createSelectionRect(
  map: L.Map,
  initialBounds: L.LatLngBounds,
  onBoundsChange: (bounds: L.LatLngBounds) => void,
): SelectionRect {
  const rect = L.rectangle(initialBounds, {
    color: '#4287f5',
    weight: 2,
    fillColor: '#4287f5',
    fillOpacity: 0.15,
    interactive: false,
  }).addTo(map);

  const ne = initialBounds.getNorthEast();
  const sw = initialBounds.getSouthWest();
  const nw = L.latLng(ne.lat, sw.lng);
  const se = L.latLng(sw.lat, ne.lng);

  const handles = [
    createDragHandle(nw), // 0: NW
    createDragHandle(ne), // 1: NE
    createDragHandle(se), // 2: SE
    createDragHandle(sw), // 3: SW
  ];
  handles.forEach((h) => h.addTo(map));

  function updateRect(): void {
    const nwPos = handles[0]!.getLatLng();
    const sePos = handles[2]!.getLatLng();
    const newBounds = L.latLngBounds(
      L.latLng(Math.min(nwPos.lat, sePos.lat), Math.min(nwPos.lng, sePos.lng)),
      L.latLng(Math.max(nwPos.lat, sePos.lat), Math.max(nwPos.lng, sePos.lng)),
    );
    rect.setBounds(newBounds);
    // Sync non-dragged corners
    handles[1]!.setLatLng(newBounds.getNorthEast());
    handles[3]!.setLatLng(newBounds.getSouthWest());
    onBoundsChange(newBounds);
  }

  // NW handle: adjusts N lat and W lng
  handles[0]!.on('drag', () => {
    const pos = handles[0]!.getLatLng();
    handles[1]!.setLatLng(L.latLng(pos.lat, handles[1]!.getLatLng().lng));
    handles[3]!.setLatLng(L.latLng(handles[3]!.getLatLng().lat, pos.lng));
    updateRect();
  });

  // NE handle: adjusts N lat and E lng
  handles[1]!.on('drag', () => {
    const pos = handles[1]!.getLatLng();
    handles[0]!.setLatLng(L.latLng(pos.lat, handles[0]!.getLatLng().lng));
    handles[2]!.setLatLng(L.latLng(handles[2]!.getLatLng().lat, pos.lng));
    updateRect();
  });

  // SE handle: adjusts S lat and E lng
  handles[2]!.on('drag', () => {
    const pos = handles[2]!.getLatLng();
    handles[1]!.setLatLng(L.latLng(handles[1]!.getLatLng().lat, pos.lng));
    handles[3]!.setLatLng(L.latLng(pos.lat, handles[3]!.getLatLng().lng));
    updateRect();
  });

  // SW handle: adjusts S lat and W lng
  handles[3]!.on('drag', () => {
    const pos = handles[3]!.getLatLng();
    handles[0]!.setLatLng(L.latLng(handles[0]!.getLatLng().lat, pos.lng));
    handles[2]!.setLatLng(L.latLng(pos.lat, handles[2]!.getLatLng().lng));
    updateRect();
  });

  function cleanup(): void {
    map.removeLayer(rect);
    handles.forEach((h) => map.removeLayer(h));
  }

  return { rectangle: rect, handles, cleanup };
}

// ── UI Panel ─────────────────────────────────────────────────────────────────

type DownloadState = 'selecting' | 'downloading' | 'done';

let _panelEl: HTMLElement | null = null;
let _selection: SelectionRect | null = null;
let _downloadState: DownloadState = 'selecting';
let _selectedBounds: L.LatLngBounds | null = null;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z)));
}

function buildPanel(
  map: L.Map,
  showToast: (msg: string, durationMs?: number) => void,
): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'offline-dl-panel';
  panel.className = 'offline-dl-panel';

  const currentZoom = clampZoom(map.getZoom());
  const defaultMinZoom = Math.max(MIN_ZOOM, currentZoom - 2);
  const defaultMaxZoom = Math.min(MAX_ZOOM, currentZoom + 2);

  panel.innerHTML =
    '<div class="offline-dl-panel__header">' +
    '  <span class="offline-dl-panel__title">Download for Offline</span>' +
    '  <button class="offline-dl-panel__close" aria-label="Cancel">&#x2715;</button>' +
    '</div>' +
    '<div class="offline-dl-panel__body">' +
    '  <p class="offline-dl-hint">Drag the corners to select a region</p>' +
    '  <div class="offline-dl-field">' +
    '    <label for="offline-dl-zmin">Min zoom: <span id="offline-dl-zmin-val">' + defaultMinZoom + '</span></label>' +
    '    <input type="range" id="offline-dl-zmin" min="' + MIN_ZOOM + '" max="' + MAX_ZOOM + '" value="' + defaultMinZoom + '">' +
    '  </div>' +
    '  <div class="offline-dl-field">' +
    '    <label for="offline-dl-zmax">Max zoom: <span id="offline-dl-zmax-val">' + defaultMaxZoom + '</span></label>' +
    '    <input type="range" id="offline-dl-zmax" min="' + MIN_ZOOM + '" max="' + MAX_ZOOM + '" value="' + defaultMaxZoom + '">' +
    '  </div>' +
    '  <div class="offline-dl-estimate" id="offline-dl-estimate">--</div>' +
    '  <div class="offline-dl-warning" id="offline-dl-warning"></div>' +
    '  <div class="offline-dl-progress" id="offline-dl-progress" style="display:none">' +
    '    <div class="offline-dl-progress__bar">' +
    '      <div class="offline-dl-progress__fill" id="offline-dl-fill"></div>' +
    '    </div>' +
    '    <span class="offline-dl-progress__text" id="offline-dl-progress-text">0%</span>' +
    '  </div>' +
    '  <div class="offline-dl-actions">' +
    '    <button class="offline-dl-btn offline-dl-btn--primary" id="offline-dl-start">Download</button>' +
    '    <button class="offline-dl-btn offline-dl-btn--secondary" id="offline-dl-cancel">Cancel</button>' +
    '  </div>' +
    '</div>';

  // Wire up controls
  const zminInput = panel.querySelector('#offline-dl-zmin') as HTMLInputElement;
  const zmaxInput = panel.querySelector('#offline-dl-zmax') as HTMLInputElement;
  const zminVal = panel.querySelector('#offline-dl-zmin-val') as HTMLElement;
  const zmaxVal = panel.querySelector('#offline-dl-zmax-val') as HTMLElement;
  const closeBtn = panel.querySelector('.offline-dl-panel__close') as HTMLButtonElement;
  const startBtn = panel.querySelector('#offline-dl-start') as HTMLButtonElement;
  const cancelBtn = panel.querySelector('#offline-dl-cancel') as HTMLButtonElement;

  function updateEstimate(): void {
    if (!_selectedBounds) return;
    const zMin = parseInt(zminInput.value, 10);
    const zMax = parseInt(zmaxInput.value, 10);
    const tiles = countTiles(_selectedBounds, zMin, zMax);
    const estimatedBytes = tiles * AVG_TILE_BYTES;
    const estimateEl = panel.querySelector('#offline-dl-estimate');
    const warningEl = panel.querySelector('#offline-dl-warning');
    if (estimateEl) {
      estimateEl.textContent = `~${tiles.toLocaleString()} tiles (${formatBytes(estimatedBytes)})`;
    }
    if (warningEl) {
      if (estimatedBytes > SAFARI_QUOTA_BYTES) {
        (warningEl as HTMLElement).textContent =
          `Warning: estimated size exceeds Safari's ~50MB cache quota. Reduce the region or zoom range.`;
        (warningEl as HTMLElement).style.display = 'block';
      } else {
        (warningEl as HTMLElement).style.display = 'none';
      }
    }
  }

  zminInput.addEventListener('input', () => {
    let zMin = parseInt(zminInput.value, 10);
    const zMax = parseInt(zmaxInput.value, 10);
    if (zMin > zMax) {
      zMin = zMax;
      zminInput.value = String(zMin);
    }
    zminVal.textContent = String(zMin);
    updateEstimate();
  });

  zmaxInput.addEventListener('input', () => {
    const zMin = parseInt(zminInput.value, 10);
    let zMax = parseInt(zmaxInput.value, 10);
    if (zMax < zMin) {
      zMax = zMin;
      zmaxInput.value = String(zMax);
    }
    zmaxVal.textContent = String(zMax);
    updateEstimate();
  });

  closeBtn.addEventListener('click', () => closePanel(map));

  startBtn.addEventListener('click', () => {
    if (_downloadState !== 'selecting' || !_selectedBounds) return;
    const zMin = parseInt(zminInput.value, 10);
    const zMax = parseInt(zmaxInput.value, 10);
    void startDownload(map, _selectedBounds, zMin, zMax, showToast);
  });

  cancelBtn.addEventListener('click', () => {
    if (_downloadState === 'downloading') {
      cancelDownload();
      _downloadState = 'selecting';
      setUiState(panel, 'selecting');
    } else {
      closePanel(map);
    }
  });

  // Set up selection rectangle (inset from current viewport)
  const mapBounds = map.getBounds();
  const latPad = (mapBounds.getNorth() - mapBounds.getSouth()) * 0.15;
  const lngPad = (mapBounds.getEast() - mapBounds.getWest()) * 0.15;
  const selBounds = L.latLngBounds(
    L.latLng(mapBounds.getSouth() + latPad, mapBounds.getWest() + lngPad),
    L.latLng(mapBounds.getNorth() - latPad, mapBounds.getEast() - lngPad),
  );
  _selectedBounds = selBounds;

  _selection = createSelectionRect(map, selBounds, (newBounds) => {
    _selectedBounds = newBounds;
    updateEstimate();
  });

  // Initial estimate
  setTimeout(updateEstimate, 0);

  return panel;
}

function setUiState(panel: HTMLElement, state: DownloadState): void {
  _downloadState = state;
  const startBtn = panel.querySelector('#offline-dl-start') as HTMLButtonElement | null;
  const cancelBtn = panel.querySelector('#offline-dl-cancel') as HTMLButtonElement | null;
  const progressEl = panel.querySelector('#offline-dl-progress') as HTMLElement | null;
  const zminInput = panel.querySelector('#offline-dl-zmin') as HTMLInputElement | null;
  const zmaxInput = panel.querySelector('#offline-dl-zmax') as HTMLInputElement | null;

  switch (state) {
    case 'selecting':
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Download'; }
      if (cancelBtn) cancelBtn.textContent = 'Cancel';
      if (progressEl) progressEl.style.display = 'none';
      if (zminInput) zminInput.disabled = false;
      if (zmaxInput) zmaxInput.disabled = false;
      break;
    case 'downloading':
      if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Downloading...'; }
      if (cancelBtn) cancelBtn.textContent = 'Stop';
      if (progressEl) progressEl.style.display = 'flex';
      if (zminInput) zminInput.disabled = true;
      if (zmaxInput) zmaxInput.disabled = true;
      break;
    case 'done':
      if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Done'; }
      if (cancelBtn) cancelBtn.textContent = 'Close';
      if (zminInput) zminInput.disabled = true;
      if (zmaxInput) zmaxInput.disabled = true;
      break;
  }
}

async function startDownload(
  map: L.Map,
  bounds: L.LatLngBounds,
  zMin: number,
  zMax: number,
  showToast: (msg: string, durationMs?: number) => void,
): Promise<void> {
  if (!_panelEl) return;
  setUiState(_panelEl, 'downloading');

  const urls = generateTileUrls(bounds, zMin, zMax);
  const fillEl = _panelEl.querySelector('#offline-dl-fill') as HTMLElement | null;
  const textEl = _panelEl.querySelector('#offline-dl-progress-text') as HTMLElement | null;

  const result = await downloadTiles(urls, (p) => {
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (textEl) textEl.textContent = `${pct}% (${p.done}/${p.total})`;
  });

  if (!_panelEl) return; // panel was closed during download

  setUiState(_panelEl, 'done');

  // Show cached region overlay on map
  showCachedOverlay(map, bounds);

  const msg = result.failed > 0
    ? `Downloaded ${result.done - result.failed - result.cached} tiles (${result.cached} already cached, ${result.failed} failed)`
    : `Downloaded ${result.done - result.cached} new tiles (${result.cached} already cached)`;
  showToast(msg, 5000);
}

// ── Public API ───────────────────────────────────────────────────────────────

export function openOfflineDownloadPanel(
  map: L.Map,
  showToast: (msg: string, durationMs?: number) => void,
): void {
  if (_panelEl) return; // already open
  if (!('caches' in window)) {
    showToast('Offline download requires a browser with Cache API support', 4000);
    return;
  }
  _downloadState = 'selecting';
  _panelEl = buildPanel(map, showToast);
  document.getElementById('map')?.appendChild(_panelEl);
}

function closePanel(map: L.Map): void {
  cancelDownload();
  if (_selection) {
    _selection.cleanup();
    _selection = null;
  }
  if (_panelEl) {
    _panelEl.remove();
    _panelEl = null;
  }
  _selectedBounds = null;
  _downloadState = 'selecting';
  // Keep cached overlay visible after close — intentional so user can see what's cached
  void map; // reference used by callers; lint-safe
}

export function addOfflineDownloadControl(
  map: L.Map,
  showToast: (msg: string, durationMs?: number) => void,
): void {
  const Ctrl = L.Control.extend({
    onAdd(): HTMLElement {
      const container = L.DomUtil.create('div', 'leaflet-control-toggle') as HTMLDivElement;

      const iconSpan = L.DomUtil.create('span', 'leaflet-control-toggle__icon') as HTMLSpanElement;
      iconSpan.id = 'offline-dl-btn';
      iconSpan.innerHTML = '&#x21E9;'; // downward arrow
      iconSpan.title = 'Download: Select a region and zoom range to cache for offline use';

      container.appendChild(iconSpan);

      const label = L.DomUtil.create('span', 'leaflet-control-toggle__label') as HTMLSpanElement;
      label.textContent = 'Download';
      container.appendChild(label);

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(container, 'touchend', (e: Event) => {
        e.preventDefault();
        openOfflineDownloadPanel(map, showToast);
        e.stopImmediatePropagation();
      });
      L.DomEvent.on(container, 'click', (e: Event) => {
        openOfflineDownloadPanel(map, showToast);
        e.stopImmediatePropagation();
      });

      return container;
    },
  });

  new (Ctrl as new (opts: L.ControlOptions) => L.Control)({
    position: 'topleft',
  }).addTo(map);
}
