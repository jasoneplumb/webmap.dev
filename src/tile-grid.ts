/**
 * Intent: Zero-latency wireframe of the active base map's tile grid, drawn only while zooming
 * Context: The raster layers defer loading until a zoom settles (deferTileLoadsUntilZoomEnds in map.ts),
 *          so mid-gesture the user would otherwise see nothing but one stretched stale level. This
 *          draws the TARGET zoom's tile seams immediately, giving the gesture crisp structure that is
 *          already correct for where the zoom is landing.
 * Pattern: A GridLayer whose createTile returns a bare bordered div — synchronous, no network, and
 *          positioned on Leaflet's own tile geometry, so it aligns with the raster grid by
 *          construction rather than by arithmetic we would have to keep in sync.
 * Future: Geometry is pushed in from map.ts on base change; the layer does not know about layer defs.
 */
import L from 'leaflet';

/** Leaflet grid-layer internals that @types/leaflet doesn't declare. */
interface GridLayerInternals {
  _resetGrid(): void;
  _map: L.Map | undefined;
}

/**
 * The subset of a base layer's options that decides where its tile seams fall.
 *
 * Note zoomOffset is absent on purpose. It is a TileLayer option that only rewrites
 * the `z` in the tile URL — GridLayer's own grid math never reads it — so the 512/-1
 * bases lay out 512px cells exactly as a plain 512 layer would. Seam spacing is
 * tileSize and the native-zoom clamp, nothing else.
 */
export interface TileGridGeometry {
  tileSize: number;
  minNativeZoom?: number;
  maxNativeZoom?: number;
}

/**
 * How many real tiles wide each drawn cell is.
 *
 * Tile grids nest on powers of two and share the world origin, so scaling the cell
 * by an integer factor still lands every line on a genuine tile seam — it just draws
 * one seam in four instead of all of them. A full-density grid at 256px cells was
 * too busy to read during a gesture; this keeps the alignment cue and drops the noise.
 */
const GRID_CELL_TILE_SPAN = 4;

export class TileGridLayer extends L.GridLayer {
  // @types/leaflet types the inherited `options` as the base LayerOptions; re-declare
  // it so the grid fields this class mutates are visible.
  declare options: L.GridLayerOptions;

  /**
   * Declared with no parameters on purpose: Leaflet checks `createTile.length < 2`
   * and, seeing no `done` callback, treats the tile as synchronous and marks it ready
   * on the next animation frame. That is what makes this layer effectively free —
   * there is nothing to await, so it can stay eager while the raster layers defer.
   */
  createTile(): HTMLElement {
    return L.DomUtil.create('div', 'tile-grid-cell');
  }

  /**
   * Re-point the wireframe at a different base map's tile geometry.
   *
   * maxNativeZoom matters as much as tileSize here: a base clamped to native z18 is
   * showing z18 tiles scaled 2x at map zoom 19, so its real seams are twice as far
   * apart as an unclamped grid would draw them.
   *
   * Options are mutated in place, then _resetGrid recomputes the cell size and origin
   * that _update reads — redraw() alone would rebuild tiles against the stale grid.
   */
  setGeometry(geometry: TileGridGeometry): void {
    const opts = this.options;
    const cellSize = geometry.tileSize * GRID_CELL_TILE_SPAN;
    if (
      opts.tileSize === cellSize &&
      opts.minNativeZoom === geometry.minNativeZoom &&
      opts.maxNativeZoom === geometry.maxNativeZoom
    ) {
      return;
    }
    opts.tileSize = cellSize;
    opts.minNativeZoom = geometry.minNativeZoom;
    opts.maxNativeZoom = geometry.maxNativeZoom;

    const internals = this as unknown as GridLayerInternals;
    if (internals._map) {
      internals._resetGrid();
      this.redraw();
    }
  }
}

/**
 * Read the seam geometry off a base tile layer. tileSize is typed `number | Point`
 * by Leaflet; every layer in this app configures it as a number, so a non-number is
 * treated as Leaflet's own 256 default rather than guessed at.
 */
export function geometryOf(base: L.TileLayer): TileGridGeometry {
  const opts = base.options;
  return {
    tileSize: typeof opts.tileSize === 'number' ? opts.tileSize : 256,
    minNativeZoom: opts.minNativeZoom,
    maxNativeZoom: opts.maxNativeZoom,
  };
}

/**
 * The wireframe sits in overlayPane, not tilePane, so it stays clear of the
 * mix-blend-mode overlays (.multiply-blend, .overlay-blend) that composite against
 * whatever is beneath them in the tile pane — a blended grid would shift colour with
 * the base map instead of reading as a constant hairline.
 */
export function createTileGridLayer(): TileGridLayer {
  return new TileGridLayer({
    className: 'tile-grid',
    pane: 'overlayPane',
    tileSize: 256 * GRID_CELL_TILE_SPAN,
    minZoom: 2,
    maxZoom: 19,
    // Deliberately NOT given the deferred-zoom override the raster layers get, and
    // deliberately left at Leaflet's eager updateWhenZooming default: costing no
    // network is the whole point, so it should snap to the target zoom at once.
    keepBuffer: 1,
  });
}
