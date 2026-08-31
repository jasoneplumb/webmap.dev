import { describe, expect, it } from 'vitest';
import L from 'leaflet';
import { geometryOf } from './tile-grid';
import { isBasemapTileUrl } from './sw-constants';

describe('geometryOf', () => {
  it('passes a numeric tileSize through', () => {
    const layer = L.tileLayer('https://example.com/{z}/{x}/{y}.png', { tileSize: 512 });
    expect(geometryOf(layer).tileSize).toBe(512);
  });

  it('falls back to 256 when tileSize is a Point rather than a number', () => {
    // Leaflet types tileSize as number | Point. Every layer in this app configures a
    // number; a Point would otherwise land in the grid math as NaN-adjacent nonsense.
    const layer = L.tileLayer('https://example.com/{z}/{x}/{y}.png', {
      tileSize: L.point(512, 512),
    });
    expect(geometryOf(layer).tileSize).toBe(256);
  });

  it('falls back to 256 when tileSize is unset', () => {
    const layer = L.tileLayer('https://example.com/{z}/{x}/{y}.png');
    expect(geometryOf(layer).tileSize).toBe(256);
  });

  it('carries the native-zoom clamps through', () => {
    const layer = L.tileLayer('https://example.com/{z}/{x}/{y}.png', {
      tileSize: 256,
      minNativeZoom: 2,
      maxNativeZoom: 18,
    });
    expect(geometryOf(layer)).toEqual({ tileSize: 256, minNativeZoom: 2, maxNativeZoom: 18 });
  });

  it('leaves absent native-zoom clamps undefined rather than inventing a default', () => {
    // maxNativeZoom decides seam SPACING — a base clamped to z18 shows z18 tiles
    // scaled 2x at map zoom 19, so its seams are twice as far apart. Substituting a
    // default here would draw the grid at the wrong density for an unclamped layer.
    const geometry = geometryOf(L.tileLayer('https://example.com/{z}/{x}/{y}.png'));
    expect(geometry.minNativeZoom).toBeUndefined();
    expect(geometry.maxNativeZoom).toBeUndefined();
  });
});

describe('isBasemapTileUrl', () => {
  const matches = (href: string): boolean => isBasemapTileUrl(new URL(href));

  it('matches the bare tile hosts', () => {
    expect(matches('https://server.arcgisonline.com/ArcGIS/rest/services/x/MapServer/tile/1/2/3')).toBe(true);
    expect(matches('https://tile.waymarkedtrails.org/hiking/12/1/2.png')).toBe(true);
  });

  it('matches subdomained tile hosts', () => {
    expect(matches('https://a.tile.thunderforest.com/cycle/12/1/2.png?apikey=k')).toBe(true);
    expect(matches('https://b.tile-cyclosm.openstreetmap.fr/cyclosm-lite/12/1/2.png')).toBe(true);
    expect(matches('https://a.tile.openstreetmap.fr/hot/12/1/2.png')).toBe(true);
  });

  it('matches Terrarium elevation only under its own prefix', () => {
    expect(matches('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1/2.png')).toBe(true);
    expect(matches('https://s3.amazonaws.com/some-other-bucket/12/1/2.png')).toBe(false);
  });

  it('does not match a host that merely ends with a tile host as a suffix', () => {
    // The reason this tests endsWith('.' + host) and not includes(host).
    expect(matches('https://evil-tile.thunderforest.com.attacker.example/1/2/3.png')).toBe(false);
    expect(matches('https://nottile.thunderforest.com.example/1/2/3.png')).toBe(false);
  });

  it('declines Thunderforest tiles with no usable key', () => {
    // A keyless request returns HTTP 200 with a placeholder image rather than a 4xx,
    // so onlyReadable can't catch it and CacheFirst would pin it for 30 days.
    expect(matches('https://a.tile.thunderforest.com/cycle/12/1/2.png')).toBe(false);
    expect(matches('https://a.tile.thunderforest.com/cycle/12/1/2.png?apikey=')).toBe(false);
  });

  it('still caches Thunderforest tiles that carry a key', () => {
    expect(matches('https://a.tile.thunderforest.com/outdoors/12/1/2.png?apikey=abc123')).toBe(true);
  });

  it('leaves openstreetmap.org to the OSM route', () => {
    // .org, not .fr — these belong to the separate osm-tiles cache that the region
    // pre-download writes into, and must not be pulled into the basemap cache.
    expect(matches('https://a.tile.openstreetmap.org/12/1/2.png')).toBe(false);
  });

  it('does not match the geocoder, which is NetworkOnly', () => {
    expect(matches('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/find')).toBe(false);
  });
});
