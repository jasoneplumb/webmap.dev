/**
 * Intent: "Cue events" overlay — points where HEAD_UP cues fired during a cue ride, plus rider-placed
 *         "unsafe here" markers; complementary to squeeze zones (zones show where the map says risk is,
 *         cue points show where the policy actually cued and where the rider disagreed). Traces exported
 *         with the debug-GPS toggle on also carry a per-sample GPS track (drawn beneath the points as
 *         context) and exact event positions (approx omitted) instead of segment midpoints (approx: true)
 * Context: Data is user-supplied GeoJSON chosen via a file input (deliberately no bundled data or remote
 *          fetch — cue points reveal the producer's actual rides and webmap.dev is public); persisted to
 *          localStorage so re-enabling the overlay doesn't require re-picking
 * Pattern: Pure parse/format functions (unit-tested) + createFileBackedOverlay for the shared
 *          file-picker/persistence mechanics; validation is all-or-nothing so a malformed file never
 *          partially renders; reason bitmask decodes via the squeeze-zones table (same producer contract)
 * Future: Cross-highlighting a cue with the squeeze zone sharing its event_id is deferred — the shared
 *         id shown in both popups is the v1 link. Grading v2 (map-authored missed-risk markers via
 *         tap/long-press, and removing markers judged unnecessary later) needs the export shape to
 *         carry marker additions/removals with coordinates — follow-up issues, deliberately not here
 */
import L from 'leaflet';
import {
  GRADABLE_OUTCOMES,
  buildReviews,
  countGraded,
  effectiveOutcome,
  hashText,
  parseGradeStore,
  updateGradeStore,
  type GradableOutcome,
  type GradeMap,
} from './cue-grades';
import { createFileBackedOverlay, downloadJson, type FileBackedOverlay } from './file-overlay';
import { escapeHtml } from './html';
import { decodeReasons } from './squeeze-zones';

// FR-008 review grades from the cue ride trace; a cue without a grade renders as "ungraded" gray.
// missed_risk is retired in the trace schema (replaced by unrecognized) but kept for older exports.
export const CUE_OUTCOMES = ['useful', 'false_alarm', 'too_late', 'too_early', 'missed_risk', 'unrecognized'] as const;
export type CueOutcome = (typeof CUE_OUTCOMES)[number];

export interface CueProps {
  kind: 'cue';
  event_id: number;
  ride_clock?: string;
  lead_time_s?: number;
  reasons_bitmask?: number;
  /** false → the cue never reached the wrist (dashed ring); absent from traces without a latency sidecar */
  delivered?: boolean;
  latency_ms?: number;
  outcome?: CueOutcome;
  /** rider's direction of travel at cue time, degrees clockwise from north; absent when unknown */
  heading_deg?: number;
  /** true → point is a segment midpoint, not a GPS fix; absent/false → exact position */
  approx?: boolean;
}

export interface RiderMarkerProps {
  kind: 'marker';
  ride_clock?: string;
  /** true → point is a segment midpoint, not a GPS fix; absent/false → exact position */
  approx?: boolean;
}

export interface CueEventFeature {
  coordinate: [number, number]; // GeoJSON order: [lng, lat]
  properties: CueProps | RiderMarkerProps;
}

/** Per-sample GPS track (zero or one per file) drawn beneath the event points as context. */
export interface TrackFeature {
  coordinates: [number, number][]; // GeoJSON order: [lng, lat]
  properties: { kind: 'track' };
}

export type CueFileFeature = CueEventFeature | TrackFeature;

export function outcomeColor(outcome: CueOutcome | undefined): string {
  switch (outcome) {
    case 'useful': return '#2e7d32'; // green
    case 'false_alarm': return '#d63131'; // red — matches squeeze-zone red
    case 'too_late': return '#f57c00'; // orange — matches squeeze-zone orange
    case 'too_early': return '#fbc02d'; // yellow — too_late's timing pair, one step lighter
    case 'missed_risk': return '#7b1fa2'; // purple
    case 'unrecognized': return '#00838f'; // teal — distinct from the custom-zone blue
    default: return '#757575'; // ungraded gray
  }
}

