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
  /** Strip the text label after the first click, keeping only the icon */
  collapseOnFirstUse?: boolean;
}

/** Remove the text label from a control container, leaving only the icon. */
export function collapseControlLabel(container: HTMLElement): void {
  const label = container.querySelector('.leaflet-control-toggle__label');
  if (label) label.remove();
}

/** Wires first-use label collapse with optional localStorage persistence; returns the collapse trigger. */
export function setupCollapsibleLabel(
  container: HTMLElement,
  label: HTMLElement,
  storageKey: string | null,
): () => void {
  let collapsed = false;
  if (storageKey !== null) {
    try {
      collapsed = localStorage.getItem(storageKey) === '1';
    } catch { /* localStorage unavailable (e.g. private browsing) */ }
  }
  if (!collapsed) {
    container.appendChild(label);
  }
  return (): void => {
    if (collapsed) return;
    collapseControlLabel(container);
    collapsed = true;
    if (storageKey !== null) {
      try { localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
    }
  };
}

// tradeoff: Using a factory function rather than a class to avoid the complexity of
// typing L.Control.extend() return values in strict TypeScript. The per-call closure
// captures config cleanly without needing instance properties.
export function makeToggleControl(config: ToggleControlConfig): L.Control {
  const Ctrl = L.Control.extend({
    onAdd(): HTMLElement {
      const container = L.DomUtil.create('div', 'leaflet-control-toggle') as HTMLDivElement;
      container.title = config.disabledTitle;

      const img = L.DomUtil.create('img') as HTMLImageElement;
      img.id = config.id;
      img.alt = config.disabledTitle;
      img.src = config.disabledSrc;

      container.appendChild(img);

      let collapseAndPersist: () => void = () => { /* no-op when no label */ };
      if (config.label) {
        const label = L.DomUtil.create('span', 'leaflet-control-toggle__label') as HTMLSpanElement;
        label.textContent = config.label;
        if (config.collapseOnFirstUse) {
          const storageKey = config.id ? `webmap-ctrl-label-${config.id}` : null;
          collapseAndPersist = setupCollapsibleLabel(container, label, storageKey);
        } else {
          container.appendChild(label);
        }
      }

      // Prevent click, dblclick, and touchstart from bubbling to the map,
      // so button interactions don't accidentally trigger map handlers (e.g. pin drop on dblclick).
      L.DomEvent.disableClickPropagation(container);

      function handleClick(e: Event): void {
        collapseAndPersist();
        config.onClick(e);
      }

      // touchend + preventDefault prevents the browser from synthesizing a click event,
      // which would fire the handler twice on mobile. click alone handles desktop.
      L.DomEvent.on(container, 'touchend', (e: Event) => {
        e.preventDefault();
        handleClick(e);
        e.stopImmediatePropagation();
      });
      L.DomEvent.on(container, 'click', (e: Event) => {
        handleClick(e);
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
    position: 'bottomleft',
    onClick,
    label: 'Locate',
    collapseOnFirstUse: true,
  }).addTo(map);
}

// Updates the locate button icon to reflect current state
export function updateLocateIcon(locateState: LocateState): void {
  const img = document.getElementById('locate') as HTMLImageElement | null;
  if (!img) return;
  const container = img.parentElement as HTMLDivElement | null;

  switch (locateState) {
    case 'off':
      img.alt = 'Locate: Center map on your GPS location';
      if (container) container.title = 'Locate: Center map on your GPS location';
      img.src = '/locate-arrow-lines.svg';
      break;
    case 'active':
      img.alt = 'Locate (Following): Tap again to stop following';
      if (container) container.title = 'Locate (Following): Tap again to stop following';
      img.src = '/locate-arrow-color.svg';
      break;
    case 'passive':
      img.alt = 'Locate (Passive): Tap to re-center map on your location';
      if (container) container.title = 'Locate (Passive): Tap to re-center map on your location';
      img.src = '/locate-arrow-bw.svg';
      break;
  }
}

// Dead code — cleanup tracked separately.
export function addTrackingControl(map: L.Map, onClick: (e: Event) => void): void {
  makeToggleControl({
    id: 'tracking',
    disabledSrc: '/logging-lines-v1.1.svg',
    disabledTitle: 'Tracking Toggle (Disabled)',
    position: 'bottomleft',
    onClick,
    label: 'Tracking',
  }).addTo(map);
}
