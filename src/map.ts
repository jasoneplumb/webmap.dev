// Intent: Map initialization — creates the Leaflet map, tile layers, and controls
// Pattern: Returns the configured map instance; all tile layers stay local to avoid
//          leaking references that callers don't need
import L from 'leaflet';

export function createMap(): L.Map {
  const map = L.map('map', {
    zoomControl: false,
    preferCanvas: true,
  }).fitWorld();

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
        gauge.innerHTML = 'Zoom level: ' + m.getZoom();
      });
      container.appendChild(gauge);
      return container;
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  new (ZoomViewer as new (opts: L.ControlOptions) => L.Control)({
    position: 'bottomleft',
  }).addTo(map);

  L.control.scale({ position: 'bottomleft' }).addTo(map);
  L.control.zoom({ position: 'bottomleft' }).addTo(map);
  map.setZoom(2);

  // tradeoff: Mapbox requires a token but provides the best outdoor/trail data.
  // OSM is the anonymous fallback; Google satellite is included for imagery context.
  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
  const elevationWithTrails = L.tileLayer(
    `https://api.mapbox.com/styles/v1/mapbox/outdoors-v11/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`,
    {
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 18,
      maxNativeZoom: 18,
      minZoom: 2,
      minNativeZoom: 2,
    },
  ).addTo(map);

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 18,
    maxNativeZoom: 18,
    minZoom: 2,
    minNativeZoom: 2,
  });

  const gsi = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 18,
    maxNativeZoom: 18,
    minZoom: 2,
    minNativeZoom: 2,
  });

  const baseMaps = { Imagery: gsi, Streets: osm, Trails: elevationWithTrails };
  L.control.layers(baseMaps, undefined, { position: 'bottomright' }).addTo(map);

  return map;
}