const OUTCOME_LABELS: Record<CueOutcome, string> = {
  useful: 'useful',
  false_alarm: 'false alarm',
  too_late: 'too late',
  too_early: 'too early',
  missed_risk: 'missed risk',
  unrecognized: 'unrecognized',
};

// Tooltip/popup line: `cue <id> · <clock> · lead N s · delivered N ms · <outcome> · <reasons>`,
// omitting absent fields. `delivered: false` renders as "not delivered".
export function formatCueLabel(props: CueProps): string {
  const parts = [`cue ${props.event_id}`];
  if (props.ride_clock !== undefined) parts.push(props.ride_clock);
  if (props.lead_time_s !== undefined) parts.push(`lead ${props.lead_time_s} s`);
  if (props.delivered === false) {
    parts.push('not delivered');
  } else if (props.latency_ms !== undefined) {
    // delivered absent + latency present still reads "delivered" — a latency
    // sidecar entry implies the cue reached the wrist unless flagged otherwise.
    parts.push(`delivered ${props.latency_ms} ms`);
  }
  if (props.outcome !== undefined) parts.push(OUTCOME_LABELS[props.outcome]);
  if (props.reasons_bitmask !== undefined) {
    const reasons = decodeReasons(props.reasons_bitmask).join(', ');
    if (reasons !== '') parts.push(reasons);
  }
  // Whole degrees — the tenth of a degree the producer preserves is below
  // what a rider can act on in a tooltip.
  if (props.heading_deg !== undefined) parts.push(`heading ${Math.round(props.heading_deg)}°`);
  if (props.approx === true) parts.push('approximate position');
  return parts.join(' · ');
}

