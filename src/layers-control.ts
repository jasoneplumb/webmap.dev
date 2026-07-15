/**
 * Custom layers control — replaces native Leaflet L.control.layers with
 * a curated, discoverable button + popover UI for base maps and overlays.
 *
 * Features:
 * - Single button in top-left (26×26px desktop, 34×34px mobile)
 * - Popover shows base maps (radio) + overlays (checkboxes)
 * - Persists selection to localStorage
 * - Offline capability metadata for each layer
 */

import L from 'leaflet';
import { setupCollapsibleLabel } from './controls';

export interface LayerDef {
  id: string;
  name: string;
  description: string;
  // L.Layer (not L.TileLayer) so a base map can be a composite L.LayerGroup
  // — e.g. the 'Trails' layer (OSM base + Waymarked route overlays).
  tileLayer: L.Layer;
}

export interface OverlayDef {
  id: string;
  name: string;
  description?: string;
  // L.Layer (not L.TileLayer) so an overlay can be a composite L.LayerGroup —
  // e.g. the 'Routes' overlay (Waymarked hiking + cycling route tiles).
  tileLayer: L.Layer;
  // File-backed overlays supply this to get a "Change…" button on their row —
  // it reopens the file picker so a different file can replace the loaded one.
  // Enabled only while the overlay is checked (the picker needs the overlay's
  // load path active, and a click here carries the required user activation).
  requestFilePick?: () => void;
}

const LAYERS_STORAGE_KEY = 'webmap-layer-selection';
const OVERLAY_STORAGE_KEY = 'webmap-overlay-selection';

export class LayersControl extends L.Control {
  private baseMaps: LayerDef[] = [];
  private overlays: OverlayDef[] = [];
  private currentBase: LayerDef | null = null;
  private activeOverlays: Set<string> = new Set();
  private defaultOverlayIds: string[];
  private popoverEl: HTMLElement | null = null;
  private popoverOpen = false;
  private map: L.Map | null = null;
  private containerEl: HTMLElement | null = null;

  constructor(
    baseMaps: LayerDef[],
    overlays: OverlayDef[] = [],
    options?: L.ControlOptions,
    defaultOverlayIds: string[] = [],
  ) {
    super(options || { position: 'topright' });
    this.baseMaps = baseMaps;
    this.overlays = overlays;
    this.defaultOverlayIds = defaultOverlayIds;
  }

  onAdd(map: L.Map): HTMLElement {
    this.map = map;

    const container = L.DomUtil.create('div', 'leaflet-control-toggle') as HTMLDivElement;
    this.containerEl = container;
    container.title = 'Click to choose map layer';

    // Icon: layered squares
    const icon = L.DomUtil.create('span', 'layers-control__icon') as HTMLSpanElement;
    icon.innerHTML = '⚙'; // Alternative: could use an SVG or emoji
    icon.id = 'layers-control-btn';

    container.appendChild(icon);

    const label = L.DomUtil.create('span', 'leaflet-control-toggle__label') as HTMLSpanElement;
    label.textContent = 'Layers';
    const collapseAndPersist = setupCollapsibleLabel(container, label, 'webmap-ctrl-label-layers');

    // Prevent map interaction
    L.DomEvent.disableClickPropagation(container);

    const handleToggle = (): void => {
      collapseAndPersist();
      this.togglePopover();
    };

    // Collapse on tooltip-reveal triggers (hover, long-touch) — once any
    // of them fires the user has seen the affordance.
    L.DomEvent.on(container, 'mouseenter', collapseAndPersist);
    L.DomEvent.on(container, 'touchstart', collapseAndPersist);

    L.DomEvent.on(container, 'touchend', (e: Event) => {
      e.preventDefault();
      handleToggle();
      e.stopImmediatePropagation();
    });

    L.DomEvent.on(container, 'click', (e: Event) => {
      handleToggle();
      e.stopImmediatePropagation();
    });

    // Load persisted selection and initialize layers
    this.loadPersistedSelection();
    this.applyCurrentLayers();

    return container;
  }

  private loadPersistedSelection(): void {
    // Load base map selection
    const savedBase = localStorage.getItem(LAYERS_STORAGE_KEY);
    if (savedBase) {
      const base = this.baseMaps.find((b) => b.id === savedBase);
      if (base) {
        this.currentBase = base;
      }
    }

    // Use first base map if none persisted
    if (!this.currentBase && this.baseMaps.length > 0) {
      this.currentBase = this.baseMaps[0]!;
    }

    // Load overlay selection (fall back to defaults if nothing persisted)
    const savedOverlays = localStorage.getItem(OVERLAY_STORAGE_KEY);
    if (savedOverlays) {
      try {
        this.activeOverlays = new Set(JSON.parse(savedOverlays));
      } catch {
        this.activeOverlays = new Set(this.defaultOverlayIds);
      }
    } else {
      this.activeOverlays = new Set(this.defaultOverlayIds);
    }
  }

