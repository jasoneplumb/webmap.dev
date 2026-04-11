/**
 * Intent: Map initialization — creates the Leaflet map, tile layers, and controls
 * Context: Called once from main.ts on startup; returns the configured L.Map instance used everywhere
 * Pattern: Tile layer refs are module-level so initOfflineTileFallback can attach error handlers
 * Future: Tile layer config (tokens, URLs, zoom limits) is hardcoded; no runtime layer switching beyond the built-in layer control
 */
import L from 'leaflet';
import { OSM_TILE_CACHE_NAME } from './sw-constants';

// Module-level tile layer refs — set during createMap(), read by initOfflineTileFallback()
let osmTileLayer: L.TileLayer | null = null;
let mapboxTileLayer: L.TileLayer | null = null;
let googleTileLayer: L.TileLayer | null = null;

// Tile error event shape (Leaflet fires this on tileerror but @types/leaflet may not expose it fully)
interface TileErrorEvent extends L.LeafletEvent {
  tile: HTMLImageElement;
  coords: { x: number; y: number; z: number };
  error: Error;
}

let tileWarnCooldown = false;

/** Wire up offline tile warnings and canvas-based lower-zoom fallback.
 *  Must be called after createMap(). Attaches tileerror handlers to all tile layers.
 *  Only the OSM layer (cached by the service worker) attempts canvas fallback;
 *  Mapbox/Google layers show the warning but serve no fallback (not SW-cached).
 */
export function initOfflineTileFallback(
  showToast: (msg: string, durationMs?: number) => void,
): void {
  const layers = [osmTileLayer, mapboxTileLayer, googleTileLayer].filter(
    (l): l is L.TileLayer => l !== null,
  );
  if (layers.length === 0) {
    console.warn('initOfflineTileFallback: no tile layers found — call createMap() first');
    return;
  }
  for (const layer of layers) {
    layer.on('tileerror', (e: L.LeafletEvent) => {
      void handleTileError(e as TileErrorEvent, layer === osmTileLayer, showToast);
    });
  }
}

async function handleTileError(
  e: TileErrorEvent,
  isOsmLayer: boolean,
  showToast: (msg: string, durationMs?: number) => void,
): Promise<void> {
  if (!navigator.onLine && !tileWarnCooldown) {
    tileWarnCooldown = true;
    const msg = isOsmLayer
      ? 'Some map tiles aren\u2019t cached for this area \u2014 zoom out for cached coverage. (Safari limits offline cache to ~50\u00a0MB.)'
      : 'Tiles unavailable offline \u2014 switch to Structures layer for offline coverage.';
    showToast(msg, 7000);
    setTimeout(() => {
      tileWarnCooldown = false;
    }, 10000);
  }

  if (!isOsmLayer || navigator.onLine || !('caches' in window) || e.tile.src.startsWith('data:')) return;

  const tile = e.tile;
  const coords = e.coords;
  const cache = await caches.open(OSM_TILE_CACHE_NAME);

  for (let dz = 1; dz <= 3; dz++) {
    const parentZ = coords.z - dz;
    if (parentZ < 1) break;
    const scale = Math.pow(2, dz);
    const parentX = Math.floor(coords.x / scale);
    const parentY = Math.floor(coords.y / scale);

    for (const sub of ['a', 'b', 'c']) {
      const url = `https://${sub}.tile.openstreetmap.org/${parentZ}/${parentX}/${parentY}.png`;
      try {
        const response = await cache.match(url);
        if (!response) continue;

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);

        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              URL.revokeObjectURL(objectUrl);
              reject(new Error('no 2d context'));
              return;
            }
            const subX = coords.x % scale;
            const subY = coords.y % scale;
            const srcSize = 256 / scale;
            ctx.drawImage(img, subX * srcSize, subY * srcSize, srcSize, srcSize, 0, 0, 256, 256);
            tile.src = canvas.toDataURL('image/png');
            URL.revokeObjectURL(objectUrl);
            resolve();
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('img load failed'));
          };
          img.src = objectUrl;
        });
        return; // success — stop searching
      } catch {
        // try next subdomain / zoom level
      }
    }
  }
}

