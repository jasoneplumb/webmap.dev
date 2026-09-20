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

/** Offline coverage shown as a badge on a layer's popover row. `saved: true` means a
 *  deliberately downloaded region covers this layer (styled as an assurance);
 *  false means only passively-browsed ground survives offline (styled neutrally). */
export interface OfflineBadge {
  text: string;
  saved: boolean;
}

export interface LayerDef {
  id: string;
  name: string;
  description: string;
  // L.Layer (not L.TileLayer) so a base map can be a composite L.LayerGroup
  // — e.g. the 'Trails' layer (OSM base + Waymarked route overlays).
  tileLayer: L.Layer;
  // Re-evaluated every time the popover opens — saved-region state changes as the
  // user downloads and deletes regions, so a build-time snapshot would go stale.
  offlineBadge?: () => OfflineBadge | null;
}

export interface OverlayDef {
  id: string;
  name: string;
  description?: string;
  // L.Layer (not L.TileLayer) so an overlay can be a composite L.LayerGroup —
  // e.g. the 'Routes' overlay (Waymarked hiking + cycling route tiles).
  tileLayer: L.Layer;
  // Paint order within the tile pane, for grid-based overlays.
  //
  // Every Leaflet tile layer defaults to zIndex 1, so without this the stack is
  // whichever order the containers happen to sit in the DOM — and the two code paths
  // that add overlays disagree: selectBaseMap and applyCurrentLayers re-add in defs
  // order, while toggleOverlay appends, putting whatever you just ticked on top. That
  // made the mix-blend-mode overlays composite differently depending on which action
  // you took last: after a base switch the Cycle blend's multiply sat over the
  // Hillshade and muted it, and toggling Hillshade off and on "fixed" it by moving it
  // back to the top. Declaring the order makes insertion order stop mattering. (#287)
  zIndex?: number;
  // File-backed overlays supply this to get a "Change…" button on their row —
  // it reopens the file picker so a different file can replace the loaded one.
  // Enabled only while the overlay is checked (the picker needs the overlay's
  // load path active, and a click here carries the required user activation).
  requestFilePick?: () => void;
  // Optional extra action button on the overlay's row, next to "Change…" —
  // e.g. "Export reviews" on cue events. Enabled only while the overlay is
  // checked, same as the change-file button.
  rowAction?: { label: string; title: string; onClick: () => void };
  // Base-map ids over which this overlay adds nothing, because it composites its own
  // tile source against itself. Cycle blend over the Cycle base is the case: identical
  // URLs, so the multiply is just gamma 2.0 and the base produces it with a filter from
  // one fetch (see .self-multiply). Listing the base here makes the control skip the
  // layer — a second fetch, cache entry and composite pass for pixels already on
  // screen — without touching the row's persisted checked state, so switching to a base
  // where the overlay does real work brings it straight back. (#305)
  redundantOverBases?: string[];
  // Same contract as LayerDef.offlineBadge.
  offlineBadge?: () => OfflineBadge | null;
}

/** Whether `overlay` would add nothing over the given base, so the control should keep
 *  its checked state but leave the layer off the map. Pure — the membership rule lives
 *  here rather than inline so it can be tested without a map or a DOM. */
export function isOverlayRedundantOverBase(overlay: OverlayDef, baseId: string | null): boolean {
  if (baseId === null) return false;
  return overlay.redundantOverBases?.includes(baseId) ?? false;
}

const LAYERS_STORAGE_KEY = 'webmap-layer-selection';
const OVERLAY_STORAGE_KEY = 'webmap-overlay-selection';

/** Floor for a clamped popover. Only reachable when fixed chrome eats nearly the whole
 *  viewport; overflowing the intended bottom edge beats collapsing to a sliver that
 *  cannot show its own header. */
const POPOVER_MIN_HEIGHT_PX = 120;

export interface PopoverVerticalPlacement {
  top: number;
  /** null when the popover renders at its natural height and needs no clamp. */
  maxHeight: number | null;
}

/**
 * Vertical placement for the layers popover, split out from the DOM so the geometry is
 * testable without a map, a viewport, or a running route.
 *
 * `topObstruction` is the lowest y covered by fixed chrome that paints ABOVE the popover
 * — the guidance banner. Treating it as a ceiling is the whole point: the popover used to
 * clamp to the viewport edge and slide under the banner, which buries the header and the
 * close button with it, leaving no way to dismiss the popover mid-route.
 *
 * When the ceiling forces a clamp, only the TOP edge moves. The bottom edge is left where
 * unobstructed placement put it, so the popover shortens in place instead of sliding down
 * the screen.
 */