  private togglePopover(): void {
    if (this.popoverOpen) {
      this.closePopover();
    } else {
      this.openPopover();
    }
  }

  private openPopover(): void {
    if (!this.map) return;

    // Create popover if needed
    if (!this.popoverEl) {
      this.popoverEl = this.buildPopover();
      document.body.appendChild(this.popoverEl);
    }

    this.popoverEl.style.display = 'block';
    this.popoverOpen = true;

    // Position popover
    this.positionPopover();

    // Close on outside click
    const handleOutsideClick = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!this.popoverEl?.contains(target) && target.id !== 'layers-control-btn') {
        this.closePopover();
        document.removeEventListener('click', handleOutsideClick);
      }
    };
    document.addEventListener('click', handleOutsideClick);
  }

  private closePopover(): void {
    if (this.popoverEl) {
      this.popoverEl.style.display = 'none';
    }
    this.popoverOpen = false;
  }

  private positionPopover(): void {
    if (!this.popoverEl) return;

    const btn = document.getElementById('layers-control-btn');
    if (!btn) return;

    const btnRect = btn.getBoundingClientRect();
    const popoverRect = this.popoverEl.getBoundingClientRect();

    // Position below button; flip above only if it fits; clamp to viewport
    const margin = 10;
    let top = btnRect.bottom + margin;
    let left = btnRect.left;

    // Adjust if too close to right edge
    if (left + popoverRect.width > window.innerWidth - margin) {
      left = window.innerWidth - popoverRect.width - margin;
    }

    // Flip above button if it doesn't fit below
    if (top + popoverRect.height > window.innerHeight - margin) {
      top = btnRect.top - popoverRect.height - margin;
    }

    // Clamp: never go off-screen top; cap height to available space
    if (top < margin) {
      top = margin;
      const maxH = window.innerHeight - 2 * margin;
      this.popoverEl.style.maxHeight = `${maxH}px`;
    }

    this.popoverEl.style.position = 'fixed';
    this.popoverEl.style.top = `${top}px`;
    this.popoverEl.style.left = `${left}px`;
    this.popoverEl.style.zIndex = '1000';
  }

  private buildPopover(): HTMLElement {
    const popover = document.createElement('div');
    popover.className = 'layers-popover';

    // Header
    const header = document.createElement('div');
    header.className = 'layers-popover__header';

    const title = document.createElement('span');
    title.className = 'layers-popover__title';
    title.textContent = 'Map Layers';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'layers-popover__close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    L.DomEvent.on(closeBtn, 'click', () => this.closePopover());
    header.appendChild(closeBtn);

    popover.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'layers-popover__body';

    // Base maps fieldset
    const baseMapsFieldset = document.createElement('fieldset');
    baseMapsFieldset.className = 'layers-fieldset';

    const baseMapsLegend = document.createElement('legend');
    baseMapsLegend.textContent = 'Base Map';
    baseMapsFieldset.appendChild(baseMapsLegend);

    for (const layer of this.baseMaps) {
      const label = document.createElement('label');
      label.className = 'layers-option';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'base-map';
      radio.value = layer.id;
      radio.checked = this.currentBase?.id === layer.id;

      L.DomEvent.on(radio, 'change', () => {
        this.selectBaseMap(layer);
      });

      label.appendChild(radio);

      const layerName = document.createElement('span');
      layerName.className = 'layers-option__name';
      layerName.textContent = layer.name;
      label.appendChild(layerName);

      const layerDesc = document.createElement('span');
      layerDesc.className = 'layers-option__desc';
      layerDesc.textContent = layer.description;
      label.appendChild(layerDesc);

      baseMapsFieldset.appendChild(label);
    }

    body.appendChild(baseMapsFieldset);

    // Overlays fieldset
    if (this.overlays.length > 0) {
      const overlaysFieldset = document.createElement('fieldset');
      overlaysFieldset.className = 'layers-fieldset';

      const overlaysLegend = document.createElement('legend');
      overlaysLegend.textContent = 'Overlays';
      overlaysFieldset.appendChild(overlaysLegend);

      for (const overlay of this.overlays) {
        const label = document.createElement('label');
        label.className = 'layers-option';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = `overlay-${overlay.id}`;
        checkbox.value = overlay.id;
        checkbox.checked = this.activeOverlays.has(overlay.id);

        L.DomEvent.on(checkbox, 'change', () => {
          this.toggleOverlay(overlay, checkbox.checked);
          this.syncChangeFileButton(overlay.id, checkbox.checked);
        });

        label.appendChild(checkbox);

        const overlayName = document.createElement('span');
        overlayName.className = 'layers-option__name';
        overlayName.textContent = overlay.name;
        label.appendChild(overlayName);

        if (overlay.description) {
          const overlayDesc = document.createElement('span');
          overlayDesc.className = 'layers-option__desc';
          overlayDesc.textContent = overlay.description;
          label.appendChild(overlayDesc);
        }

        const requestFilePick = overlay.requestFilePick;
        if (requestFilePick) {
          const changeBtn = document.createElement('button');
          changeBtn.type = 'button';
          changeBtn.className = 'layers-option__change-file';
          changeBtn.dataset['overlayId'] = overlay.id;
          changeBtn.textContent = 'Change…';
          changeBtn.title = 'Load a different GeoJSON file';
          changeBtn.disabled = !checkbox.checked;
          L.DomEvent.on(changeBtn, 'click', (e: Event) => {
            // Keep the click from toggling the wrapping label's checkbox.
            L.DomEvent.stop(e);
            requestFilePick();
          });
          label.appendChild(changeBtn);
        }

        overlaysFieldset.appendChild(label);
      }

      body.appendChild(overlaysFieldset);
    }

    popover.appendChild(body);

    return popover;
  }

  private selectBaseMap(layer: LayerDef): void {
    if (!this.map) return;

    // Remove old base map
    if (this.currentBase) {
      this.map.removeLayer(this.currentBase.tileLayer);
    }

    // Add new base map
    this.currentBase = layer;
    this.currentBase.tileLayer.addTo(this.map);

    // Re-add active overlays so they render above the new base map
    for (const overlay of this.overlays) {
      if (this.activeOverlays.has(overlay.id) && this.map.hasLayer(overlay.tileLayer)) {
        overlay.tileLayer.remove();
        overlay.tileLayer.addTo(this.map);
      }
    }

    // Persist selection
    localStorage.setItem(LAYERS_STORAGE_KEY, layer.id);

    // Update popover UI
    const radios = document.querySelectorAll('input[name="base-map"]');
    radios.forEach((r) => {
      (r as HTMLInputElement).checked = (r as HTMLInputElement).value === layer.id;
    });
  }

  /**
   * Programmatically toggle an overlay and keep the popover checkbox in sync —
   * used by overlays that must switch themselves off (e.g. squeeze zones when
   * the user cancels the file picker or the file is malformed).
   */
  setOverlayEnabled(id: string, enabled: boolean): void {
    const overlay = this.overlays.find((o) => o.id === id);
    if (!overlay) return;
    this.toggleOverlay(overlay, enabled);
    const checkbox = this.popoverEl?.querySelector<HTMLInputElement>(`input[name="overlay-${id}"]`);
    if (checkbox) checkbox.checked = enabled;
    this.syncChangeFileButton(id, enabled);
  }

  private syncChangeFileButton(id: string, enabled: boolean): void {
    const btn = this.popoverEl?.querySelector<HTMLButtonElement>(
      `button.layers-option__change-file[data-overlay-id="${id}"]`,
    );
    if (btn) btn.disabled = !enabled;
  }

  private toggleOverlay(overlay: OverlayDef, enabled: boolean): void {
    if (!this.map) return;

    if (enabled) {
      this.activeOverlays.add(overlay.id);
      overlay.tileLayer.addTo(this.map);
    } else {
      this.activeOverlays.delete(overlay.id);
      this.map.removeLayer(overlay.tileLayer);
    }

    // Persist selection
    localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify(Array.from(this.activeOverlays)));
  }

  private applyCurrentLayers(): void {
    if (!this.map) return;

    // Add current base map
    if (this.currentBase) {
      this.currentBase.tileLayer.addTo(this.map);
    }

    // Add active overlays
    for (const overlay of this.overlays) {
      if (this.activeOverlays.has(overlay.id)) {
        overlay.tileLayer.addTo(this.map);
      }
    }
  }

  onRemove(): void {
    // L.DomEvent.off without a handler arg removes all Leaflet-managed listeners.
    if (this.containerEl) {
      L.DomEvent.off(this.containerEl);
      this.containerEl = null;
    }
    if (this.popoverEl) {
      this.popoverEl.remove();
      this.popoverEl = null;
    }
    this.map = null;
  }
}

export function addLayersControl(
  map: L.Map,
  baseMaps: LayerDef[],
  overlays?: OverlayDef[],
  defaultOverlayIds?: string[],
): LayersControl {
  const control = new LayersControl(baseMaps, overlays, { position: 'topright' }, defaultOverlayIds);
  control.addTo(map);
  return control;
}
