/**
 * Intent: Reusable toggle control for map toolbar icons
 * Context: The original code redefined L.Control.Watermark three times, each overwriting the previous; replaced with a single parameterized factory
 * Pattern: Factory function creates a fresh L.Control subclass per call, capturing config in a closure to avoid shared state between controls
 * Future: Only supports toggle-style icon buttons; would need extension for controls with text labels or multi-state visuals beyond icon swaps
 */
import L from 'leaflet';
import type { LocateState } from './types';

interface ToggleControlConfig {
  id: string;
  disabledSrc: string;
  disabledTitle: string;
  position: L.ControlPosition;
  onClick: (e: Event) => void;
  label?: string;
}

// tradeoff: Using a factory function rather than a class to avoid the complexity of
// typing L.Control.extend() return values in strict TypeScript. The per-call closure
// captures config cleanly without needing instance properties.
export function makeToggleControl(config: ToggleControlConfig): L.Control {
  const Ctrl = L.Control.extend({
    onAdd(): HTMLElement {
      const container = L.DomUtil.create('div', 'leaflet-control-toggle') as HTMLDivElement;

      const img = L.DomUtil.create('img') as HTMLImageElement;
      img.id = config.id;
      img.alt = img.title = config.disabledTitle;
      img.src = config.disabledSrc;

      container.appendChild(img);

      if (config.label) {
        const label = L.DomUtil.create('span', 'leaflet-control-toggle__label') as HTMLSpanElement;
        label.textContent = config.label;
        container.appendChild(label);
      }

      // Prevent click, dblclick, and touchstart from bubbling to the map,
      // so button interactions don't accidentally trigger map handlers (e.g. pin drop on dblclick).
      L.DomEvent.disableClickPropagation(container);

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

// Three-state locate button: Off → Active (following) → Passive (dot only)
// Icon mapping: off=lines, active=color, passive=bw
export function addLocateControl(map: L.Map, onClick: (e: Event) => void): void {
  makeToggleControl({
    id: 'locate',
    disabledSrc: '/locate-arrow-lines.svg',
    disabledTitle: 'Locate: Center map on your GPS location',
    position: 'topleft',
    onClick,
    label: 'Locate',
  }).addTo(map);
}

// Updates the locate button icon to reflect current state
export function updateLocateIcon(locateState: LocateState): void {
  const img = document.getElementById('locate') as HTMLImageElement | null;
  if (!img) return;
  switch (locateState) {
    case 'off':
      img.alt = img.title = 'Locate: Center map on your GPS location';
      img.src = '/locate-arrow-lines.svg';
      break;
    case 'active':
      img.alt = img.title = 'Locate (Following): Tap again to stop following';
      img.src = '/locate-arrow-color.svg';
      break;
    case 'passive':
      img.alt = img.title = 'Locate (Passive): Tap to re-center map on your location';
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
    label: 'Tracking',
  }).addTo(map);
}
