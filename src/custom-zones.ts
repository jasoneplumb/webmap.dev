/**
 * Intent: "Custom squeeze zones" overlay — zones the rider draws directly on the map, distinct from
 *         the derived Squeeze zones overlay (OSM-scored, loaded from a cue-zone-export file). Rendered
 *         in one fixed color + dashed stroke so "mine" and "derived" are unambiguous at a glance.
 * Context: A drawn zone is the rider's own judgment, not a policy output — no severity/confidence/
 *          reasons_bitmask (that's the scorer's vocabulary). Persisted to localStorage like the other
 *          overlays; also exportable/importable as GeoJSON so a rider can back zones up or move them to
 *          another device. Import REPLACES the current set — same load-a-file contract as the other
 *          overlays, no merge semantics to reason about.
 * Pattern: Pure parse/encode functions (unit-tested) for the data path; a small imperative draw-mode
 *          state machine drives the map interaction (click to add a vertex, Finish/Cancel or Enter/Esc).
 *          Kept separate from file-overlay.ts's createFileBackedOverlay since drawing has no
 *          file-picker-on-toggle step — toggling this overlay only shows/hides what's already drawn.
 * Future: No edit-existing-zone-geometry — delete and redraw is the only path today, with the one
 *         exception of Reverse (below), which exists because a directional zone drawn the wrong way
 *         round is otherwise unfixable without redrawing it.
 */
import L from 'leaflet';
import { downloadJson } from './file-overlay';
import { bearingDeg } from './geo';
import { escapeHtml } from './html';

export interface CustomZoneProps {
  kind: 'custom_zone';
  id: string;
  created_at: string;
  label?: string;
  /**
   * Directional zone: it applies only while travelling start → end (the LineString's own vertex
   * order). Absent means bidirectional — the original contract, so every file exported before this
   * property existed keeps its exact meaning (cue#30 D1). The direction lives in the geometry
   * alone; a separate bearing property could disagree with the vertex order it duplicates.
   */
  directional?: boolean;
}

export interface CustomZoneFeature {
  coordinates: [number, number][]; // GeoJSON order: [lng, lat]
  properties: CustomZoneProps;
}

// Blue — deliberately outside the derived-zone severity palette (yellow/orange/red) and the
// cue-events outcome palette (green/red/orange/purple/gray), so a custom zone never gets mistaken
// for a scored one.
export const CUSTOM_ZONE_COLOR = '#1e88e5';

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function zoneDisplayLabel(props: CustomZoneProps): string {
  return props.label && props.label.trim() !== '' ? props.label : 'Custom zone';
}

