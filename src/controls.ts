// Intent: Reusable toggle control for map toolbar icons
// Context: The original code redefined L.Control.Watermark three times (each definition
//          overwrote the previous one). This replaces that with a single parameterized factory.
// Pattern: Factory function creates a fresh L.Control subclass per control instance,
//          capturing config in a closure to avoid shared state between controls.
import L from 'leaflet';
import type { LocateState } from './types';

interface ToggleControlConfig {
  id: string;
  disabledSrc: string;
  disabledTitle: string;
  position: L.ControlPosition;
  onClick: (e: Event) => void;
}

// tradeoff: Using a factory function rather than a class to avoid the complexity of
// typing L.Control.extend() return values in strict TypeScript. The per-call closure
// captures config cleanly without needing instance properties.
function makeToggleControl(config: ToggleControlConfig): L.Control {
  const Ctrl = L.Control.extend({
    onAdd(): HTMLElement {
      const container = L.DomUtil.create('div') as HTMLDivElement;
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'center';
      container.style.minWidth = '44px';
      container.style.minHeight = '44px';
      container.style.background = 'rgba(255, 255, 255, 0.85)';
      container.style.borderRadius = '4px';
      container.style.boxShadow = '0 1px 5px rgba(0, 0, 0, 0.65)';
      container.style.cursor = 'pointer';
      container.style.userSelect = 'none';

      const img = L.DomUtil.create('img') as HTMLImageElement;
      img.id = config.id;
      img.style.width = '30px';
      img.style.height = '30px';
      img.alt = img.title = config.disabledTitle;
      img.src = config.disabledSrc;

      container.appendChild(img);

      // touchend + preventDefault prevents the browser from synthesizing a click event,
      // which would fire the handler twice on mobile. click alone handles desktop.
      L.DomEvent.on(container, 'touchend', (e: Event) => {
        e.preventDefault();
        config.onClick(e);
        e.stopImmediatePropagation();
      });
      L.DomEvent.on(container, 'click', (e: Event) => {
        config.onClick(e);
        e.stopImmediatePropagation();
      });

      return container;
    },
    onRemove(): void {
      const el = document.getElementById(config.id);
      if (el && el.parentElement) L.DomEvent.off(el.parentElement);
    },
  });

  return new (Ctrl as new (opts: L.ControlOptions) => L.Control)({
    position: config.position,
  });
}

export function addClipboardControl(map: L.Map, onClick: (e: Event) => void): void {
  makeToggleControl({
    id: 'clip',
    disabledSrc: '/copy-pin-to-clipboard-lines-v1.1.svg',
    disabledTitle: 'Copy dropped pin to clipboard (Disabled)',
    position: 'topleft',
    onClick,
  }).addTo(map);
}

// Three-state locate button: Off → Active (following) → Passive (dot only)
// Icon mapping: off=lines, active=color, passive=bw
export function addLocateControl(map: L.Map, onClick: (e: Event) => void): void {
  makeToggleControl({
    id: 'locate',
    disabledSrc: '/locate-arrow-lines.svg',
    disabledTitle: 'Locate (Off)',
    position: 'topleft',
    onClick,
  }).addTo(map);
}

// Updates the locate button icon to reflect current state
export function updateLocateIcon(locateState: LocateState): void {
  const img = document.getElementById('locate') as HTMLImageElement | null;
  if (!img) return;
  switch (locateState) {
    case 'off':
      img.alt = img.title = 'Locate (Off)';
      img.src = '/locate-arrow-lines.svg';
      break;
    case 'active':
      img.alt = img.title = 'Locate (Following)';
      img.src = '/locate-arrow-color.svg';
      break;
    case 'passive':
      img.alt = img.title = 'Locate (Passive — tap to re-center)';
      img.src = '/locate-arrow-bw.svg';
      break;
  }
}

export function addTrackingControl(map: L.Map, onClick: (e: Event) => void): void {
  makeToggleControl({
    id: 'tracking',
    disabledSrc: '/logging-lines-v1.1.svg',
    disabledTitle: 'Tracking Toggle (Disabled)',
    position: 'topleft',
    onClick,
  }).addTo(map);
}
