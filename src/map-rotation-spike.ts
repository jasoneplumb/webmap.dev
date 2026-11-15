/**
 * Intent: THROWAWAY SPIKE for #366 — rotate the whole map by a fixed bearing
 * Context: Mechanism (b) from the ADR: #map becomes a square covering the viewport at any
 *          bearing and is turned with a CSS transform. Leaflet keeps working in the
 *          unrotated container frame; only the input and "keep upright" edges are patched.
 * Pattern: Prototype patches installed once before createMap(), plus an instance hook on the
 *          map. Not production code — see docs/adr for what this spike did and did not prove.
 *
 * Bearing comes from `?rotate=<deg>` (default 45 on this branch; `?rotate=0` disables).
 */
import L from 'leaflet';
import { correctDragOffset, coveringSquareSide, screenToContainer } from './map-rotation';

let bearingDeg = 0;

/** Markers that draw a bearing in map space and must turn WITH the map, not stay upright. */
const ROTATES_WITH_MAP = ['blue-dot', 'cue-heading-arrow', 'custom-zone-arrow'];

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

export function spikeBearingFromUrl(search: string): number {
  const raw = new URLSearchParams(search).get('rotate');
  const n = raw === null ? 45 : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Append a counter-rotation about the element's own anchor to the transform Leaflet wrote. */
function counterRotate(el: HTMLElement | null | undefined, originX: number, originY: number): void {
  if (!el) return;
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

/** Prototype patches. MUST run before any marker, popup or draggable exists. */
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
    const cls = this.options.icon?.options.className ?? '';
    if (ROTATES_WITH_MAP.some((c) => cls.split(/\s+/).includes(c))) return;
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

function sizeContainer(map: L.Map): void {
  const el = map.getContainer();
  document.body.classList.toggle('map-rotated', bearingDeg !== 0);
  if (bearingDeg === 0) {
    el.style.cssText = '';
  } else {
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
  }
  // Default pan: true keeps the geographic centre at the container centre, which is also
  // the viewport centre because the square grows symmetrically about it.
  map.invalidateSize();
}

/** Instance wiring. Call once, right after createMap(). */
export function attachRotation(map: L.Map, deg: number): void {
  const container = map.getContainer();

  // Every Leaflet input path that needs a container point — map clicks and contextmenu
  // (pin drop), canvas hit-testing, pinch, wheel, box zoom — goes through this method.
  map.mouseEventToContainerPoint = (e: MouseEvent): L.Point => {
    const rect = container.getBoundingClientRect();
    const p = screenToContainer(
      { x: e.clientX, y: e.clientY },
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { x: container.offsetWidth, y: container.offsetHeight },
      bearingDeg,
    );
    return L.point(p.x - container.clientLeft, p.y - container.clientTop);
  };

  // Controls must not turn with the map. Leaflet keeps them in one element; move it to an
  // unrotated layer that carries the container classes leaflet.css scopes control styles to.
  const internals = map as unknown as MapInternals;
  const controls = internals._controlContainer;
  if (controls) {
    const ui = L.DomUtil.create('div', 'leaflet-container map-ui-layer', document.body);
    for (const cls of ['leaflet-touch', 'leaflet-retina']) {
      if (container.classList.contains(cls)) ui.classList.add(cls);
    }
    ui.appendChild(controls);
  }

  window.addEventListener('resize', () => sizeContainer(map));
  setBearing(map, deg);
}

export function setBearing(map: L.Map, deg: number): void {
  bearingDeg = deg;
  sizeContainer(map);
  // Re-run the upright counter-rotation on everything already placed.
  map.eachLayer((layer) => {
    // Marker.update() re-runs _setPos; @types/leaflet omits it.
    if (layer instanceof L.Marker) (layer as unknown as { update(): void }).update();
  });
  (map as unknown as MapInternals)._popup?.update();
}
