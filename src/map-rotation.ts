/**
 * Intent: Pure geometry for rotating the map by turning an oversized container (SPIKE, #366)
 * Context: map-rotation-spike.ts applies `transform: rotate(bearing)` to #map, sized to a square
 *          that covers the viewport at any bearing. Leaflet keeps working in the unrotated
 *          container frame; these functions translate between that frame and the screen.
 * Pattern: No DOM, no Leaflet — plain numbers in, plain numbers out, so vitest covers them.
 *
 * Conventions: screen and container coordinates are CSS pixels, y down. A positive bearing
 * is a clockwise CSS rotation of the container, which is what `rotate(<deg>)` does.
 */

export interface Vec {
  readonly x: number;
  readonly y: number;
}

/**
 * Side of the square container that still covers a `w` x `h` viewport after rotating by
 * any angle about its centre: the viewport diagonal, rounded up to whole pixels.
 */
export function coveringSquareSide(w: number, h: number): number {
  return Math.ceil(Math.hypot(w, h));
}

/**
 * Rotate a vector clockwise by `deg` in a y-down frame — the same mapping CSS
 * `rotate(<deg>)` applies to an element's points about its transform origin.
 */
export function rotateVec(v: Vec, deg: number): Vec {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * Screen (client) point to a point in the unrotated container frame.
 *
 * `screenCenter` is the centre of the container's bounding client rect. An element rotated
 * about its own centre keeps that centre, so this holds at every bearing without needing
 * the viewport size. `size` is the container's untransformed size (offsetWidth/Height).
 */
export function screenToContainer(screen: Vec, screenCenter: Vec, size: Vec, bearingDeg: number): Vec {
  const local = rotateVec({ x: screen.x - screenCenter.x, y: screen.y - screenCenter.y }, -bearingDeg);
  return { x: local.x + size.x / 2, y: local.y + size.y / 2 };
}

/** Inverse of screenToContainer. */
export function containerToScreen(point: Vec, screenCenter: Vec, size: Vec, bearingDeg: number): Vec {
  const turned = rotateVec({ x: point.x - size.x / 2, y: point.y - size.y / 2 }, bearingDeg);
  return { x: turned.x + screenCenter.x, y: turned.y + screenCenter.y };
}

/**
 * Correct a drag offset Leaflet's Draggable computed in screen space.
 *
 * Draggable divides the raw client delta by its parent's "scale", which it reads as
 * boundingRect.width / offsetWidth — on a rotated square that is |cos| + |sin|, not 1, so
 * the offset arrives shrunk as well as unrotated. Undo the division, then turn the screen
 * delta into the container frame.
 */
export function correctDragOffset(leafletOffset: Vec, parentScale: Vec, bearingDeg: number): Vec {
  const raw = { x: leafletOffset.x * parentScale.x, y: leafletOffset.y * parentScale.y };
  return rotateVec(raw, -bearingDeg);
}

/**
 * Fraction of extra tile area the covering square asks Leaflet to fill, relative to the
 * viewport itself. Reported in the ADR as the network and memory cost of this mechanism.
 */
export function tileAreaRatio(w: number, h: number): number {
  const side = coveringSquareSide(w, h);
  return (side * side) / (w * h);
}
