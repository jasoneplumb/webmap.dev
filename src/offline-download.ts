/**
 * Intent: Region pre-download for offline tile coverage — lets users select a bounding
 *         box, zoom range, and layer set to save ahead of a trip, and manage what's saved
 * Context: Passive SW caching covers only previously-viewed tiles and is subject to LRU
 *          eviction; downloads here land in the protected region-tiles cache the SW
 *          serves first (ADR-007, #303). Tile math, URL builders, and the saved-region
 *          manifest live in offline-regions.ts.
 * Pattern: User selects region via draggable rectangle + zoom sliders + layer checkboxes,
 *          sees per-layer estimates, then fetches/caches tiles in parallel chunks
 * Future: Only layers whose provider terms allow bulk download are offered — OSM Streets
 *         and Terrarium elevation (AWS Open Data) for Hillshade. The rest stay
 *         passive-only: Thunderforest prohibits pre-caching without a paid plan, and
 *         Esri/osm.fr/Waymarked terms similarly gate bulk fetching.
 */
import L from 'leaflet';
import { setupCollapsibleLabel } from './controls';
import { REGION_TILE_CACHE_NAME } from './sw-constants';
import {
  REGION_LAYERS,
  type RegionBounds,
  type RegionLayerId,
  type SavedRegion,
  addRegion,
  estimateLayers,
  formatBytes,
  getStorageEstimate,
  loadRegions,
  nextRegionName,
  removeRegion,
  requestPersistentStorage,
  tileUrlsForLayer,
} from './offline-regions';

// ── Constants ────────────────────────────────────────────────────────────────

const SAFARI_QUOTA_BYTES = 50 * 1024 * 1024; // ~50MB Safari cache quota
const CONCURRENT_FETCHES = 6; // max parallel tile fetches (browser limit per domain is 6)
const MIN_ZOOM = 1;
const MAX_ZOOM = 18;

// Region names are auto-generated today, but the manifest lives in localStorage —
// writable by anything on the origin — so treat names as data, not markup.
function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return s.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

function toRegionBounds(bounds: L.LatLngBounds): RegionBounds {
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  };
}

