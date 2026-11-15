/**
 * Intent: Pure geometry and mode rules for turning the map (direction-up, #366)
 * Context: map-orientation.ts applies `transform: rotate(bearing)` to #map, sized to a square
 *          that covers the viewport at any bearing. Leaflet keeps working in the unrotated
 *          container frame; these functions translate between that frame and the screen, and
 *          decide which bearing the map should have. See ADR-009.
 * Pattern: No DOM and no map — plain values in, plain values out, so vitest covers them.
 *
 * Conventions: screen and container coordinates are CSS pixels, y down. A positive bearing
 * is a clockwise CSS rotation of the container, which is what `rotate(<deg>)` does.
 */
import { shortestArcDeg } from './geo';

export interface Vec {
  readonly x: number;
  readonly y: number;
}

/** How the map is oriented: north at the top, or the user's heading at the top. */
export type MapOrientationMode = 'north-up' | 'direction-up';

/** The map turns only when the heading has moved more than this from the applied bearing. */
export const BEARING_STEP_DEG = 5;

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

/** Anything but the exact stored token reads as north-up, the behaviour before #366. */
export function parseOrientationMode(raw: string | null): MapOrientationMode {
  return raw === 'direction-up' ? 'direction-up' : 'north-up';
}

/**
 * Direction-up needs a compass: without a grant the map is north-up whatever was stored.
 * The stored value is left alone, so a later grant restores the user's choice.
 */
export function effectiveOrientationMode(
  compassGranted: boolean,
  stored: MapOrientationMode,
): MapOrientationMode {
  return compassGranted && stored === 'direction-up' ? 'direction-up' : 'north-up';
}

/**
 * Bearing the map should have so `headingDeg` points up the screen, with hysteresis: the
 * applied bearing is kept until the heading has moved more than `thresholdDeg` from it.
 *
 * The container is turned clockwise by the bearing, so heading H points up at bearing -H.
 * The result is unwrapped (applied + shortest arc) rather than normalised, so a turn through
 * north is a small step and never a jump of nearly 360.
 */
export function nextMapBearing(appliedDeg: number, headingDeg: number, thresholdDeg: number): number {
  const d = shortestArcDeg(appliedDeg, -headingDeg);
  return Math.abs(d) > thresholdDeg ? appliedDeg + d : appliedDeg;
}

/**
 * Pan (as Leaflet's panBy offset, container pixels) that keeps a pivot fixed on screen while
 * the container turns from `fromDeg` to `toDeg` about its own centre.
 *
 * `pivotFromCenter` is the pivot's offset from the container centre in the container frame.
 * Its screen offset is rotate(v, bearing); holding that constant across the turn means the
 * pivot must sit at rotate(v, from - to) afterwards, and panBy(o) moves a point from p to p - o.
 */
export function pivotPanOffset(pivotFromCenter: Vec, fromDeg: number, toDeg: number): Vec {
  const after = rotateVec(pivotFromCenter, fromDeg - toDeg);
  return { x: pivotFromCenter.x - after.x, y: pivotFromCenter.y - after.y };
}