export function placePopoverVertically(input: {
  btnTop: number;
  btnBottom: number;
  height: number;
  viewportHeight: number;
  topObstruction: number;
  margin: number;
}): PopoverVerticalPlacement {
  const { btnTop, btnBottom, height, viewportHeight, topObstruction, margin } = input;
  const floor = viewportHeight - margin;
  // The ceiling is capped, not just floored. Nothing bounds the guidance banner's height —
  // it is a flex column that wraps — so a multi-line banner on a short landscape viewport
  // can push `topObstruction + margin` past the bottom of the screen. Honouring that
  // literally would place the popover entirely below the fold, stranding the close button
  // exactly as sliding under the banner did; this is the same bug approached from the
  // other extreme. Leave room for POPOVER_MIN_HEIGHT_PX above the floor, and when even
  // that does not fit, fall back to the top margin so the header stays on screen.
  const ceiling = Math.max(margin, Math.min(topObstruction + margin, floor - POPOVER_MIN_HEIGHT_PX));

  let top = btnBottom + margin;
  let bottom = top + height;

  if (bottom > floor) {
    // Flip above the button.
    bottom = btnTop - margin;
    top = bottom - height;
    // Does not fit above the button even with the entire viewport free. Stop anchoring to
    // the button and fill the full band instead, covering it. Gated on the pre-ceiling
    // `margin` deliberately: a popover that DID fit above the button keeps its bottom edge
    // there, and only one that never fit falls back to the viewport floor.
    if (top < margin) bottom = floor;
  }

  if (top >= ceiling) return { top, maxHeight: null };

  return { top: ceiling, maxHeight: Math.max(POPOVER_MIN_HEIGHT_PX, bottom - ceiling) };
}

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

    // flex, not block: .layers-popover is a flex column so a height clamp actually shrinks
    // the scrollable body rather than letting it spill past the popover's own border.
    // An inline display:block here would override that and silently restore the overflow.
    this.popoverEl.style.display = 'flex';
    this.popoverOpen = true;

    // Before measuring: the base may have changed while the popover was closed, and a
    // redundancy note changes the row's width.
    this.syncOverlayRowStates();
    // Saved-region coverage may have changed since the popover was built (a
    // download finished, a region was deleted) — recompute badges on every open.
    this.refreshOfflineBadges();

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

  /** Lowest y covered by fixed chrome that paints above the popover. Only the guidance
   *  banner qualifies today (z-index 1600 against the popover's 1000); everything else at
   *  the top of the viewport is a Leaflet control corner, which the popover legitimately
   *  covers. Queried on the --visible class because the base class is display:none, and a
   *  hidden element measures as a zero rect at the origin — indistinguishable from a
   *  banner genuinely sitting at the top of the screen. */
  private topObstructionPx(): number {
    const banner = document.querySelector('.guidance-banner--visible');
    return banner ? banner.getBoundingClientRect().bottom : 0;
  }

  private positionPopover(): void {
    if (!this.popoverEl) return;

    const btn = document.getElementById('layers-control-btn');
    if (!btn) return;

    // Measure at natural height. A maxHeight surviving from an earlier open would be read
    // back below as the popover's real height, so every subsequent open would inherit the
    // tightest clamp the popover had ever been given — including after the route that
    // caused it ended.
    this.popoverEl.style.maxHeight = '';

    const btnRect = btn.getBoundingClientRect();
    const popoverRect = this.popoverEl.getBoundingClientRect();

    const margin = 10;

    // Adjust if too close to right edge
    let left = btnRect.left;
    if (left + popoverRect.width > window.innerWidth - margin) {
      left = window.innerWidth - popoverRect.width - margin;
    }

    const placement = placePopoverVertically({
      btnTop: btnRect.top,
      btnBottom: btnRect.bottom,
      height: popoverRect.height,
      viewportHeight: window.innerHeight,
      topObstruction: this.topObstructionPx(),
      margin,
    });

    this.popoverEl.style.position = 'fixed';
    this.popoverEl.style.top = `${placement.top}px`;
    this.popoverEl.style.left = `${left}px`;
    this.popoverEl.style.zIndex = '1000';
    if (placement.maxHeight !== null) {
      this.popoverEl.style.maxHeight = `${placement.maxHeight}px`;
    }
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

      this.appendOfflineBadge(layerName, layer);

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

        this.appendOfflineBadge(overlayName, overlay);

        if (overlay.description) {
          const overlayDesc = document.createElement('span');
          overlayDesc.className = 'layers-option__desc';
          overlayDesc.textContent = overlay.description;
          label.appendChild(overlayDesc);
        }

        // Filled in by syncOverlayRowStates while this overlay is redundant over the
        // active base. An inert checkbox with no explanation reads as a bug, so the row
        // says why it is off instead of just refusing to do anything. Only overlays that
        // can ever BE redundant get the node — the rest would carry a permanently empty
        // span for the life of the popover.
        if (overlay.redundantOverBases) {
          const note = document.createElement('span');
          note.className = 'layers-option__note';
          note.dataset['overlayId'] = overlay.id;
          // Addressable so the disabled checkbox can point at it with aria-describedby:
          // without that, a screen reader announces the row as merely "dimmed, disabled"
          // and the explanation sitting right next to it never reaches the user.
          note.id = `overlay-note-${overlay.id}`;
          note.hidden = true;
          label.appendChild(note);
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
    const map = this.map;
    if (!map) return;

    // Snapshot membership BEFORE the swap: only overlays that survive the switch need the
    // restack below. Ones reconcileOverlays adds afterwards go on above the new base
    // already, and re-adding them would pay a full tile teardown for nothing.
    const wasOnMap = new Set(
      this.overlays.filter((o) => map.hasLayer(o.tileLayer)).map((o) => o.id),
    );

    // Remove old base map
    if (this.currentBase) {
      map.removeLayer(this.currentBase.tileLayer);
    }

    // Add new base map
    this.currentBase = layer;
    this.currentBase.tileLayer.addTo(map);

    // Membership first — the new base can make a checked-but-redundant overlay relevant
    // again, or make a visible one redundant.
    this.reconcileOverlays();

    // Then paint order: a surviving overlay kept the DOM position it held before the new
    // base was inserted, so the ones without a declared zIndex need a remove/add to sit
    // above it. Grid overlays that declare a zIndex don't — their order is pinned, and
    // skipping the remove/add spares them a teardown and refetch on every base switch.
    for (const overlay of this.overlays) {
      if (overlay.zIndex !== undefined) continue;
      // Vector overlays (the GeoJSON LayerGroups) live in overlayPane, which sits above
      // the whole tile pane — a base tile layer can never paint over them, so the
      // remove/add bought nothing and cost a full re-render of every feature on every
      // base switch. Same reasoning as applyOverlayZIndex being a no-op for them.
      if (!(overlay.tileLayer instanceof L.GridLayer)) continue;
      if (!wasOnMap.has(overlay.id)) continue;
      if (!map.hasLayer(overlay.tileLayer)) continue;
      overlay.tileLayer.remove();
      overlay.tileLayer.addTo(map);
    }

    // Persist selection
    localStorage.setItem(LAYERS_STORAGE_KEY, layer.id);

    // Update popover UI
    const radios = document.querySelectorAll('input[name="base-map"]');
    radios.forEach((r) => {
      (r as HTMLInputElement).checked = (r as HTMLInputElement).value === layer.id;
    });

    // Which overlays are redundant changed with the base — refresh their rows.
    this.syncOverlayRowStates();

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

  /** Show redundancy in the popover rather than leaving a checkbox that does nothing:
   *  the row is dimmed, annotated, and its checkbox disabled while the active base
   *  already produces the overlay's effect. The PERSISTED checked state is deliberately
   *  untouched — switching to a base where the overlay does real work restores it. */
  private syncOverlayRowStates(): void {
    const popover = this.popoverEl;
    if (!popover) return;

    for (const overlay of this.overlays) {
      const redundant = isOverlayRedundantOverBase(overlay, this.activeBaseId);

      const checkbox = popover.querySelector<HTMLInputElement>(
        `input[name="overlay-${overlay.id}"]`,
      );
      if (checkbox) {
        checkbox.disabled = redundant;
        checkbox.closest('.layers-option')?.classList.toggle('layers-option--inactive', redundant);
      }

      const note = popover.querySelector<HTMLElement>(
        `.layers-option__note[data-overlay-id="${overlay.id}"]`,
      );
      if (note) {
        note.textContent = redundant ? 'Already in this base' : '';
        note.hidden = !redundant;
        // Point the checkbox at the note only while it says something. A description
        // referencing an empty or hidden element is worse than none: some screen readers
        // announce the relationship and then have nothing to read out.
        if (redundant) {
          checkbox?.setAttribute('aria-describedby', note.id);
        } else {
          checkbox?.removeAttribute('aria-describedby');
        }
      }
    }
  }

  /** Mount a badge span inside a row's name element and paint its current state.
   *  The span is created even when the current badge is null so a later refresh
   *  can populate it without rebuilding the popover. */
  private appendOfflineBadge(nameEl: HTMLElement, def: { id: string; offlineBadge?: () => OfflineBadge | null }): void {
    if (!def.offlineBadge) return;
    const badge = document.createElement('span');
    badge.className = 'layers-option__badge';
    badge.dataset['badgeFor'] = def.id;
    nameEl.appendChild(badge);
    this.paintBadge(badge, def.offlineBadge());
  }

  private paintBadge(el: HTMLElement, badge: OfflineBadge | null): void {
    el.textContent = badge?.text ?? '';
    el.style.display = badge ? '' : 'none';
    el.classList.toggle('layers-option__badge--saved', badge?.saved === true);
  }

  private refreshOfflineBadges(): void {
    if (!this.popoverEl) return;
    for (const def of [...this.baseMaps, ...this.overlays]) {
      if (!def.offlineBadge) continue;
      const el = this.popoverEl.querySelector<HTMLElement>(
        `.layers-option__badge[data-badge-for="${def.id}"]`,
      );
      if (el) this.paintBadge(el, def.offlineBadge());
    }
  }

  // Change-file buttons and rowAction buttons follow the checkbox.
  private syncRowActionButtons(id: string, enabled: boolean): void {
    const buttons = this.popoverEl?.querySelectorAll<HTMLButtonElement>(
      `button.layers-option__action[data-overlay-id="${id}"]`,
    );
    buttons?.forEach((btn) => { btn.disabled = !enabled; });
  }

  /** Pin a grid overlay's paint order. No-op for vector/LayerGroup overlays, which
   *  live in overlayPane above the tile pane and are unaffected by this stack. */
  private applyOverlayZIndex(overlay: OverlayDef): void {
    if (overlay.zIndex === undefined) return;
    if (overlay.tileLayer instanceof L.GridLayer) overlay.tileLayer.setZIndex(overlay.zIndex);
  }

  private toggleOverlay(overlay: OverlayDef, enabled: boolean): void {
    if (!this.map) return;

    if (enabled) {
      this.activeOverlays.add(overlay.id);
    } else {
      this.activeOverlays.delete(overlay.id);
    }
    this.reconcileOverlays();

    // Persist the user's intent, not what is on the map — a redundant overlay stays
    // checked so it returns when the base changes.
    localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify(Array.from(this.activeOverlays)));
  }

  /**
   * The single decision point for which overlays are on the map: checked by the user AND
   * not redundant over the active base. Every path that can change the answer — the
   * initial add, a checkbox, a base switch — routes through here instead of adding and
   * removing on its own, so those paths cannot disagree about membership. #287 fixed
   * exactly that class of disagreement for paint ORDER; this keeps it from reappearing
   * for presence.
   *
   * Idempotent: it only touches a layer whose desired state differs from its current
   * one, so re-running it never costs a tile teardown and refetch.
   */
  private reconcileOverlays(): void {
    const map = this.map;
    if (!map) return;

    for (const overlay of this.overlays) {
      const shouldShow = this.activeOverlays.has(overlay.id)
        && !isOverlayRedundantOverBase(overlay, this.activeBaseId);
      const onMap = map.hasLayer(overlay.tileLayer);

      if (shouldShow && !onMap) {
        overlay.tileLayer.addTo(map);
      } else if (!shouldShow && onMap) {
        map.removeLayer(overlay.tileLayer);
      }
      if (shouldShow) this.applyOverlayZIndex(overlay);
    }
  }

  private applyCurrentLayers(): void {
    if (!this.map) return;

    // Add current base map
    if (this.currentBase) {
      this.currentBase.tileLayer.addTo(this.map);
    }

    this.reconcileOverlays();
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
