/**
 * Intent: Map initialization — creates the Leaflet map, tile layers, and controls
 * Context: Called once from main.ts on startup; returns the configured L.Map instance used everywhere
 * Pattern: Tile layer refs are module-level so initOfflineTileFallback can attach error handlers
 * Future: Tile layer config (tokens, URLs, zoom limits) is hardcoded; no runtime layer switching beyond the built-in layer control
 */
import L from 'leaflet';
import { OSM_TILE_CACHE_NAME } from './sw-constants';

// Module-level tile layer refs — set during createMap(), read by initOfflineTileFallback()
let osmStreetsLayer: L.TileLayer | null = null;
let cyclosmLayer: L.TileLayer | null = null;
let opentopoLayer: L.TileLayer | null = null;
let humanitarianLayer: L.TileLayer | null = null;
let hillshadeLayer: L.TileLayer | null = null;
// Tile error event shape (Leaflet fires this on tileerror but @types/leaflet may not expose it fully)
interface TileErrorEvent extends L.LeafletEvent {
  tile: HTMLImageElement;
  coords: { x: number; y: number; z: number };
  error: Error;
}

// Single cooldown shared across all layers — intentional: one toast per 10 s regardless
// of which layer fired, so a Mapbox error followed immediately by an OSM error doesn't
// show two toasts. The per-layer message is set when the cooldown first trips.
let tileWarnCooldown = false;

// Opened once on first use; reused for every subsequent tile error lookup.
let osmCachePromise: Promise<Cache> | null = null;

/** Wire up offline tile warnings and canvas-based lower-zoom fallback.
 *  Must be called after createMap(). Attaches tileerror handlers to all tile layers.
 *  Only the OSM layer (cached by the service worker) attempts canvas fallback;
 *  Mapbox/Google layers show the warning but serve no fallback (not SW-cached).
 */
export function initOfflineTileFallback(
  showToast: (msg: string, durationMs?: number) => void,
): void {
  const layers = [osmStreetsLayer, cyclosmLayer, opentopoLayer, humanitarianLayer, hillshadeLayer].filter(
    (l): l is L.TileLayer => l !== null,
  );
  if (layers.length === 0) {
    console.warn('initOfflineTileFallback: no tile layers found — call createMap() first');
    return;
  }
  if ('caches' in window) {
    osmCachePromise = caches.open(OSM_TILE_CACHE_NAME);
  }
  for (const layer of layers) {
    layer.on('tileerror', (e: L.LeafletEvent) => {
      void handleTileError(e as TileErrorEvent, layer === osmStreetsLayer, showToast);
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

  if (!isOsmLayer || navigator.onLine || osmCachePromise === null || e.tile.src.startsWith('data:')) return;

  const tile = e.tile;
  const coords = e.coords;
  const cache = await osmCachePromise;

  for (let dz = 1; dz <= 3; dz++) {
    const parentZ = coords.z - dz;
    if (parentZ < 1) break;
    const scale = Math.pow(2, dz);
    const parentX = Math.floor(coords.x / scale);
    const parentY = Math.floor(coords.y / scale);

    // Check all three subdomains in parallel — parent tile is on exactly one of them
    const subUrls = ['a', 'b', 'c'].map(
      sub => `https://${sub}.tile.openstreetmap.org/${parentZ}/${parentX}/${parentY}.png`,
    );
    const responses = await Promise.all(subUrls.map(url => cache.match(url)));
    const response = responses.find(Boolean);
    if (response !== undefined) {
      try {

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);

        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            // OSM tiles are 256×256; the layer uses tileSize:512 so Leaflet stretches
            // the img element to 512 CSS px — fallback tiles will look blurrier than
            // normal tiles, which is expected and acceptable for degraded offline UX.
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
        // blob or canvas failed — try next zoom level
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
    maxZoom: 18,
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

  L.control.scale({ position: 'bottomleft' }).addTo(map);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  // Move the auto-added attribution into the bottom-left cluster too
  if (map.attributionControl) map.attributionControl.setPosition('bottomleft');
  map.setZoom(2);

  // All layers are now free, community-maintained OSM sources
  // keepBuffer: extra tiles to cache beyond the viewport (smoother panning)
  // updateWhenZooming: false defers tile loads during pinch-zoom animation
  const tilePerf = { keepBuffer: 3, updateWhenZooming: false } as const;
  const stdConfig = {
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 20,
    maxNativeZoom: 18,
    minZoom: 2,
    minNativeZoom: 2,
    ...tilePerf,
  };

  osmStreetsLayer = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      attribution: '© OpenStreetMap contributors',
      ...stdConfig,
    },
  );

  cyclosmLayer = L.tileLayer(
    'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    {
      attribution: '© OpenStreetMap contributors, Carto',
      ...stdConfig,
    },
  );

  opentopoLayer = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    {
      attribution: '© OpenStreetMap contributors, Carto',
      ...stdConfig,
      maxNativeZoom: 17,
    },
  );

  humanitarianLayer = L.tileLayer(
    'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    {
      attribution: '© OpenStreetMap contributors',
      ...stdConfig,
    },
  );

  hillshadeLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Esri',
      opacity: 0.4,
      tileSize: 256,
      zoomOffset: 0,
      maxZoom: 18,
      maxNativeZoom: 16,
      minZoom: 2,
      minNativeZoom: 2,
      ...tilePerf,
    },
  );


  return map;
}

export function getTileLayers(): {
  osmStreetsLayer: L.TileLayer;
  cyclosmLayer: L.TileLayer;
  opentopoLayer: L.TileLayer;
  humanitarianLayer: L.TileLayer;
  hillshadeLayer: L.TileLayer;
} {
  if (!osmStreetsLayer || !cyclosmLayer || !opentopoLayer || !humanitarianLayer || !hillshadeLayer) {
    throw new Error('Tile layers not initialized — call createMap() first');
  }
  return {
    osmStreetsLayer,
    cyclosmLayer,
    opentopoLayer,
    humanitarianLayer,
    hillshadeLayer,
  };
}
