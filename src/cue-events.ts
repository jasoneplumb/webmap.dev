/**
 * Intent: "Cue events" overlay — points where HEAD_UP cues fired during a cue ride, plus rider-placed
 *         "unsafe here" markers; complementary to squeeze zones (zones show where the map says risk is,
 *         cue points show where the policy actually cued and where the rider disagreed)
 * Context: Data is user-supplied GeoJSON chosen via a file input (deliberately no bundled data or remote
 *          fetch — cue points reveal the producer's actual rides and webmap.dev is public); persisted to
 *          localStorage so re-enabling the overlay doesn't require re-picking
 * Pattern: Pure parse/format functions (unit-tested) + createFileBackedOverlay for the shared
 *          file-picker/persistence mechanics; validation is all-or-nothing so a malformed file never
 *          partially renders; reason bitmask decodes via the squeeze-zones table (same producer contract)
 * Future: Cross-highlighting a cue with the squeeze zone sharing its event_id is deferred — the shared
 *         id shown in both popups is the v1 link
 */
import L from 'leaflet';
import { createFileBackedOverlay } from './file-overlay';
import { decodeReasons } from './squeeze-zones';

// FR-008 review grades from the cue ride trace; a cue without a grade renders as "ungraded" gray.
export const CUE_OUTCOMES = ['useful', 'false_alarm', 'too_late', 'missed_risk'] as const;
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
}

export interface RiderMarkerProps {
  kind: 'marker';
  ride_clock?: string;
}

export interface CueEventFeature {
  coordinate: [number, number]; // GeoJSON order: [lng, lat]
  properties: CueProps | RiderMarkerProps;
}

export function outcomeColor(outcome: CueOutcome | undefined): string {
  switch (outcome) {
    case 'useful': return '#2e7d32'; // green
    case 'false_alarm': return '#d63131'; // red — matches squeeze-zone red
    case 'too_late': return '#f57c00'; // orange — matches squeeze-zone orange
    case 'missed_risk': return '#7b1fa2'; // purple
    default: return '#757575'; // ungraded gray
  }
}

const OUTCOME_LABELS: Record<CueOutcome, string> = {
  useful: 'useful',
  false_alarm: 'false alarm',
  too_late: 'too late',
  missed_risk: 'missed risk',
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
    parts.push(`delivered ${props.latency_ms} ms`);
  }
  if (props.outcome !== undefined) parts.push(OUTCOME_LABELS[props.outcome]);
  if (props.reasons_bitmask !== undefined) {
    const reasons = decodeReasons(props.reasons_bitmask).join(', ');
    if (reasons !== '') parts.push(reasons);
  }
  return parts.join(' · ');
}

export function formatMarkerLabel(props: RiderMarkerProps): string {
  const parts = ['marked unsafe'];
  if (props.ride_clock !== undefined) parts.push(props.ride_clock);
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
export function parseCueEvents(text: string): CueEventFeature[] {
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

  const features: CueEventFeature[] = [];
  for (let i = 0; i < fc.features.length; i++) {
    const f = fc.features[i] as {
      type?: unknown;
      geometry?: { type?: unknown; coordinates?: unknown };
      properties?: Record<string, unknown>;
    };
    if (typeof f !== 'object' || f === null || f.type !== 'Feature') {
      throw new Error(`feature ${i}: not a Feature`);
    }
    if (f.geometry?.type !== 'Point' || !Array.isArray(f.geometry.coordinates)) {
      throw new Error(`feature ${i}: geometry must be a Point`);
    }
    const pos = f.geometry.coordinates as unknown[];
    if (!isFiniteNumber(pos[0]) || !isFiniteNumber(pos[1])) {
      throw new Error(`feature ${i}: position must be a [lng, lat] number pair`);
    }
    const coordinate: [number, number] = [pos[0], pos[1]];
    const p = f.properties;
    if (typeof p !== 'object' || p === null) {
      throw new Error(`feature ${i}: missing properties`);
    }

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
        },
      });
    } else if (p['kind'] === 'marker') {
      features.push({
        coordinate,
        properties: {
          kind: 'marker',
          ride_clock: optionalString(p, 'ride_clock', i),
        },
      });
    } else {
      throw new Error(`feature ${i}: kind must be "cue" or "marker"`);
    }
  }
  return features;
}

const STORAGE_KEY = 'webmap-cue-events-geojson';

const CUE_RADIUS = 7;
const CUE_FILL_OPACITY = 0.85;
const RING_WEIGHT = 2;
// Dashed ring signals `delivered: false` — the cue was decided but never reached the wrist.
const UNDELIVERED_DASH = '3 3';

function renderCueEvents(group: L.LayerGroup, features: CueEventFeature[]): void {
  for (const f of features) {
    const latlng = L.latLng(f.coordinate[1], f.coordinate[0]);
    let layer: L.Layer;
    let label: string;
    if (f.properties.kind === 'cue') {
      label = formatCueLabel(f.properties);
      layer = L.circleMarker(latlng, {
        radius: CUE_RADIUS,
        fillColor: outcomeColor(f.properties.outcome),
        fillOpacity: CUE_FILL_OPACITY,
        color: '#ffffff',
        weight: RING_WEIGHT,
        opacity: 1,
        dashArray: f.properties.delivered === false ? UNDELIVERED_DASH : undefined,
        interactive: true,
      });
    } else {
      // Distinct glyph from the circular cue points — a rider-placed "unsafe here" triangle.
      label = formatMarkerLabel(f.properties);
      layer = L.marker(latlng, {
        icon: L.divIcon({
          className: 'cue-rider-marker',
          html: '▲',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      });
    }
    (layer as L.Marker | L.CircleMarker).bindTooltip(label, { sticky: true });
    (layer as L.Marker | L.CircleMarker).bindPopup(label); // tap on touch devices, where hover tooltips don't fire
    group.addLayer(layer);
  }
}

/**
 * Build the layers-control overlay — see createFileBackedOverlay for the
 * file-picker / persistence / self-disable contract.
 */
export function createCueEventsOverlay(
  showToast: (msg: string, durationMs?: number) => void,
  disableOverlay: () => void,
): L.LayerGroup {
  return createFileBackedOverlay<CueEventFeature>({
    storageKey: STORAGE_KEY,
    toastPrefix: 'Cue events',
    parse: parseCueEvents,
    render: renderCueEvents,
    describeLoad: (count) => `Loaded ${count} cue event${count === 1 ? '' : 's'}`,
    showToast,
    disableOverlay,
  });
}
