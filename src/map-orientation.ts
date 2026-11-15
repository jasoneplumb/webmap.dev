/**
 * Intent: Turn the map so the user's heading points up the screen (direction-up, #366)
 * Context: ADR-009 mechanism — #map becomes a square that covers the viewport at any bearing
 *          and is turned with a CSS transform. Leaflet keeps working in the unrotated
 *          container frame; only the input and "keep upright" edges are patched.
 * Pattern: Prototype patches installed once before createMap(), an instance hook on the map,
 *          and updateMapOrientation(state) called whenever the drawn heading changes.
 *
 * North-up is left exactly as it was before this module existed: the container geometry,
 * the control DOM and every patched method behave as stock Leaflet until the first time
 * direction-up actually turns the map.
 *
 * The applied bearing lives here rather than in AppState because the prototype patches
 * below run inside Leaflet with no state in reach — the same reason guidance.ts keeps its
 * banner element at module level. AppState holds the user's choice (orientationMode).
 */
import L from 'leaflet';
import type { AppState } from './types';
import {
  BEARING_STEP_DEG,
  correctDragOffset,
  coveringSquareSide,
  effectiveOrientationMode,
  nextMapBearing,
  parseOrientationMode,
  pivotPanOffset,
  screenToContainer,
  type MapOrientationMode,
} from './map-rotation';

const MODE_STORAGE_KEY = 'webmap-orientation-mode';

/** Markers that draw a bearing in map space and must turn WITH the map, not stay upright. */
const ROTATES_WITH_MAP = ['blue-dot', 'cue-heading-arrow', 'custom-zone-arrow'];

/** Bearing currently applied to the container; 0 whenever rotation is off. */
let bearingDeg = 0;
/** True while #map is the oversized square — the whole time direction-up is in effect. */
let rotationOn = false;
/**
 * False until the map has been turned once. Until then the marker and popup patches write
 * nothing at all, so a session that stays north-up leaves no trace on Leaflet's elements.
 */
let hasRotated = false;
let mapRef: L.Map | null = null;

interface DraggableInternals {
  _startPos: L.Point;
  _newPos: L.Point;
  _parentScale?: { x: number; y: number };
  _updatePosition(): void;
}

interface MarkerInternals {
  _icon?: HTMLElement | null;
  _shadow?: HTMLElement | null;
  options: L.MarkerOptions;
  _setPos(pos: L.Point): void;
}

interface PopupInternals {
  _container?: HTMLElement;
  _containerLeft?: number;
  _containerBottom?: number;
  _updatePosition(): void;
}

interface MapInternals {
  _controlContainer?: HTMLElement;
  _popup?: L.Popup | null;
}

/** The orientation the user last chose. Missing, unreadable or unknown values are north-up. */
export function loadOrientationMode(): MapOrientationMode {
  try {
    return parseOrientationMode(localStorage.getItem(MODE_STORAGE_KEY));
  } catch {
    return 'north-up';
  }
}

/**
 * Flip the user's orientation choice, persist it, and apply it. Returns the new choice.
 * The choice is kept even when it cannot take effect (no compass grant), so it is what
 * the next grant or the next load starts from.
 */
export function toggleOrientationMode(state: AppState): MapOrientationMode {
  state.orientationMode = state.orientationMode === 'north-up' ? 'direction-up' : 'north-up';
  try {
    localStorage.setItem(MODE_STORAGE_KEY, state.orientationMode);
  } catch { /* localStorage unavailable — the choice still holds for this session */ }
  updateMapOrientation(state);
  return state.orientationMode;
}

/** Append a counter-rotation about the element's own anchor to the transform Leaflet wrote. */
function counterRotate(el: HTMLElement | null | undefined, originX: number, originY: number): void {
  if (!el || !hasRotated) return;
  if (bearingDeg === 0) {
    el.style.transformOrigin = '';
    return;
  }
  el.style.transformOrigin = `${originX}px ${originY}px`;
  el.style.transform += ` rotate(${-bearingDeg}deg)`;
}

