/**
 * Intent: Client-side hillshade computed from Terrarium elevation tiles with a
 *         south-east sun (azimuth 150°), so shading matches the real shadows in
 *         the Satellite base's imagery (~10:30 am capture, northern hemisphere)
 * Context: Replaces the pre-rendered Esri World Hillshade, whose fixed NW light
 *          is roughly opposite the imagery's sun and can't be re-lit client-side
 *          (the NW-facing range is compressed into a few near-white values)
 * Pattern: Pure decode/shade functions (unit-tested) + a Leaflet GridLayer that
 *          fetches AWS Open Data Terrarium tiles (free, key-less, z0–15) and
 *          paints shaded canvas tiles; overzoom past 15 crops the z15 ancestor
 * Future: Azimuth is fixed; southern-hemisphere imagery is sunlit from the north,
 *         so a latitude-dependent azimuth flip is a possible refinement
 */
import L from 'leaflet';

export const HILLSHADE_AZIMUTH_DEG = 150; // SSE — matches mid-morning imagery sun
export const HILLSHADE_NW_AZIMUTH_DEG = 315; // classic cartographic convention
export const HILLSHADE_ALTITUDE_DEG = 45;

const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const TERRARIUM_MAX_ZOOM = 15;
const TILE_PX = 256;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Decode one Terrarium pixel to meters: (r*256 + g + b/256) - 32768. */
export function terrariumToMeters(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Ground meters per pixel for a 256px tile at this zoom/latitude. */
export function metersPerPixel(zoom: number, latDeg: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((latDeg * Math.PI) / 180)) / (TILE_PX * Math.pow(2, zoom));
}

/** Latitude of a tile row's center (Web Mercator). */
export function tileCenterLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/**
 * Horn hillshade over an elevation grid, normalized so flat terrain is white
 * (255) — the value the multiply blend passes through untouched. Slopes facing
 * the sun clip to white; slopes facing away darken. Border pixels reuse their
 * nearest interior gradient (replicate padding) — a one-pixel approximation
 * that avoids fetching neighbor tiles.
 */
export function shadeElevationGrid(
  elev: Float32Array,
  width: number,
  height: number,
  cellSizeM: number,
  azimuthDeg: number = HILLSHADE_AZIMUTH_DEG,
  altitudeDeg: number = HILLSHADE_ALTITUDE_DEG,
): Uint8ClampedArray {
  const zenith = ((90 - altitudeDeg) * Math.PI) / 180;
  // Convert compass azimuth (clockwise from north) to math angle (counter-clockwise from east)
  const azimuthMath = ((360 - azimuthDeg + 90) % 360) * (Math.PI / 180);
  const cosZenith = Math.cos(zenith);
  const sinZenith = Math.sin(zenith);
  const out = new Uint8ClampedArray(width * height);

  const at = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
    const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
    return elev[cy * width + cx] as number;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Horn's method: 3×3 weighted differences
      const dzdx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))) /
        (8 * cellSizeM);
      const dzdy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))) /
        (8 * cellSizeM);
      const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade =
        cosZenith * Math.cos(slope) + sinZenith * Math.sin(slope) * Math.cos(azimuthMath - aspect);
      // Normalize so flat (shade = cosZenith) renders white; clamp handles sun-facing overshoot
      out[y * width + x] = Math.round(Math.max(0, Math.min(1, shade / cosZenith)) * 255);
    }
  }
  return out;
}

/** Decode a Terrarium RGBA buffer into meters. */
export function decodeTerrarium(rgba: Uint8ClampedArray, pixelCount: number): Float32Array {
  const elev = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    elev[i] = terrariumToMeters(
      rgba[i * 4] as number,
      rgba[i * 4 + 1] as number,
      rgba[i * 4 + 2] as number,
    );
  }
  return elev;
}

/**
 * GridLayer that paints SE-lit hillshade tiles from Terrarium elevation data.
 * Past z15 (Terrarium's max) the z15 ancestor is shaded, then the child's
 * quadrant is cropped and scaled — mirroring TileLayer's maxNativeZoom behavior.
 */
export class HillshadeLayer extends L.GridLayer {
  private azimuthDeg = HILLSHADE_AZIMUTH_DEG;

  /** Switch the sun direction and re-render all visible tiles. */
  setAzimuth(azimuthDeg: number): void {
    if (azimuthDeg === this.azimuthDeg) return;
    this.azimuthDeg = azimuthDeg;
    this.redraw();
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('canvas');
    tile.width = TILE_PX;
    tile.height = TILE_PX;
    void this.paintTile(tile, coords)
      .then(() => done(undefined, tile))
      .catch((err: Error) => done(err, tile));
    return tile;
  }

  private async paintTile(tile: HTMLCanvasElement, coords: L.Coords): Promise<void> {
    const dz = Math.max(0, coords.z - TERRARIUM_MAX_ZOOM);
    const scale = Math.pow(2, dz);
    const z = coords.z - dz;
    const x = Math.floor(coords.x / scale);
    const y = Math.floor(coords.y / scale);

    const resp = await fetch(`${TERRARIUM_URL}/${z}/${x}/${y}.png`);
    if (!resp.ok) throw new Error(`terrarium tile ${z}/${x}/${y}: HTTP ${resp.status}`);
    const bitmap = await createImageBitmap(await resp.blob());

    const src = document.createElement('canvas');
    src.width = TILE_PX;
    src.height = TILE_PX;
    const srcCtx = src.getContext('2d');
    if (!srcCtx) throw new Error('no 2d context');
    srcCtx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const rgba = srcCtx.getImageData(0, 0, TILE_PX, TILE_PX).data;
    const elev = decodeTerrarium(rgba, TILE_PX * TILE_PX);
    const shade = shadeElevationGrid(
      elev, TILE_PX, TILE_PX, metersPerPixel(z, tileCenterLat(y, z)), this.azimuthDeg,
    );

    const gray = srcCtx.createImageData(TILE_PX, TILE_PX);
    for (let i = 0; i < shade.length; i++) {
      const v = shade[i] as number;
      gray.data[i * 4] = v;
      gray.data[i * 4 + 1] = v;
      gray.data[i * 4 + 2] = v;
      gray.data[i * 4 + 3] = 255;
    }
    srcCtx.putImageData(gray, 0, 0);

    const ctx = tile.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    if (dz === 0) {
      ctx.drawImage(src, 0, 0);
    } else {
      const subSize = TILE_PX / scale;
      const subX = (coords.x % scale) * subSize;
      const subY = (coords.y % scale) * subSize;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(src, subX, subY, subSize, subSize, 0, 0, TILE_PX, TILE_PX);
    }
  }
}

export function createHillshadeLayer(options: L.GridLayerOptions): HillshadeLayer {
  return new HillshadeLayer(options);
}
