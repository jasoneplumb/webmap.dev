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
let cycleLayer: L.TileLayer | null = null;
let cycleBlendLayer: L.TileLayer | null = null;
let outdoorsLayer: L.TileLayer | null = null;
let humanitarianLayer: L.TileLayer | null = null;
let satelliteLayer: L.TileLayer | null = null;
let hillshadeLayer: L.TileLayer | null = null;
let hikingLayer: L.TileLayer | null = null;
let cyclingLayer: L.TileLayer | null = null;
// Tile error event shape (Leaflet fires this on tileerror but @types/leaflet may not expose it fully)
interface TileErrorEvent extends L.LeafletEvent {
  tile: HTMLImageElement;
  coords: { x: number; y: number; z: number };
  error: Error;
}

// Single cooldown shared across all layers — intentional: one toast per 10 s regardless
// of which layer fired, so a Thunderforest error followed immediately by an OSM error doesn't
// show two toasts. The per-layer message is set when the cooldown first trips.
let tileWarnCooldown = false;

// Opened once on first use; reused for every subsequent tile error lookup.
let osmCachePromise: Promise<Cache> | null = null;

/** Wire up offline tile warnings and canvas-based lower-zoom fallback.
 *  Must be called after createMap(). Attaches tileerror handlers to the base/overlay
 *  tile layers; the Routes overlay (a LayerGroup) is intentionally excluded — its
 *  Waymarked tiles aren't SW-cached, so a fallback/warning would be moot.
 *  Only the OSM layer (cached by the service worker) attempts canvas fallback;
 *  Non-OSM layers (Thunderforest, Esri) show the warning but serve no fallback (not SW-cached).
 */
export function initOfflineTileFallback(
  showToast: (msg: string, durationMs?: number) => void,
): void {
  const layers = [osmStreetsLayer, cycleLayer, cycleBlendLayer, outdoorsLayer, humanitarianLayer, satelliteLayer, hillshadeLayer].filter(
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

  // Thunderforest trail bases (free API key in VITE_THUNDERFOREST_TOKEN). Two
  // dedicated, reliable trail-styled bases: Cycle (OpenCycleMap — bike routes &
  // infrastructure) and Outdoors (hiking trails + terrain). The key is a public
  // client-side token; referrer-restrict it to the deploy origin in the
  // Thunderforest dashboard. Without a key these layers return error tiles.
  const tfKey = import.meta.env.VITE_THUNDERFOREST_TOKEN ?? '';
  if (!tfKey) {
    console.warn(
      'VITE_THUNDERFOREST_TOKEN is not set — the Cycle/Outdoors trail bases will ' +
      'return error tiles. Set it in your .env file.',
    );
  }
  // Thunderforest terms require crediting both the map style and the OSM data (ODbL).
  const tfAttribution = 'Maps © Thunderforest, Data © OpenStreetMap contributors';
  cycleLayer = L.tileLayer(
    'https://{s}.tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=' + tfKey,
    {
      attribution: tfAttribution,
      ...stdConfig,
    },
  );
  outdoorsLayer = L.tileLayer(
    'https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=' + tfKey,
    {
      attribution: tfAttribution,
      ...stdConfig,
    },
  );

  // Cycle base tiles reused as an overlay: multiply blend turns the style's
  // light ground colors near-transparent so its route ink composites over any
  // base (e.g. bike routes over Satellite). See .multiply-blend in style.css.
  cycleBlendLayer = L.tileLayer(
    'https://{s}.tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=' + tfKey,
    {
      attribution: tfAttribution,
      className: 'multiply-blend',
      ...stdConfig,
    },
  );

  // Waymarked route highlights — transparent overlays that compose over any base.
  // Exposed as TWO independent toggles (Hiking routes / Cycling routes) rather
  // than one combined layer: Waymarked colors routes by network hierarchy, not by
  // activity, so the only way to see hiking-only segments is to switch cycling off.
  // Kept out of the base layer so a route-tile failure can never blank the map;
  // share stdConfig geometry so routes scale 1:1 with the base.
  hikingLayer = L.tileLayer(
    'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png',
    { attribution: '© waymarkedtrails.org', ...stdConfig },
  );
  cyclingLayer = L.tileLayer(
    'https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png',
    { attribution: '© waymarkedtrails.org', ...stdConfig },
  );

  humanitarianLayer = L.tileLayer(
    'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    {
      attribution: '© OpenStreetMap contributors',
      ...stdConfig,
    },
  );

  // Esri World Imagery — same free ArcGIS Online host as the hillshade layer,
  // no API key required. Native 256px tiles, so it skips stdConfig's 512/offset
  // scheme. Global coverage tops out around z18; metro areas go deeper but 18
  // keeps behavior uniform.
  satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Esri, Maxar, Earthstar Geographics',
      tileSize: 256,
      zoomOffset: 0,
      maxZoom: 18,
      maxNativeZoom: 18,
      minZoom: 2,
      minNativeZoom: 2,
      ...tilePerf,
    },
  );

  hillshadeLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Esri',
      // multiply: flat/lit pixels (near-white) pass through; slopes darken. See .multiply-blend in style.css.
      className: 'multiply-blend',
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
  cycleLayer: L.TileLayer;
  cycleBlendLayer: L.TileLayer;
  outdoorsLayer: L.TileLayer;
  humanitarianLayer: L.TileLayer;
  satelliteLayer: L.TileLayer;
  hillshadeLayer: L.TileLayer;
  hikingLayer: L.TileLayer;
  cyclingLayer: L.TileLayer;
} {
  if (!osmStreetsLayer || !cycleLayer || !cycleBlendLayer || !outdoorsLayer || !humanitarianLayer || !satelliteLayer || !hillshadeLayer || !hikingLayer || !cyclingLayer) {
    throw new Error('Tile layers not initialized — call createMap() first');
  }
  return {
    osmStreetsLayer,
    cycleLayer,
    cycleBlendLayer,
    outdoorsLayer,
    humanitarianLayer,
    satelliteLayer,
    hillshadeLayer,
    hikingLayer,
    cyclingLayer,
  };
}