export function createMap(): L.Map {
  const map = L.map('map', {
    zoomControl: false,
    preferCanvas: true,
    // constraint: fractional zoom (0.5 steps) required for smooth pinch-to-zoom on mobile; integer steps feel jarring
    zoomSnap: 0.5,
    zoomDelta: 0.5,
  }).fitWorld();

  // Tile loading indicator — shows spinner while tiles are fetching
  let loadingTimer: ReturnType<typeof setTimeout> | undefined;
  const createLoadingIndicator = (): HTMLElement => {
    const indicator = L.DomUtil.create('div');
    indicator.id = 'tile-loading';
    indicator.style.position = 'absolute';
    indicator.style.top = '10px';
    indicator.style.right = '10px';
    indicator.style.width = '20px';
    indicator.style.height = '20px';
    indicator.style.border = '2px solid rgba(100, 100, 100, 0.3)';
    indicator.style.borderTop = '2px solid rgba(100, 100, 100, 0.8)';
    indicator.style.borderRadius = '50%';
    indicator.style.animation = 'tile-loading-spin 1s linear infinite';
    indicator.style.zIndex = '1000';
    indicator.style.display = 'none';
    return indicator;
  };

  const loadingIndicator = createLoadingIndicator();
  map.getContainer().appendChild(loadingIndicator);

  map.on('loading', () => {
    if (loadingTimer !== undefined) clearTimeout(loadingTimer);
    loadingIndicator.style.display = 'block';
  });

  map.on('load', () => {
    // Debounce the hide to avoid flashing on rapid tile loads
    if (loadingTimer !== undefined) clearTimeout(loadingTimer);
    loadingTimer = setTimeout(() => {
      loadingIndicator.style.display = 'none';
    }, 300);
  });

  // Subtle zoom level indicator in bottom-left corner
  const ZoomViewer = L.Control.extend({
    onAdd(m: L.Map) {
      const container = L.DomUtil.create('div');
      const gauge = L.DomUtil.create('div');
      container.style.width = '200px';
      container.style.background = 'rgba(255,255,255,0.0)';
      container.style.textAlign = 'right';
      container.style.opacity = '0.15';
      m.on('zoomstart zoom zoomend', () => {
        gauge.innerHTML = 'Zoom level: ' + m.getZoom().toFixed(1);
      });
      container.appendChild(gauge);
      return container;
    },
  });
  new (ZoomViewer as new (opts: L.ControlOptions) => L.Control)({
    position: 'bottomleft',
  }).addTo(map);

  L.control.scale({ position: 'bottomleft' }).addTo(map);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  map.setZoom(2);

  // tradeoff: Mapbox requires a token but provides the best outdoor/trail data.
  // OSM is the anonymous fallback; Google satellite is included for imagery context.
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
  // keepBuffer: extra tiles to cache beyond the viewport (smoother panning)
  // updateWhenZooming: false defers tile loads during pinch-zoom animation
  const tilePerf = { keepBuffer: 3, updateWhenZooming: false } as const;

  mapboxTileLayer = L.tileLayer(
    `https://api.mapbox.com/styles/v1/mapbox/outdoors-v11/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`,
    {
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 18,
      maxNativeZoom: 18,
      minZoom: 2,
      minNativeZoom: 2,
      ...tilePerf,
    },
  );

  osmTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 18,
    maxNativeZoom: 18,
    minZoom: 2,
    minNativeZoom: 2,
    ...tilePerf,
  }).addTo(map);

  googleTileLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 18,
    maxNativeZoom: 18,
    minZoom: 2,
    minNativeZoom: 2,
    ...tilePerf,
  });

  const baseMaps = { Imagery: googleTileLayer, Structures: osmTileLayer, Topo: mapboxTileLayer };
  L.control.layers(baseMaps, undefined, { position: 'topleft' }).addTo(map);

  return map;
}