function marginOrigin(el: HTMLElement): [number, number] {
  // Leaflet places an icon's anchor with negative margins, so the anchor in the icon's own
  // box is minus those margins.
  return [-parseFloat(el.style.marginLeft || '0'), -parseFloat(el.style.marginTop || '0')];
}

/**
 * Prototype patches. MUST run before any marker, popup or draggable exists.
 *
 * These reach into Leaflet private methods (Draggable._updatePosition, Marker._setPos,
 * Popup._updatePosition), under the same exact-version pin as the GridLayer patches in
 * map.ts. Each one defers to the original and adds nothing while the bearing is 0.
 */
export function installRotationPatches(): void {
  const dragProto = L.Draggable.prototype as unknown as DraggableInternals;
  const origUpdate = dragProto._updatePosition;
  dragProto._updatePosition = function (this: DraggableInternals): void {
    if (bearingDeg !== 0 && this._parentScale) {
      const off = this._newPos.subtract(this._startPos);
      const fixed = correctDragOffset(off, this._parentScale, bearingDeg);
      this._newPos = this._startPos.add(L.point(fixed.x, fixed.y));
    }
    origUpdate.call(this);
  };

  const markerProto = L.Marker.prototype as unknown as MarkerInternals;
  const origSetPos = markerProto._setPos;
  markerProto._setPos = function (this: MarkerInternals, pos: L.Point): void {
    origSetPos.call(this, pos);
    const classes = (this.options.icon?.options.className ?? '').split(/\s+/);
    if (ROTATES_WITH_MAP.some((c) => classes.includes(c))) return;
    if (this._icon) counterRotate(this._icon, ...marginOrigin(this._icon));
    if (this._shadow) counterRotate(this._shadow, ...marginOrigin(this._shadow));
  };

  const popupProto = L.Popup.prototype as unknown as PopupInternals;
  const origPopupUpdate = popupProto._updatePosition;
  popupProto._updatePosition = function (this: PopupInternals): void {
    origPopupUpdate.call(this);
    const el = this._container;
    if (!el) return;
    // The popup's tip sits at (-left, height + bottom) in its own box; turn it about there.
    counterRotate(el, -(this._containerLeft ?? 0), el.offsetHeight + (this._containerBottom ?? 0));
  };
}

/**
 * Move Leaflet's controls out of the map container into an unrotated sibling layer, so
 * they do not turn with the map. Done once, the first time the map is about to turn, and
 * not undone: the layer sits where the controls always were, so north-up afterwards looks
 * the same. The layer carries the container classes leaflet.css scopes control styles to.
 */
function detachControls(map: L.Map): void {
  const controls = (map as unknown as MapInternals)._controlContainer;
  if (!controls || controls.parentElement?.classList.contains('map-ui-layer')) return;
  const container = map.getContainer();
  // Directly after #map rather than at the end of <body>: overlays appended to <body> later
  // (the toast, dialogs) share z-index levels with the controls and rely on DOM order to
  // paint above them, as they did when the controls were inside the map.
  const ui = L.DomUtil.create('div', 'leaflet-container map-ui-layer');
  container.insertAdjacentElement('afterend', ui);
  for (const cls of ['leaflet-touch', 'leaflet-retina']) {
    if (container.classList.contains(cls)) ui.classList.add(cls);
  }
  ui.appendChild(controls);
}

/** Container geometry: the covering square while rotation is on, the stylesheet's box otherwise. */
function applyGeometry(map: L.Map): void {
  const el = map.getContainer();
  document.body.classList.toggle('map-rotated', rotationOn);
  if (rotationOn) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const side = coveringSquareSide(w, h);
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.width = `${side}px`;
    el.style.height = `${side}px`;
    el.style.left = `${(w - side) / 2}px`;
    el.style.top = `${(h - side) / 2}px`;
    el.style.transformOrigin = '50% 50%';
    el.style.transform = `rotate(${bearingDeg}deg)`;
  } else {
    // Remove exactly what was set above, and nothing else the container may carry inline.
    for (const prop of ['right', 'bottom', 'width', 'height', 'left', 'top', 'transform-origin', 'transform']) {
      el.style.removeProperty(prop);
    }
  }
  // Default pan: true keeps the geographic centre at the container centre, which is also
  // the viewport centre because the square grows symmetrically about it.
  map.invalidateSize();
}