// Parse + validate this overlay's own FeatureCollection contract. Throws on any malformed feature
// (all-or-nothing — the caller never partially renders).
export function parseCustomZones(text: string): CustomZoneFeature[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('not valid JSON');
  }

  const fc = json as { type?: unknown; features?: unknown };
  if (typeof fc !== 'object' || fc === null || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error('not a GeoJSON FeatureCollection');
  }

  const features: CustomZoneFeature[] = [];
  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i] as {
      type?: unknown;
      geometry?: { type?: unknown; coordinates?: unknown };
      properties?: Record<string, unknown>;
    };
    if (typeof f !== 'object' || f === null || f.type !== 'Feature') {
      throw new Error(`feature ${i}: not a Feature`);
    }
    if (f.geometry?.type !== 'LineString' || !Array.isArray(f.geometry.coordinates)) {
      throw new Error(`feature ${i}: geometry must be a LineString`);
    }
    if (f.geometry.coordinates.length < 2) {
      throw new Error(`feature ${i}: LineString needs at least 2 positions`);
    }
    const coordinates: [number, number][] = [];
    for (const pos of f.geometry.coordinates as unknown[]) {
      if (!Array.isArray(pos) || !isFiniteNumber(pos[0]) || !isFiniteNumber(pos[1])) {
        throw new Error(`feature ${i}: positions must be [lng, lat] number pairs`);
      }
      coordinates.push([pos[0], pos[1]]);
    }
    const p = f.properties;
    if (typeof p !== 'object' || p === null) {
      throw new Error(`feature ${i}: missing properties`);
    }
    if (p['kind'] !== 'custom_zone') {
      throw new Error(`feature ${i}: property kind must be "custom_zone"`);
    }
    if (typeof p['id'] !== 'string' || p['id'] === '') {
      throw new Error(`feature ${i}: property id must be a non-empty string`);
    }
    if (typeof p['created_at'] !== 'string' || p['created_at'] === '') {
      throw new Error(`feature ${i}: property created_at must be a non-empty string`);
    }
    const label = p['label'];
    if (label !== undefined && typeof label !== 'string') {
      throw new Error(`feature ${i}: property label must be a string`);
    }
    const directional = p['directional'];
    if (directional !== undefined && typeof directional !== 'boolean') {
      throw new Error(`feature ${i}: property directional must be a boolean`);
    }
    features.push({
      coordinates,
      properties: {
        kind: 'custom_zone',
        id: p['id'],
        created_at: p['created_at'],
        label,
        // Normalized to undefined when false: absent and false mean the same thing, and keeping one
        // representation of "bidirectional" stops localStorage and an exported file from disagreeing
        // over a zone nothing has changed.
        directional: directional === true ? true : undefined,
      },
    });
  }
  return features;
}

export function encodeCustomZones(zones: CustomZoneFeature[]): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: zones.map((z) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: z.coordinates },
      properties: z.properties,
    })),
  });
}

