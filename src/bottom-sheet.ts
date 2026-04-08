// Intent: Mobile bottom sheet / desktop side panel for displaying location info.
// Pattern: Module-level state; call initInfoPanel(map) once from main.ts before
//          showSheet() can be used. On mobile (≤768px), renders as a three-snap-point
//          bottom sheet with drag gesture support. On desktop (>768px), renders as a
//          left-side slide-in panel.
import L from 'leaflet';

export type SnapPoint = 'hidden' | 'peek' | 'half' | 'full';

export interface SheetContent {
  title: string;
  subtitle?: string;
  /** Pre-escaped HTML string. Callers MUST escape all user-derived content before passing. */
  bodyHtml: string;
}

const MOBILE_BREAKPOINT = 768;
// Sheet occupies 90vh on mobile (partially revealed via translateY)
const SHEET_VH = 0.9;
const HALF_VH = 0.45;
const PEEK_PX = 72; // visible px at peek snap

// Module state
let _map: L.Map | null = null;
let _el: HTMLElement | null = null;
let _snap: SnapPoint = 'hidden';
let _mapOffsetPx = 0; // accumulated panBy offset so we can reverse it

// Drag state (mobile only)
let _isDragging = false;
let _dragStartY = 0;
let _dragStartSnap: SnapPoint = 'hidden';