/** Re-run the upright counter-rotation on everything already placed. */
function refreshUpright(map: L.Map): void {
  map.eachLayer((layer) => {
    // Marker.update() re-runs _setPos; @types/leaflet omits it.
    if (layer instanceof L.Marker) (layer as unknown as { update(): void }).update();
  });
  (map as unknown as MapInternals)._popup?.update();
}

/**
 * Turn rotation on or off and set the bearing, holding `pivot` still on screen.
 *
 * The container turns about the viewport centre, so a pivot away from the centre would
 * swing round it; the map is panned by the difference so the turn reads as being about the
 * pivot instead. Geometry is only touched when rotation switches on or off — a bearing step
 * is one transform write, not a resize and a tile reload.
 */
function setRotation(map: L.Map, on: boolean, deg: number, pivot: L.LatLng | null): void {
  const next = on ? deg : 0;
  if (on === rotationOn && next === bearingDeg) return;

  let pan: { x: number; y: number } | null = null;
  if (pivot !== null) {
    const p = map.latLngToContainerPoint(pivot);
    const size = map.getSize();
    pan = pivotPanOffset({ x: p.x - size.x / 2, y: p.y - size.y / 2 }, bearingDeg, next);
  }

  const geometryChanged = on !== rotationOn;
  if (on && !hasRotated) {
    hasRotated = true;
    detachControls(map);
  }
  rotationOn = on;
  bearingDeg = next;
  if (geometryChanged) applyGeometry(map);
  else map.getContainer().style.transform = `rotate(${bearingDeg}deg)`;

  if (pan !== null && (Math.abs(pan.x) > 0.5 || Math.abs(pan.y) > 0.5)) {
    map.panBy([pan.x, pan.y], { animate: false });
  }
  refreshUpright(map);
}

/** Instance wiring. Call once, after createMap(). */
export function attachMapOrientation(map: L.Map): void {
  mapRef = map;
  const container = map.getContainer();

  // Every Leaflet input path that needs a container point — map clicks and contextmenu
  // (pin drop), canvas hit-testing, pinch, wheel, box zoom — goes through this method.
  const stockMouseEventToContainerPoint = map.mouseEventToContainerPoint.bind(map);
  map.mouseEventToContainerPoint = (e: MouseEvent): L.Point => {
    if (!rotationOn) return stockMouseEventToContainerPoint(e);
    const rect = container.getBoundingClientRect();
    const p = screenToContainer(
      { x: e.clientX, y: e.clientY },
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: container.offsetWidth, y: container.offsetHeight },
      bearingDeg,
    );
    return L.point(p.x - container.clientLeft, p.y - container.clientTop);
  };

  window.addEventListener('resize', () => {
    if (rotationOn) applyGeometry(map);
  });
}

/**
 * Bring the map's rotation in line with the orientation mode and the heading currently
 * drawn on the position marker. Cheap when nothing changes, so it is safe to call from
 * the heading indicator at orientation-event rate. A no-op until attachMapOrientation().
 */
export function updateMapOrientation(state: AppState): void {
  const map = mapRef;
  if (map === null) return;
  const pivot = state.youAreHereLocation;

  const mode = effectiveOrientationMode(state.compassPermission === 'granted', state.orientationMode);
  if (mode === 'north-up') {
    setRotation(map, false, 0, pivot);
    return;
  }
  // No heading yet: there is nothing to point up, so the map stays as it is.
  const heading = state.shownHeadingDeg;
  if (heading === null) return;
  setRotation(map, true, nextMapBearing(bearingDeg, heading, BEARING_STEP_DEG), pivot);
}