function newZoneId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `zone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const STORAGE_KEY = 'webmap-custom-squeeze-zones-geojson';

const ZONE_WEIGHT = 5;
const ZONE_OPACITY = 0.85;
const ZONE_DASH = '6 4'; // dashed — visually distinct from the derived overlay's solid lines

export interface CustomZonesOverlay {
  /** The layer group to register with the layers control */
  group: L.LayerGroup;
  /** Open a file picker to replace the current zones with an exported GeoJSON file */
  requestFilePick: () => void;
  /** Download the current zones as a GeoJSON file; toasts instead if there are none yet */
  requestExport: () => void;
  /** Add a freshly drawn zone (called by the draw-mode control on Finish) */
  addZone: (coordinates: [number, number][]) => void;
}

/**
 * Build the layers-control overlay for rider-drawn zones. Unlike the file-backed overlays, this one
 * starts from whatever localStorage has (possibly nothing) and never opens a file picker on its own —
 * drawing (addZone) and requestFilePick are the only ways new zones arrive.
 */
export function createCustomZonesOverlay(showToast: (msg: string, durationMs?: number) => void): CustomZonesOverlay {
  const group = L.layerGroup();
  let zones: CustomZoneFeature[] = [];
  let fileInput: HTMLInputElement | null = null;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) zones = parseCustomZones(saved);
  } catch {
    zones = []; // corrupted/unavailable storage — start empty rather than fail to load the app
  }

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, encodeCustomZones(zones));
    } catch {
      showToast('Custom squeeze zones: too large to save — zones will not survive a reload');
    }
  }

  function buildZonePopup(zone: CustomZoneFeature): HTMLElement {
    const root = document.createElement('div');
    root.className = 'custom-zone-popup';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'custom-zone-popup__label';
    input.placeholder = 'Label (optional)';
    input.value = zone.properties.label ?? '';
    root.appendChild(input);

    const directionRow = document.createElement('label');
    directionRow.className = 'custom-zone-popup__direction';
    const directionBox = document.createElement('input');
    directionBox.type = 'checkbox';
    directionBox.checked = zone.properties.directional === true;
    const directionCaption = document.createElement('span');
    directionCaption.textContent = 'Directional — applies one way only';
    directionRow.append(directionBox, directionCaption);
    root.appendChild(directionRow);

    // Label and the directional flag are draft state until a button commits them. Reverse commits
    // them too, so toggling Directional and immediately reversing a zone drawn the wrong way round
    // — the obvious two-step — cannot silently discard the toggle.
    function commitDraft(): void {
      const label = input.value.trim();
      zone.properties.label = label === '' ? undefined : label;
      zone.properties.directional = directionBox.checked ? true : undefined;
    }

    const actions = document.createElement('div');
    actions.className = 'custom-zone-popup__actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      commitDraft();
      persist();
      renderAll();
      showToast('Custom zone updated');
    });
    actions.appendChild(saveBtn);

    const reverseBtn = document.createElement('button');
    reverseBtn.type = 'button';
    reverseBtn.textContent = 'Reverse';
    // Reversing a bidirectional zone changes nothing anyone can observe, so the button is inert
    // until the zone is directional rather than offering a no-op that looks like it did something.
    function syncReverseEnabled(): void {
      reverseBtn.disabled = !directionBox.checked;
      reverseBtn.title = directionBox.checked
        ? 'Flip the direction this zone applies in'
        : 'Only directional zones have a direction to flip';
    }
    syncReverseEnabled();
    directionBox.addEventListener('change', syncReverseEnabled);
    reverseBtn.addEventListener('click', () => {
      commitDraft();
      zone.coordinates = [...zone.coordinates].reverse();
      persist();
      renderAll();
      showToast('Custom zone reversed');
    });
    actions.appendChild(reverseBtn);

    root.appendChild(actions);

    // Delete sits in its own row rather than beside two benign actions — a mis-tap on a cramped
    // phone popup destroys a zone that can only be recovered by redrawing it.
    const destructiveActions = document.createElement('div');
    destructiveActions.className = 'custom-zone-popup__actions';
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'custom-zone-popup__delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      zones = zones.filter((z) => z.properties.id !== zone.properties.id);
      persist();
      renderAll();
      showToast('Custom zone deleted');
    });
    destructiveActions.appendChild(deleteBtn);
    root.appendChild(destructiveActions);
    return root;
  }

  function renderAll(): void {
    group.clearLayers();
    for (const zone of zones) {
      const latlngs = zone.coordinates.map(([lng, lat]) => L.latLng(lat, lng));
      const line = L.polyline(latlngs, {
        color: CUSTOM_ZONE_COLOR,
        weight: ZONE_WEIGHT,
        opacity: ZONE_OPACITY,
        dashArray: ZONE_DASH,
        interactive: true,
        // Leaflet Path layers bubble clicks to the map by default — without this, tapping an
        // existing zone while drawing a new one would both open this zone's popup AND add a
        // spurious vertex to the in-progress zone via addDrawZoneControl's map click handler.
        bubblingMouseEvents: false,
      });
      // Tooltip content is set via innerHTML by Leaflet; label is free-form user/file text — escape it.
      line.bindTooltip(escapeHtml(zoneDisplayLabel(zone.properties)), { sticky: true });
      line.bindPopup(buildZonePopup(zone)); // tap on touch devices; hosts the label/delete controls
      group.addLayer(line);
      if (zone.properties.directional === true) addDirectionArrows(latlngs);
    }
  }

  /**
   * One arrowhead per polyline edge, at its midpoint, rotated to that edge's bearing — per-edge
   * rather than one arrow for the whole zone so a zone that bends still reads correctly. Arrows are
   * non-interactive: hover, tap, and the popup all belong to the line beneath them, and an
   * interactive marker here would also swallow map clicks while another zone is being drawn.
   */
  function addDirectionArrows(latlngs: L.LatLng[]): void {
    for (let i = 0; i + 1 < latlngs.length; i++) {
      const a = latlngs[i]!;
      const b = latlngs[i + 1]!;
      if (a.equals(b)) continue; // a zero-length edge (double-tapped vertex) has no bearing
      const midpoint = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
      // bearingDeg is finite by construction from parse-validated finite coordinates — safe to
      // interpolate into the style attribute (same convention as cue-events.ts's heading tick).
      const deg = bearingDeg(a, b);
      group.addLayer(L.marker(midpoint, {
        icon: L.divIcon({
          className: 'custom-zone-arrow',
          html: `<span class="custom-zone-arrow__glyph" aria-hidden="true" style="--heading-deg: ${deg}deg">▲</span>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
        interactive: false,
        keyboard: false,
      }));
    }
  }
  renderAll();

  function getFileInput(): HTMLInputElement {
    if (fileInput) return fileInput;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geojson,.json,application/geo+json,application/json';
    input.style.display = 'none';
    input.setAttribute('aria-hidden', 'true');
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = ''; // allow re-picking the same file later
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        try {
          zones = parseCustomZones(text);
        } catch (err: unknown) {
          const detail = err instanceof Error ? err.message : 'invalid file';
          showToast(`Custom squeeze zones: ${detail}`);
          return;
        }
        persist();
        renderAll();
        showToast(`Loaded ${zones.length} custom zone${zones.length === 1 ? '' : 's'}`);
      };
      reader.onerror = () => showToast('Custom squeeze zones: could not read file');
      reader.readAsText(file);
    });
    fileInput = input;
    return input;
  }

  return {
    group,
    requestFilePick: () => getFileInput().click(),
    requestExport: () => {
      if (zones.length === 0) {
        showToast('Custom squeeze zones: nothing to export yet');
        return;
      }
      downloadJson('custom-squeeze-zones.geojson', encodeCustomZones(zones));
      showToast(`Exported ${zones.length} custom zone${zones.length === 1 ? '' : 's'}`);
    },
    addZone: (coordinates) => {
      zones.push({
        coordinates,
        properties: { kind: 'custom_zone', id: newZoneId(), created_at: new Date().toISOString() },
      });
      persist();
      renderAll();
    },
  };
}