function isMobile(): boolean {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function fullHeightPx(): number {
  return Math.round(window.innerHeight * SHEET_VH);
}

// Returns translateY value (px) for each snap point.
// 0 = fully visible; fullHeightPx()+8 = fully off-screen below.
function snapToPx(snap: SnapPoint): number {
  const h = fullHeightPx();
  switch (snap) {
    case 'hidden':
      return h + 8;
    case 'peek':
      return h - PEEK_PX;
    case 'half':
      return h - Math.round(window.innerHeight * HALF_VH);
    case 'full':
      return 0;
  }
}

// Pan map to compensate for sheet height, then track the accumulated offset
// so we can undo it when the sheet snaps to a different position.
function setMapOffset(targetPx: number): void {
  if (_map === null) return;
  const delta = targetPx - _mapOffsetPx;
  if (delta !== 0) {
    _map.panBy(L.point(0, delta), { animate: true, duration: 0.3 });
    _mapOffsetPx = targetPx;
  }
}

function snapTo(snap: SnapPoint, animated = true): void {
  if (_el === null) return;
  _snap = snap;

  if (isMobile()) {
    const px = snapToPx(snap);
    _el.style.transition = animated ? 'transform 0.3s ease' : 'none';
    _el.style.transform = `translateY(${px}px)`;
    // Shift map center upward when sheet is at half height so the POI stays visible
    const offset = snap === 'half' ? Math.round(window.innerHeight * HALF_VH / 3) : 0;
    setMapOffset(offset);
  } else {
    _el.classList.toggle('info-panel--visible', snap !== 'hidden');
    setMapOffset(0);
  }

  _el.setAttribute('aria-hidden', String(snap === 'hidden'));
}

// ── Touch / drag handlers ────────────────────────────────────────────────────

function onHandleTouchStart(e: TouchEvent): void {
  if (!isMobile()) return;
  const touch = e.touches[0];
  if (touch === undefined) return;
  _isDragging = true;
  _dragStartY = touch.clientY;
  _dragStartSnap = _snap;
  if (_el) _el.style.transition = 'none';
  // Add non-passive touchmove only while dragging to avoid blocking scroll elsewhere
  document.addEventListener('touchmove', onDocTouchMove, { passive: false });
}

function onDocTouchMove(e: TouchEvent): void {
  if (!_isDragging || _snap === 'hidden' || _el === null) return;
  const touch = e.touches[0];
  if (touch === undefined) return;
  const delta = touch.clientY - _dragStartY;
  const basePx = snapToPx(_dragStartSnap);
  const maxPx = fullHeightPx() + 8;
  const newPx = Math.max(0, Math.min(maxPx, basePx + delta));
  _el.style.transform = `translateY(${newPx}px)`;
  e.preventDefault(); // passive: false on listener — prevents page scroll during drag
}

function onDocTouchEnd(e: TouchEvent): void {
  if (!_isDragging) return;
  _isDragging = false;
  document.removeEventListener('touchmove', onDocTouchMove);
  const touch = e.changedTouches[0];
  if (touch === undefined) {
    snapTo(_dragStartSnap);
    return;
  }

  const delta = touch.clientY - _dragStartY;
  const downOrder: SnapPoint[] = ['full', 'half', 'peek', 'hidden'];
  const upOrder: SnapPoint[] = ['hidden', 'peek', 'half', 'full'];
  let target: SnapPoint;

  if (delta > 60) {
    // Swipe down → next lower snap
    const idx = downOrder.indexOf(_dragStartSnap);
    target = downOrder[idx + 1] ?? 'hidden';
  } else if (delta < -60) {
    // Swipe up → next higher snap
    const idx = upOrder.indexOf(_dragStartSnap);
    target = upOrder[idx + 1] ?? 'full';
  } else {
    target = _dragStartSnap;
  }

  snapTo(target);
}

// ── Zoom heuristics ──────────────────────────────────────────────────────────

function zoomForAddrType(addrType: string): number {
  switch (addrType) {
    case 'PointAddress':
    case 'StreetAddress':
    case 'SubAddress':
    case 'StreetInt':
      return 17;
    case 'Locality':
    case 'Neighborhood':
    case 'Sublocality':
      return 14;
    case 'City':
    case 'Municipal':
      return 12;
    case 'Region':
    case 'State':
    case 'Province':
      return 8;
    case 'Country':
      return 5;
    default:
      return 15;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function initInfoPanel(map: L.Map): void {
  _map = map;

  const el = document.createElement('div');
  el.id = 'info-panel';
  el.className = 'info-panel';
  el.setAttribute('role', 'complementary');
  el.setAttribute('aria-label', 'Location information');
  el.setAttribute('aria-hidden', 'true');

  el.innerHTML =
    '<div class="info-panel__handle-area">' +
    '  <div class="info-panel__handle" aria-hidden="true"></div>' +
    '</div>' +
    '<div class="info-panel__header">' +
    '  <div>' +
    '    <div class="info-panel__title"></div>' +
    '    <div class="info-panel__subtitle"></div>' +
    '  </div>' +
    '  <button class="info-panel__close" aria-label="Close">&#x2715;</button>' +
    '</div>' +
    '<div class="info-panel__body"></div>';

  // Set initial off-screen position before appending (prevents flash)
  el.style.transition = 'none';
  el.style.transform = `translateY(${fullHeightPx() + 8}px)`;

  document.body.appendChild(el);
  _el = el;

  // Close button
  const closeBtn = el.querySelector('.info-panel__close') as HTMLButtonElement;
  closeBtn.addEventListener('click', () => snapTo('hidden'));

  // Drag handle (mobile)
  const handleArea = el.querySelector('.info-panel__handle-area') as HTMLElement;
  handleArea.addEventListener('touchstart', onHandleTouchStart, { passive: true });
  // touchmove is registered dynamically in onHandleTouchStart (passive: false, only during drag)
  document.addEventListener('touchend', onDocTouchEnd, { passive: true });

  // On device rotation the sheet height changes; reset the accumulated map offset
  // so setMapOffset computes the correct delta from the new geometry.
  window.addEventListener('resize', () => {
    _mapOffsetPx = 0;
    snapTo(_snap, false);
  });

  // Keyboard dismiss
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && _snap !== 'hidden') snapTo('hidden');
  });

  const bodyEl = el.querySelector('.info-panel__body') as HTMLElement;

  // Event delegation: click a result item → fly to its location
  bodyEl.addEventListener('click', (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-lat]');
    if (target === null || _map === null) return;
    const lat = parseFloat(target.dataset['lat'] ?? '');
    const lng = parseFloat(target.dataset['lng'] ?? '');
    if (isNaN(lat) || isNaN(lng)) return;
    const boundsRaw = target.dataset['bounds'] ?? '';
    if (boundsRaw !== '') {
      try {
        const parsed = JSON.parse(boundsRaw) as unknown;
        if (Array.isArray(parsed) && parsed.length === 2 &&
            Array.isArray(parsed[0]) && Array.isArray(parsed[1])) {
          _map.flyToBounds(L.latLngBounds(parsed as [[number, number], [number, number]]), { padding: [50, 50], maxZoom: 17 });
        } else {
          _map.flyTo(L.latLng(lat, lng), zoomForAddrType(target.dataset['addrType'] ?? ''));
        }
      } catch {
        _map.flyTo(L.latLng(lat, lng), zoomForAddrType(target.dataset['addrType'] ?? ''));
      }
    } else {
      _map.flyTo(L.latLng(lat, lng), zoomForAddrType(target.dataset['addrType'] ?? ''));
    }
    snapTo('peek');
  });

  // Event delegation: click a copy button → write to clipboard
  bodyEl.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
    if (btn === null) return;
    const text = btn.dataset['copy'] ?? '';
    navigator.clipboard.writeText(text).catch((err: unknown) => {
      alert(String(err));
    });
  });
}

// Show the panel with new content. If already open, keeps the current snap point.
// If hidden, opens to `initialSnap` (defaults to 'half').
export function showSheet(content: SheetContent, initialSnap: SnapPoint = 'half'): void {
  if (_el === null) return;
  const titleEl = _el.querySelector('.info-panel__title');
  const subtitleEl = _el.querySelector('.info-panel__subtitle');
  const bodyEl = _el.querySelector('.info-panel__body');
  if (titleEl) titleEl.textContent = content.title;
  if (subtitleEl) subtitleEl.textContent = content.subtitle ?? '';
  if (bodyEl) bodyEl.innerHTML = content.bodyHtml;
  snapTo(_snap === 'hidden' ? initialSnap : _snap);
}

export function hideSheet(): void {
  snapTo('hidden');
}
