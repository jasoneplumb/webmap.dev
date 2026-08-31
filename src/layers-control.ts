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
  // Optional extra action button on the overlay's row, next to "Change…" —
  // e.g. "Export reviews" on cue events. Enabled only while the overlay is
  // checked, same as the change-file button.
  rowAction?: { label: string; title: string; onClick: () => void };
}

const LAYERS_STORAGE_KEY = 'webmap-layer-selection';
const OVERLAY_STORAGE_KEY = 'webmap-overlay-selection';

export class LayersControl extends L.Control {
  private baseMaps: LayerDef[] = [];
  private overlays: OverlayDef[] = [];
  private currentBase: LayerDef | null = null;
  private activeOverlays: Set<string> = new Set();
  private defaultOverlayIds: string[];
  private defaultBaseId: string | undefined;
  private onBaseChange: ((baseId: string) => void) | undefined;
  private popoverEl: HTMLElement | null = null;
  private popoverOpen = false;
  private map: L.Map | null = null;
  private containerEl: HTMLElement | null = null;

  constructor(
    baseMaps: LayerDef[],
    overlays: OverlayDef[] = [],
    options?: L.ControlOptions,
    defaultOverlayIds: string[] = [],
    defaultBaseId?: string,
    onBaseChange?: (baseId: string) => void,
  ) {
    super(options || { position: 'bottomleft' });
    this.baseMaps = baseMaps;
    this.overlays = overlays;
    this.defaultOverlayIds = defaultOverlayIds;
    this.defaultBaseId = defaultBaseId;
    this.onBaseChange = onBaseChange;
  }

  /** Id of the base map currently shown, or null before the control is added. */
  get activeBaseId(): string | null {
    return this.currentBase?.id ?? null;
  }

  onAdd(map: L.Map): HTMLElement {
    this.map = map;

    const container = L.DomUtil.create('div', 'leaflet-control-toggle ctrl-layers') as HTMLDivElement;
    this.containerEl = container;
    container.title = 'Click to choose map layer';

    // Stacked-sheets glyph — the conventional map-layers icon. The gear it
    // replaces read as app settings, which is not what this opens.
    // Shares .leaflet-control-toggle__icon with the other buttons so it can't
    // drift out of size with them; the old bespoke class was bumped to 20px
    // under .leaflet-touch while the rest stayed 16px.
    const icon = L.DomUtil.create('span', 'leaflet-control-toggle__icon') as HTMLSpanElement;
    icon.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" ' +
      'stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M8 1.75 14.25 5 8 8.25 1.75 5 8 1.75Z"/>' +
      '<path d="M2.6 7.7 8 10.5l5.4-2.8"/>' +
      '<path d="M2.6 10.5 8 13.3l5.4-2.8"/>' +
      '</svg>';
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

    // Nothing persisted: the caller's declared default, else the first base
    // map. The positional fallback is kept only for callers that declare no
    // default — picking the default by list ORDER would otherwise tie the
    // first-run base map to the picker's presentation order, so reordering
    // the popover for readability would silently change what new users see.
    if (!this.currentBase) {
      this.currentBase = this.baseMaps.find((b) => b.id === this.defaultBaseId)
        ?? this.baseMaps[0]
        ?? null;
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
          this.syncRowActionButtons(overlay.id, checkbox.checked);
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
          changeBtn.className = 'layers-option__action';
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

        const rowAction = overlay.rowAction;
        if (rowAction) {
          const actionBtn = document.createElement('button');
          actionBtn.type = 'button';
          actionBtn.className = 'layers-option__action';
          actionBtn.dataset['overlayId'] = overlay.id;
          actionBtn.textContent = rowAction.label;
          actionBtn.title = rowAction.title;
          actionBtn.disabled = !checkbox.checked;
          L.DomEvent.on(actionBtn, 'click', (e: Event) => {
            // Keep the click from toggling the wrapping label's checkbox.
            L.DomEvent.stop(e);
            rowAction.onClick();
          });
          label.appendChild(actionBtn);
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

    // Last: let a caller re-tune an overlay to the new base (the Hillshade sun
    // follows the imagery underneath it) once the map is in its final state.
    this.onBaseChange?.(layer.id);
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
    this.syncRowActionButtons(id, enabled);
  }

  // Change-file buttons and rowAction buttons follow the checkbox.
  private syncRowActionButtons(id: string, enabled: boolean): void {
    const buttons = this.popoverEl?.querySelectorAll<HTMLButtonElement>(
      `button.layers-option__action[data-overlay-id="${id}"]`,
    );
    buttons?.forEach((btn) => { btn.disabled = !enabled; });
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
  defaultBaseId?: string,
  onBaseChange?: (baseId: string) => void,
): LayersControl {
  const control = new LayersControl(
    baseMaps, overlays, { position: 'bottomleft' }, defaultOverlayIds, defaultBaseId, onBaseChange);
  control.addTo(map);
  return control;
}
