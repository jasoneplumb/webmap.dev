// Ambient type declarations for esri-leaflet-geocoder.
// If the package ships its own TypeScript types in a future version, delete this file.
import type L from 'leaflet';

export interface SearchResult {
  text: string;
  bounds: L.LatLngBounds;
  latlng: L.LatLng;
  properties: Record<string, unknown>;
}

export interface SearchResultsEvent {
  text: string;
  results: SearchResult[];
  bounds: L.LatLngBounds | null;
  latlng: L.LatLng | null;
}

export interface GeosearchOptions {
  placeholder?: string;
  title?: string;
  position?: L.ControlPosition;
  expanded?: boolean;
  useMapBounds?: boolean;
  zoomToResult?: boolean;
  providers?: unknown[];
  apikey?: string;
}

export interface ArcgisOnlineProviderOptions {
  maxResults?: number;
  apikey?: string;
}

export interface GeocodeServiceOptions {
  apikey: string;
}

export interface ReverseGeocodeResult {
  address: {
    Match_addr: string;
    [key: string]: string;
  };
  latlng: L.LatLng;
  score: number;
}

export interface GeocodeRequest {
  latlng(latlng: L.LatLng): this;
  run(
    callback: (
      error: Error | undefined,
      result: ReverseGeocodeResult | undefined,
    ) => void,
  ): this;
}

export interface GeocodeService {
  reverse(): GeocodeRequest;
}

export interface GeosearchControl {
  addTo(map: L.Map): this;
  on(event: 'results', fn: (e: SearchResultsEvent) => void): this;
}

declare module 'esri-leaflet-geocoder' {
  export function geosearch(options: GeosearchOptions): GeosearchControl;
  export function arcgisOnlineProvider(
    options?: ArcgisOnlineProviderOptions,
  ): unknown;
  export function geocodeService(options: GeocodeServiceOptions): GeocodeService;
}
