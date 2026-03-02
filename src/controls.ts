// Intent: Reusable toggle control for map toolbar icons
// Context: The original code redefined L.Control.Watermark three times (each definition
//          overwrote the previous one). This replaces that with a single parameterized factory.
// Pattern: Factory function creates a fresh L.Control subclass per control instance,
//          capturing config in a closure to avoid shared state between controls.
import L from 'leaflet';

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
      const img = L.DomUtil.create('img') as HTMLImageElement;
      img.id = config.id;
      img.style.width = '30px';
      img.alt = img.title = config.disabledTitle;
      img.src = config.disabledSrc;

      // touchend + preventDefault prevents the browser from synthesizing a click event,
      // which would fire the handler twice on mobile. click alone handles desktop.
      L.DomEvent.on(img, 'touchend', (e: Event) => {
        e.preventDefault();
        config.onClick(e);
        e.stopImmediatePropagation();
      });
      L.DomEvent.on(img, 'click', (e: Event) => {
        config.onClick(e);
        e.stopImmediatePropagation();
      });

      return img;
    },
    onRemove(): void {
      const el = document.getElementById(config.id);
      if (el) L.DomEvent.off(el);
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return new (Ctrl as new (opts: L.ControlOptions) => L.Control)({
    position: config.position,
  });
}

export function addClipboardControl(map: L.Map, onClick: (e: Event) => void): void {
  makeToggleControl({
    id: 'clip',
    disabledSrc: '/copy-pin-to-clipboard-lines-v1.1.svg',
    disabledTitle: 'Copy dropped pin to clipboard (Disabled)',
    position: 'bottomright',
    onClick,
  }).addTo(map);
}

export function addCenteringControl(map: L.Map, onClick: (e: Event) => void): void {
  makeToggleControl({
    id: 'centering',
    disabledSrc: '/centering-lines-v1.1.svg',
    disabledTitle: 'Centering Toggle (Disabled)',
    position: 'bottomright',
    onClick,
  }).addTo(map);
}

export function addTrackingControl(map: L.Map, onClick: (e: Event) => void): void {
  makeToggleControl({
    id: 'tracking',
    disabledSrc: '/logging-lines-v1.1.svg',
    disabledTitle: 'Tracking Toggle (Disabled)',
    position: 'bottomright',
    onClick,
  }).addTo(map);
}
