/**
 * Intent: Compass widget showing where the device is facing relative to the (north-up) map
 * Context: Mounted top-right; first tap requests DeviceOrientation permission, then updates passively
 * Pattern: Leaflet control + inline SVG; rotation driven by --heading-deg CSS custom property
 */
import L from 'leaflet';
import type { AppState } from './types';
import { requestOrientationPermission, subscribeOrientation } from './orientation';

const COMPASS_HTML = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="20" cy="20" r="18" fill="rgba(255,255,255,0.92)" stroke="#444" stroke-width="1.5"/>
  <polygon points="20,4 24,18 16,18" fill="#d33"/>
  <polygon points="20,36 24,22 16,22" fill="#666"/>
  <text x="20" y="14" font-size="9" font-weight="700" text-anchor="middle" fill="#222" font-family="sans-serif">N</text>
</svg>`;

export function addCompassControl(map: L.Map, state: AppState): void {
  const Control = L.Control.extend({
    onAdd() {
      const button = L.DomUtil.create('button', 'compass-rose') as HTMLButtonElement;
      button.type = 'button';
      button.title = 'Compass — tap to enable';
      button.setAttribute('aria-label', 'Compass — tap to enable');
      button.innerHTML = COMPASS_HTML;

      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.disableScrollPropagation(button);

      let unsubscribe: (() => void) | null = null;

      L.DomEvent.on(button, 'click', () => {
        if (state.compassPermission === 'granted') return;
        void requestOrientationPermission().then((permission) => {
          state.compassPermission = permission;
          if (permission === 'granted') {
            button.classList.add('compass-rose--active');
            button.title = 'Compass';
            button.setAttribute('aria-label', 'Compass');
            unsubscribe = subscribeOrientation((heading) => {
              state.lastDeviceHeadingDeg = heading;
              button.style.setProperty('--heading-deg', `${-heading}deg`);
            });
          } else {
            button.classList.add('compass-rose--unavailable');
            button.title = permission === 'denied' ? 'Compass permission denied' : 'Compass not supported';
            button.setAttribute('aria-label', button.title);
          }
        });
      });

      // Hide the button entirely when the API isn't present (desktop without sensors)
      if (typeof DeviceOrientationEvent === 'undefined') {
        button.classList.add('compass-rose--unavailable');
        state.compassPermission = 'unsupported';
      }

      // Bind cleanup to the map's remove event so we don't leak the listener if the map is torn down
      map.on('unload', () => {
        if (unsubscribe !== null) unsubscribe();
      });

      return button;
    },
  });

  new Control({ position: 'topright' }).addTo(map);
}