export function formatMarkerLabel(props: RiderMarkerProps): string {
  const parts = ['marked unsafe'];
  if (props.ride_clock !== undefined) parts.push(props.ride_clock);
  if (props.approx === true) parts.push('approximate position');
  return parts.join(' · ');
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function optionalNumber(p: Record<string, unknown>, key: string, i: number): number | undefined {
  const v = p[key];
  if (v === undefined) return undefined;
  if (!isFiniteNumber(v)) throw new Error(`feature ${i}: property ${key} must be a number`);
  return v;
}

function optionalString(p: Record<string, unknown>, key: string, i: number): string | undefined {
  const v = p[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new Error(`feature ${i}: property ${key} must be a string`);
  return v;
}

function optionalBoolean(p: Record<string, unknown>, key: string, i: number): boolean | undefined {
  const v = p[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new Error(`feature ${i}: property ${key} must be a boolean`);
  return v;
}

// Parse + validate the cue ride-trace FeatureCollection contract. Throws on any
// malformed feature (all-or-nothing — the caller never partially renders).
// Returns normalized features so downstream code needs no further guards.
export function parseCueEvents(text: string): CueFileFeature[] {
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

  const features: CueFileFeature[] = [];
  let hasTrack = false;
  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i] as {
      type?: unknown;
      geometry?: { type?: unknown; coordinates?: unknown };
      properties?: Record<string, unknown>;
    };
    if (typeof f !== 'object' || f === null || f.type !== 'Feature') {
      throw new Error(`feature ${i}: not a Feature`);
    }
    const p = f.properties;
    if (typeof p !== 'object' || p === null) {
      throw new Error(`feature ${i}: missing properties`);
    }

    if (p['kind'] === 'track') {
      if (hasTrack) {
        throw new Error(`feature ${i}: more than one track feature`);
      }
      if (f.geometry?.type !== 'LineString' || !Array.isArray(f.geometry.coordinates)) {
        throw new Error(`feature ${i}: track geometry must be a LineString`);
      }
      const positions = f.geometry.coordinates as unknown[];
      if (positions.length < 2) {
        throw new Error(`feature ${i}: track must have at least 2 positions`);
      }
      const coordinates: [number, number][] = [];
      for (const pos of positions) {
        if (!Array.isArray(pos) || !isFiniteNumber(pos[0]) || !isFiniteNumber(pos[1])) {
          throw new Error(`feature ${i}: track positions must be [lng, lat] number pairs`);
        }
        coordinates.push([pos[0], pos[1]]);
      }
      hasTrack = true;
      features.push({ coordinates, properties: { kind: 'track' } });
      continue;
    }

    if (f.geometry?.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) {
      throw new Error(`feature ${i}: geometry must be a Point`);
    }
    const pos = f.geometry.coordinates as unknown[];
    if (!isFiniteNumber(pos[0]) || !isFiniteNumber(pos[1])) {
      throw new Error(`feature ${i}: position must be a [lng, lat] number pair`);
    }
    const coordinate: [number, number] = [pos[0], pos[1]];

    if (p['kind'] === 'cue') {
      if (!isFiniteNumber(p['event_id'])) {
        throw new Error(`feature ${i}: property event_id must be a number`);
      }
      const outcome = optionalString(p, 'outcome', i);
      if (outcome !== undefined && !(CUE_OUTCOMES as readonly string[]).includes(outcome)) {
        throw new Error(`feature ${i}: outcome must be one of ${CUE_OUTCOMES.join(', ')}`);
      }
      features.push({
        coordinate,
        properties: {
          kind: 'cue',
          event_id: p['event_id'] as number,
          ride_clock: optionalString(p, 'ride_clock', i),
          lead_time_s: optionalNumber(p, 'lead_time_s', i),
          reasons_bitmask: optionalNumber(p, 'reasons_bitmask', i),
          delivered: optionalBoolean(p, 'delivered', i),
          latency_ms: optionalNumber(p, 'latency_ms', i),
          outcome: outcome as CueOutcome | undefined,
          heading_deg: optionalNumber(p, 'heading_deg', i),
          approx: optionalBoolean(p, 'approx', i),
        },
      });
    } else if (p['kind'] === 'marker') {
      features.push({
        coordinate,
        properties: {
          kind: 'marker',
          ride_clock: optionalString(p, 'ride_clock', i),
          approx: optionalBoolean(p, 'approx', i),
        },
      });
    } else {
      throw new Error(`feature ${i}: kind must be "cue", "marker", or "track"`);
    }
  }
  return features;
}

const STORAGE_KEY = 'webmap-cue-events-geojson';
// Pending grades layered over the loaded file, keyed by event_id inside a
// { files: { [fileHash]: grades } } envelope — one slot per file, so grading one
// ride never clobbers another ride's unexported grades (see cue-grades.ts).
const GRADES_STORAGE_KEY = 'webmap-cue-event-grades';

const GRADE_BUTTON_LABELS: Record<GradableOutcome, string> = {
  useful: 'Useful',
  false_alarm: 'False alarm',
  too_late: 'Too late',
  too_early: 'Too early',
  unrecognized: 'Unrecognized',
};

const CUE_RADIUS = 7;
const CUE_FILL_OPACITY = 0.85;
const RING_WEIGHT = 2;
// Dashed ring signals `delivered: false` — the cue was decided but never reached the wrist.
const UNDELIVERED_DASH = '3 3';
// Subtle, muted styling so the GPS track reads as context beneath the event points, not data.
const TRACK_COLOR = '#78909c';
const TRACK_WEIGHT = 2;
const TRACK_OPACITY = 0.6;

function isTrack(f: CueFileFeature): f is TrackFeature {
  return f.properties.kind === 'track';
}

export interface CueEventsOverlay extends FileBackedOverlay {
  /**
   * Download pending grades as a reviews[] sidecar (cue trace schema shape),
   * to be merged into the ride trace by the producer's cue-review-merge tool.
   * Toasts instead of downloading when nothing is graded. Only pending grades
   * leave the browser — never the ride geometry (privacy stance unchanged).
   */
  requestReviewExport: () => void;
}

/**
 * Build the layers-control overlay — see createFileBackedOverlay for the
 * file-picker / persistence / self-disable contract. Cue popups carry a grade
 * row (Useful / False alarm / Too late / Too early / Unrecognized / Clear); a grade recolors the point
 * immediately and overwrites any prior grade, file-baked or session (latest
 * wins). Grades persist per file in localStorage and export as a reviews[]
 * sidecar via requestReviewExport.
 */
export function createCueEventsOverlay(
  showToast: (msg: string, durationMs?: number) => void,
  disableOverlay: () => void,
): CueEventsOverlay {
  interface CueEntry {
    props: CueProps;
    layer: L.CircleMarker;
    labelEl: HTMLElement;
    buttons: Map<GradableOutcome, HTMLButtonElement>;
  }

  let fileHash = '';
  let grades: GradeMap = {};
  let features: CueFileFeature[] = [];
  let cueEntries: CueEntry[] = [];
  let overlayOn = false;
  let progressEl: HTMLElement | null = null;

  function persistGrades(): void {
    try {
      const existing = localStorage.getItem(GRADES_STORAGE_KEY);
      localStorage.setItem(GRADES_STORAGE_KEY, updateGradeStore(existing, fileHash, grades));
    } catch { /* quota/unavailable — grades survive the session only */ }
  }

  function cueLabel(props: CueProps): string {
    return formatCueLabel({ ...props, outcome: effectiveOutcome(props, grades) });
  }

  // Graded/total pill — visible while the overlay is on and the file has cue points.
  // progressEl is created lazily and lives for the page lifetime; the overlay is
  // constructed once per app, so no teardown path exists (or is needed) today.
  function updateProgress(): void {
    const { graded, total } = countGraded(features, grades);
    const show = overlayOn && total > 0;
    if (progressEl === null) {
      if (!show) return;
      progressEl = document.createElement('div');
      progressEl.className = 'cue-grade-progress';
      document.body.appendChild(progressEl);
    }
    progressEl.textContent = `${graded}/${total} graded`;
    progressEl.classList.toggle('visible', show);
  }

  function setGrade(eventId: number, outcome: GradableOutcome | null): void {
    grades[String(eventId)] = { outcome, reviewed_at: new Date().toISOString() };
    persistGrades();
    for (const entry of cueEntries) {
      if (entry.props.event_id !== eventId) continue;
      const eff = effectiveOutcome(entry.props, grades);
      entry.layer.setStyle({ fillColor: outcomeColor(eff) });
      const label = cueLabel(entry.props);
      entry.layer.setTooltipContent(escapeHtml(label));
      entry.labelEl.textContent = label;
      for (const [o, btn] of entry.buttons) {
        btn.classList.toggle('is-active', o === eff);
        btn.setAttribute('aria-pressed', String(o === eff));
      }
    }
    updateProgress();
  }

  // Popup content is DOM built with textContent (no innerHTML), so the free-form
  // ride_clock string needs no escaping here; the tooltip string sink still does.
  function buildCuePopup(props: CueProps): {
    root: HTMLElement;
    labelEl: HTMLElement;
    buttons: Map<GradableOutcome, HTMLButtonElement>;
  } {
    const root = document.createElement('div');
    root.className = 'cue-popup';
    const labelEl = document.createElement('div');
    labelEl.className = 'cue-popup__label';
    labelEl.textContent = cueLabel(props);
    root.appendChild(labelEl);

    const row = document.createElement('div');
    row.className = 'cue-grade-row';
    const buttons = new Map<GradableOutcome, HTMLButtonElement>();
    const eff = effectiveOutcome(props, grades);
    for (const outcome of GRADABLE_OUTCOMES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cue-grade-row__btn';
      btn.dataset['outcome'] = outcome;
      btn.textContent = GRADE_BUTTON_LABELS[outcome];
      btn.classList.toggle('is-active', eff === outcome);
      btn.setAttribute('aria-pressed', String(eff === outcome));
      btn.addEventListener('click', () => setGrade(props.event_id, outcome));
      buttons.set(outcome, btn);
      row.appendChild(btn);
    }
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'cue-grade-row__btn cue-grade-row__btn--clear';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => setGrade(props.event_id, null));
    row.appendChild(clearBtn);
    root.appendChild(row);
    return { root, labelEl, buttons };
  }

  function render(group: L.LayerGroup, parsed: CueFileFeature[]): void {
    features = parsed;
    cueEntries = [];
    // fileHash was set by parse just before render — pick up this file's grades
    // (a different file hashes differently, so its grade layer starts empty).
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(GRADES_STORAGE_KEY);
    } catch { /* localStorage unavailable */ }
    grades = parseGradeStore(saved, fileHash);

    // Track first — vector layers share the overlay pane, so earlier layers draw beneath.
    for (const f of parsed) {
      if (!isTrack(f)) continue;
      group.addLayer(
        L.polyline(f.coordinates.map((c) => L.latLng(c[1], c[0])), {
          color: TRACK_COLOR,
          weight: TRACK_WEIGHT,
          opacity: TRACK_OPACITY,
          interactive: false,
        }),
      );
    }
    for (const f of parsed) {
      if (isTrack(f)) continue;
      const latlng = L.latLng(f.coordinate[1], f.coordinate[0]);
      if (f.properties.kind === 'cue') {
        const props = f.properties;
        const layer = L.circleMarker(latlng, {
          radius: CUE_RADIUS,
          fillColor: outcomeColor(effectiveOutcome(props, grades)),
          fillOpacity: CUE_FILL_OPACITY,
          color: '#ffffff',
          weight: RING_WEIGHT,
          opacity: 1,
          dashArray: props.delivered === false ? UNDELIVERED_DASH : undefined,
          interactive: true,
        });
        // Leaflet sets tooltip string content via innerHTML, and ride_clock is a
        // free-form string from a shareable file — escape the label at the sink.
        layer.bindTooltip(escapeHtml(cueLabel(props)), { sticky: true });
        const popup = buildCuePopup(props);
        layer.bindPopup(popup.root); // tap opens it on touch devices; hosts the grade row
        cueEntries.push({ props, layer, labelEl: popup.labelEl, buttons: popup.buttons });
        group.addLayer(layer);
        if (props.heading_deg !== undefined) {
          // Direction-of-travel tick just outside the dot, rotated via the
          // --heading-deg custom-property convention (see .blue-dot__heading).
          // heading_deg is parse-validated finite, safe to interpolate.
          group.addLayer(L.marker(latlng, {
            icon: L.divIcon({
              className: 'cue-heading-arrow',
              html: `<span class="cue-heading-arrow__glyph" style="--heading-deg: ${props.heading_deg}deg">▲</span>`,
              iconSize: [16, 16],
              iconAnchor: [8, 8],
            }),
            interactive: false,
            keyboard: false,
          }));
        }
      } else {
        // Distinct glyph from the circular cue points — a rider-placed "unsafe here" triangle.
        const label = escapeHtml(formatMarkerLabel(f.properties));
        const layer = L.marker(latlng, {
          icon: L.divIcon({
            className: 'cue-rider-marker',
            html: '▲',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
        });
        layer.bindTooltip(label, { sticky: true });
        layer.bindPopup(label); // tap on touch devices, where hover tooltips don't fire
        group.addLayer(layer);
      }
    }
    updateProgress();
  }

  const overlay = createFileBackedOverlay<CueFileFeature>({
    storageKey: STORAGE_KEY,
    toastPrefix: 'Cue events',
    parse: (text) => {
      const parsed = parseCueEvents(text);
      // Identity for the grade layer — render (always called next) keys grades on it.
      fileHash = hashText(text);
      return parsed;
    },
    render,
    // The track is context, not an event — exclude it from the load toast count.
    describeLoad: (loaded) => {
      const count = loaded.filter((f) => f.properties.kind !== 'track').length;
      return `Loaded ${count} cue event${count === 1 ? '' : 's'}`;
    },
    showToast,
    disableOverlay,
  });

  overlay.group.on('add', () => {
    overlayOn = true;
    updateProgress();
  });
  overlay.group.on('remove', () => {
    overlayOn = false;
    updateProgress();
  });

  return {
    ...overlay,
    requestReviewExport: () => {
      const reviews = buildReviews(grades);
      if (reviews.length === 0) {
        showToast('Cue events: no graded events to export');
        return;
      }
      downloadJson('cue-reviews.json', JSON.stringify(reviews, null, 2));
      showToast(`Exported ${reviews.length} review${reviews.length === 1 ? '' : 's'}`);
    },
  };
}
