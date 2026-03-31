// Intent: Map initialization — creates the Leaflet map, tile layers, and controls
// Pattern: Returns the configured map instance; all tile layers stay local to avoid
//          leaking references that callers don't need
import L from 'leaflet';

export function createMap(): L.Map {
  const map = L.map('map', {
    zoomControl: false,
    preferCanvas: true,
    zoomSnap: 0,
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

  const elevationWithTrails = L.tileLayer(
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

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 18,
    maxNativeZoom: 18,
    minZoom: 2,
    minNativeZoom: 2,
    ...tilePerf,
  }).addTo(map);

  const gsi = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 18,
    maxNativeZoom: 18,
    minZoom: 2,
    minNativeZoom: 2,
    ...tilePerf,
  });

  const baseMaps = { Imagery: gsi, Structures: osm, Topo: elevationWithTrails };
  L.control.layers(baseMaps, undefined, { position: 'topleft' }).addTo(map);

  return map;
}