function selectedLayerIds(panel: HTMLElement): RegionLayerId[] {
  const ids: RegionLayerId[] = [];
  for (const id of Object.keys(REGION_LAYERS) as RegionLayerId[]) {
    const box = panel.querySelector<HTMLInputElement>(`#offline-dl-layer-${id}`);
    if (box?.checked) ids.push(id);
  }
  return ids;
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
  // The protected region cache — served by the SW ahead of the passive strategies
  // and exempt from their expiration. See ADR-007.
  const cache = await caches.open(REGION_TILE_CACHE_NAME);

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
// The control that opens the panel. Module-level rather than closure-held because
// openOfflineDownloadPanel/closePanel are module functions and also reachable from
// other entry points — they mark the control blue for as long as the panel is up (#289).
let _controlEl: HTMLElement | null = null;

const CONTROL_ACTIVE_CLASS = 'leaflet-control-toggle--active';
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
    '  <span class="offline-dl-panel__title">Download for Offline<span class="offline-dl-panel__chevron" aria-hidden="true">&#x25B2;</span></span>' +
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
    '  <fieldset class="offline-dl-layers">' +
    '    <legend>Layers to save</legend>' +
    '    <label class="offline-dl-layers__row">' +
    '      <input type="checkbox" id="offline-dl-layer-streets" checked>' +
    '      <span>' + REGION_LAYERS.streets.label + '</span>' +
    '      <span class="offline-dl-layers__size" id="offline-dl-size-streets"></span>' +
    '    </label>' +
    '    <label class="offline-dl-layers__row">' +
    '      <input type="checkbox" id="offline-dl-layer-hillshade" checked>' +
    '      <span>' + REGION_LAYERS.hillshade.label + '</span>' +
    '      <span class="offline-dl-layers__size" id="offline-dl-size-hillshade"></span>' +
    '    </label>' +
    '    <p class="offline-dl-note">Other layers save automatically as you browse them &mdash; their providers don&rsquo;t allow bulk download.</p>' +
    '  </fieldset>' +
    '  <div class="offline-dl-estimate" id="offline-dl-estimate">--</div>' +
    '  <div class="offline-dl-storage" id="offline-dl-storage"></div>' +
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
    '  <div class="offline-dl-regions" id="offline-dl-regions"></div>' +
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
    const bounds = toRegionBounds(_selectedBounds);
    const layers = selectedLayerIds(panel);

    // Per-layer sizes beside each checkbox — computed for every offered layer so an
    // unchecked row still shows what checking it would cost.
    for (const id of Object.keys(REGION_LAYERS) as RegionLayerId[]) {
      const sizeEl = panel.querySelector(`#offline-dl-size-${id}`);
      const [est] = estimateLayers([id], bounds, zMin, zMax);
      if (sizeEl && est) sizeEl.textContent = `~${formatBytes(est.bytes)}`;
    }

    const estimates = estimateLayers(layers, bounds, zMin, zMax);
    const tiles = estimates.reduce((sum, e) => sum + e.tiles, 0);
    const estimatedBytes = estimates.reduce((sum, e) => sum + e.bytes, 0);
    const estimateEl = panel.querySelector('#offline-dl-estimate');
    const warningEl = panel.querySelector('#offline-dl-warning');
    if (estimateEl) {
      estimateEl.textContent = layers.length === 0
        ? 'Select at least one layer to save'
        : `~${tiles.toLocaleString()} tiles (${formatBytes(estimatedBytes)})`;
    }
    // Only manage the button while selecting — mid-download it belongs to setUiState.
    if (startBtn && _downloadState === 'selecting') startBtn.disabled = layers.length === 0;
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

  // Live storage line: what the origin uses now, against the browser's quota.
  // Best-effort — hidden where the Storage API is unavailable.
  function updateStorageLine(): void {
    void getStorageEstimate().then((est) => {
      const el = panel.querySelector('#offline-dl-storage') as HTMLElement | null;
      if (!el) return;
      if (!est) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.textContent = `Storage: ${formatBytes(est.usage)} used of ~${formatBytes(est.quota)}`;
    });
  }

  // Saved-regions manager — list with per-region layers/size and a delete action.
  function renderRegions(): void {
    const listEl = panel.querySelector('#offline-dl-regions') as HTMLElement | null;
    if (!listEl) return;
    const regions = loadRegions();
    if (regions.length === 0) { listEl.innerHTML = ''; return; }
    listEl.innerHTML =
      '<div class="offline-dl-regions__title">Saved regions</div>' +
      regions.map((r) => {
        const layerNames = r.layers.map((l) => REGION_LAYERS[l].label).join(', ');
        return (
          '<div class="offline-dl-regions__row">' +
          `  <span class="offline-dl-regions__name">${escapeHtml(r.name)}` +
          `    <small>${layerNames} &middot; z${r.zMin}&ndash;${r.zMax} &middot; ${formatBytes(r.bytes)}</small></span>` +
          `  <button class="offline-dl-regions__delete" data-region-id="${r.id}">Delete</button>` +
          '</div>'
        );
      }).join('');
    listEl.querySelectorAll<HTMLButtonElement>('.offline-dl-regions__delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset['regionId'];
        if (!id) return;
        btn.disabled = true;
        void deleteRegion(id, showToast).then(() => {
          renderRegions();
          updateStorageLine();
        });
      });
    });
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

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // don't trigger header collapse toggle
    closePanel(map);
  });

  // Collapse/expand toggle — tap header on mobile to minimize
  const headerEl = panel.querySelector('.offline-dl-panel__header') as HTMLElement;
  headerEl.addEventListener('click', (e) => {
    // Don't toggle when tapping the close button
    if ((e.target as HTMLElement).closest('.offline-dl-panel__close')) return;
    panel.classList.toggle('offline-dl-panel--collapsed');
  });

  // Re-estimate when the layer set changes.
  for (const id of Object.keys(REGION_LAYERS)) {
    panel.querySelector(`#offline-dl-layer-${id}`)
      ?.addEventListener('change', updateEstimate);
  }

  startBtn.addEventListener('click', () => {
    if (_downloadState !== 'selecting' || !_selectedBounds) return;
    const zMin = parseInt(zminInput.value, 10);
    const zMax = parseInt(zmaxInput.value, 10);
    const layers = selectedLayerIds(panel);
    if (layers.length === 0) return;
    void startDownload(map, _selectedBounds, zMin, zMax, layers, showToast)
      .then(() => { renderRegions(); updateStorageLine(); });
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

  // Initial estimate + saved-regions list + storage line
  setTimeout(() => {
    updateEstimate();
    renderRegions();
    updateStorageLine();
  }, 0);

  return panel;
}

/** Remove a saved region: delete its tiles from the region cache, then its manifest
 *  entry. Overlapping regions share tile URLs, so deleting one may remove tiles
 *  another region also covers (documented in ADR-007) — re-download to restore. */
async function deleteRegion(
  id: string,
  showToast: (msg: string, durationMs?: number) => void,
): Promise<void> {
  const region = loadRegions().find((r) => r.id === id);
  if (!region) return;
  try {
    const cache = await caches.open(REGION_TILE_CACHE_NAME);
    for (const layer of region.layers) {
      const urls = tileUrlsForLayer(layer, region.bounds, region.zMin, region.zMax);
      await Promise.all(urls.map((url) => cache.delete(url)));
    }
  } catch {
    // Cache API unavailable or delete failed — still drop the manifest entry so the
    // list reflects intent; orphaned tiles are harmless and bounded.
  }
  removeRegion(id);
  showToast(`Deleted ${region.name}`, 3000);
}

function setUiState(panel: HTMLElement, state: DownloadState): void {
  _downloadState = state;
  const startBtn = panel.querySelector('#offline-dl-start') as HTMLButtonElement | null;
  const cancelBtn = panel.querySelector('#offline-dl-cancel') as HTMLButtonElement | null;
  const progressEl = panel.querySelector('#offline-dl-progress') as HTMLElement | null;
  const zminInput = panel.querySelector('#offline-dl-zmin') as HTMLInputElement | null;
  const zmaxInput = panel.querySelector('#offline-dl-zmax') as HTMLInputElement | null;
  // The layer checkboxes freeze with the sliders — the selection is part of the
  // in-flight download's definition.
  const setLayerBoxes = (disabled: boolean): void => {
    panel.querySelectorAll<HTMLInputElement>('.offline-dl-layers input').forEach((box) => {
      box.disabled = disabled;
    });
  };

  switch (state) {
    case 'selecting':
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Download'; }
      if (cancelBtn) cancelBtn.textContent = 'Cancel';
      if (progressEl) progressEl.style.display = 'none';
      if (zminInput) zminInput.disabled = false;
      if (zmaxInput) zmaxInput.disabled = false;
      setLayerBoxes(false);
      break;
    case 'downloading':
      if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Downloading...'; }
      if (cancelBtn) cancelBtn.textContent = 'Stop';
      if (progressEl) progressEl.style.display = 'flex';
      if (zminInput) zminInput.disabled = true;
      if (zmaxInput) zmaxInput.disabled = true;
      setLayerBoxes(true);
      break;
    case 'done':
      if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Done'; }
      if (cancelBtn) cancelBtn.textContent = 'Close';
      if (zminInput) zminInput.disabled = true;
      if (zmaxInput) zmaxInput.disabled = true;
      setLayerBoxes(true);
      break;
  }
}

async function startDownload(
  map: L.Map,
  bounds: L.LatLngBounds,
  zMin: number,
  zMax: number,
  layers: RegionLayerId[],
  showToast: (msg: string, durationMs?: number) => void,
): Promise<void> {
  if (!_panelEl) return;
  setUiState(_panelEl, 'downloading');

  // Ask the browser to protect this origin's storage BEFORE committing megabytes to
  // it. Best-effort: a denial doesn't block the download, it just leaves the region
  // subject to browser-initiated eviction under storage pressure.
  const persisted = await requestPersistentStorage();

  const regionBounds = toRegionBounds(bounds);
  const urls = layers.flatMap((layer) => tileUrlsForLayer(layer, regionBounds, zMin, zMax));
  const fillEl = _panelEl.querySelector('#offline-dl-fill') as HTMLElement | null;
  const textEl = _panelEl.querySelector('#offline-dl-progress-text') as HTMLElement | null;

  const result = await downloadTiles(urls, (p) => {
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (textEl) textEl.textContent = `${pct}% (${p.done}/${p.total})`;
  });

  // Record coverage BEFORE any panel guard, and even for an aborted download:
  // every tile already written lives in the eviction-exempt region cache, so it
  // must appear in the region manager to stay deletable. Skipping the manifest
  // here would orphan those tiles with no reclamation path at all — region-tiles
  // has no ExpirationPlugin by design (ADR-007).
  const aborted = result.done < result.total;
  const newlyFetched = result.done - result.failed - result.cached;
  if (!aborted || newlyFetched > 0) {
    // Failed tiles are missing coverage, not a failed region — re-running the
    // same download skips what's cached and fills the gaps.
    const existing = loadRegions();
    const succeeded = result.done - result.failed;
    const estimates = estimateLayers(layers, regionBounds, zMin, zMax);
    const avgBytes = estimates.reduce((sum, e) => sum + e.bytes, 0) / Math.max(1, result.total);
    const region: SavedRegion = {
      id: `region-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name: nextRegionName(existing) + (aborted ? ' (partial)' : ''),
      bounds: regionBounds,
      zMin,
      zMax,
      layers,
      tileCount: succeeded,
      bytes: Math.round(succeeded * avgBytes),
      createdAt: Date.now(),
    };
    addRegion(region);
  }

  if (!_panelEl) return; // panel was closed during download

  setUiState(_panelEl, 'done');

  // Show cached region overlay on map
  showCachedOverlay(map, bounds);

  const persistNote = persisted ? '' : ' Storage persistence was declined — the browser may still evict under pressure.';
  const msg = result.failed > 0
    ? `Downloaded ${result.done - result.failed - result.cached} tiles (${result.cached} already cached, ${result.failed} failed).${persistNote}`
    : `Downloaded ${result.done - result.cached} new tiles (${result.cached} already cached).${persistNote}`;
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
  _controlEl?.classList.add(CONTROL_ACTIVE_CLASS);
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
  _controlEl?.classList.remove(CONTROL_ACTIVE_CLASS);
  _selectedBounds = null;
  _downloadState = 'selecting';
  // Keep cached overlay visible after close — intentional so user can see what's cached
  void map; // reference used by callers; lint-safe
}

export function addOfflineDownloadControl(
  map: L.Map,
  showToast: (msg: string, durationMs?: number) => void,
): void {
  // Closure-shared so onRemove can detach the listeners onAdd registered.
  let containerEl: HTMLElement | null = null;
  const Ctrl = L.Control.extend({
    onAdd(): HTMLElement {
      const container = L.DomUtil.create('div', 'leaflet-control-toggle ctrl-download') as HTMLDivElement;
      containerEl = container;
      _controlEl = container;
      container.title = 'Download: Select a region and zoom range to cache for offline use';

      const iconSpan = L.DomUtil.create('span', 'leaflet-control-toggle__icon') as HTMLSpanElement;
      iconSpan.id = 'offline-dl-btn';
      iconSpan.innerHTML = '&#x21E9;'; // downward arrow

      container.appendChild(iconSpan);

      const label = L.DomUtil.create('span', 'leaflet-control-toggle__label') as HTMLSpanElement;
      label.textContent = 'Download';
      const collapseAndPersist = setupCollapsibleLabel(container, label, 'webmap-ctrl-label-offline-dl');

      L.DomEvent.disableClickPropagation(container);

      function handleClick(): void {
        collapseAndPersist();
        openOfflineDownloadPanel(map, showToast);
      }

      // Collapse on tooltip-reveal triggers (hover, long-touch) — once any
      // of them fires the user has seen the affordance.
      L.DomEvent.on(container, 'mouseenter', collapseAndPersist);
      L.DomEvent.on(container, 'touchstart', collapseAndPersist);

      L.DomEvent.on(container, 'touchend', (e: Event) => {
        e.preventDefault();
        handleClick();
        e.stopImmediatePropagation();
      });
      L.DomEvent.on(container, 'click', (e: Event) => {
        handleClick();
        e.stopImmediatePropagation();
      });

      return container;
    },
    onRemove(): void {
      // L.DomEvent.off without a handler arg removes all Leaflet-managed listeners.
      if (containerEl) {
        L.DomEvent.off(containerEl);
        if (_controlEl === containerEl) _controlEl = null;
        containerEl = null;
      }
    },
  });

  new (Ctrl as new (opts: L.ControlOptions) => L.Control)({
    position: 'bottomleft',
  }).addTo(map);
}