const MIN_ZONE_POINTS = 2;

/**
 * Adds the "Draw zone" map control. Click to start: each map click/tap adds a vertex; Finish (button
 * or Enter) commits the zone via overlay.addZone and switches the custom-zones overlay on; Cancel
 * (button or Esc) discards the in-progress zone. No dblclick-to-finish shortcut — Leaflet/browsers
 * fire a plain 'click' for each half of a double-click too, which would add a spurious near-duplicate
 * vertex right before finishing; the toolbar's Finish button and Enter avoid that entirely.
 */
export function addDrawZoneControl(
  map: L.Map,
  overlay: CustomZonesOverlay,
  showToast: (msg: string, durationMs?: number) => void,
  showOverlay: () => void,
): void {
  let drawing = false;
  let points: L.LatLng[] = [];
  let draftLine: L.Polyline | null = null;
  let vertexMarkers: L.CircleMarker[] = [];
  // Set in onAdd; used to mark the control blue while draw mode is active (#289).
  let controlEl: HTMLElement | null = null;

  const toolbar = document.createElement('div');
  toolbar.className = 'draw-zone-toolbar';
  const hint = document.createElement('span');
  hint.className = 'draw-zone-toolbar__hint';
  hint.textContent = 'Tap the map to add points to your zone';
  const finishBtn = document.createElement('button');
  finishBtn.type = 'button';
  finishBtn.className = 'draw-zone-toolbar__finish';
  finishBtn.textContent = 'Finish';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'draw-zone-toolbar__cancel';
  cancelBtn.textContent = 'Cancel';
  toolbar.append(hint, finishBtn, cancelBtn);
  document.body.appendChild(toolbar);

  function updateDraft(): void {
    if (points.length < 2) return;
    if (draftLine) {
      draftLine.setLatLngs(points);
      return;
    }
    draftLine = L.polyline(points, {
      color: CUSTOM_ZONE_COLOR,
      weight: 4,
      opacity: 0.9,
      dashArray: ZONE_DASH,
      interactive: false,
    });
    draftLine.addTo(map);
  }

  function addPoint(latlng: L.LatLng): void {
    points.push(latlng);
    const marker = L.circleMarker(latlng, {
      radius: 5,
      color: CUSTOM_ZONE_COLOR,
      fillColor: '#fff',
      fillOpacity: 1,
      weight: 2,
      interactive: false,
    });
    marker.addTo(map);
    vertexMarkers.push(marker);
    updateDraft();
  }

  function onMapClick(e: L.LeafletMouseEvent): void {
    addPoint(e.latlng);
  }

  function teardown(): void {
    drawing = false;
    points = [];
    if (draftLine) {
      map.removeLayer(draftLine);
      draftLine = null;
    }
    for (const marker of vertexMarkers) map.removeLayer(marker);
    vertexMarkers = [];
    map.getContainer().style.cursor = '';
    map.off('click', onMapClick);
    document.removeEventListener('keydown', onKeyDown);
    toolbar.classList.remove('visible');
    controlEl?.classList.remove('leaflet-control-toggle--active');
  }

  function onFinish(): void {
    if (points.length < MIN_ZONE_POINTS) {
      showToast('Draw at least 2 points before finishing');
      return;
    }
    const coordinates: [number, number][] = points.map((p) => [p.lng, p.lat]);
    teardown();
    overlay.addZone(coordinates);
    showOverlay();
    showToast('Custom zone added');
  }

  function onCancel(): void {
    teardown();
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Ignore keys typed into an unrelated focused control (e.g. the address search box) —
    // otherwise looking up an address mid-draw would finish/cancel the in-progress zone.
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return;
    if (e.key === 'Escape') onCancel();
    else if (e.key === 'Enter') onFinish();
  }

  finishBtn.addEventListener('click', onFinish);
  cancelBtn.addEventListener('click', onCancel);

  function startDrawing(): void {
    if (drawing) {
      onCancel(); // clicking the control again mid-draw cancels it
      return;
    }
    drawing = true;
    map.getContainer().style.cursor = 'crosshair';
    // No doubleClickZoom.disable()/enable() here — geocoding.ts already disables it for the
    // app's lifetime (dblclick drops a reverse-geocode pin instead), so toggling it per draw
    // session would re-enable map-zoom-on-dblclick and silently break that feature.
    map.on('click', onMapClick);
    document.addEventListener('keydown', onKeyDown);
    toolbar.classList.add('visible');
    controlEl?.classList.add('leaflet-control-toggle--active');
  }

  // tradeoff: factory function rather than a class, matching makeToggleControl in controls.ts —
  // avoids typing L.Control.extend()'s return value in strict TypeScript.
  const DrawZoneControl = L.Control.extend({
    onAdd(): HTMLElement {
      const container = L.DomUtil.create('div', 'leaflet-control-toggle ctrl-draw-zone') as HTMLDivElement;
      controlEl = container;
      container.title = 'Draw a custom squeeze zone';

      // Icon only — the title attribute carries the description. U+FE0E is the
      // text-presentation variation selector: without it iOS renders the pencil
      // as a colour emoji, while desktop already shows the monochrome glyph.
      const icon = L.DomUtil.create('span', 'leaflet-control-toggle__icon') as HTMLSpanElement;
      icon.textContent = '✏︎';
      container.appendChild(icon);

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(container, 'click', (e: Event) => {
        startDrawing();
        e.stopImmediatePropagation();
      });

      return container;
    },
  });

  // Top-right, joining the download and layers controls. Top-left is the search
  // bar's column, where a second button crowded the input on narrow screens.
  // Leaflet stacks a corner's controls in registration order, so this lands
  // below both (see the addDrawZoneControl call in main.ts).
  new (DrawZoneControl as new (opts: L.ControlOptions) => L.Control)({ position: 'bottomleft' }).addTo(map);
}
