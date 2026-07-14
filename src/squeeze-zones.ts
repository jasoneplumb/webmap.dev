/**
 * Intent: "Squeeze zones" overlay — cycling squeeze zones from the cue pipeline rendered as severity-colored polylines
 * Context: Data is user-supplied GeoJSON chosen via a file input (deliberately no bundled data or remote fetch —
 *          zone geometry reveals the producer's ride region and webmap.dev is public); persisted to localStorage
 *          so re-enabling the overlay doesn't require re-picking
 * Pattern: Pure parse/decode/format functions (unit-tested) + createFileBackedOverlay for the shared
 *          file-picker/persistence mechanics; validation is all-or-nothing so a malformed file never partially renders
 * Future: Reason-bitmask decode table is shared with the cue-events overlay — keep REASON_LABELS the single source
 */
import L from 'leaflet';
import { createFileBackedOverlay } from './file-overlay';

export interface SqueezeZoneProps {
  event_id: number;
  severity: number;
  confidence: number;
  reasons_bitmask: number;
}

export interface SqueezeZoneFeature {
  coordinates: [number, number][]; // GeoJSON order: [lng, lat]
  properties: SqueezeZoneProps;
}

// Bits 0–2 are stable; reserved bits 3–15 may appear later and render as `reserved(bit N)`.
const REASON_LABELS: readonly string[] = [
  'narrow lane',
  'no shoulder / bike lane',
  'high-speed traffic',
];

const MAX_REASON_BITS = 16;

export function decodeReasons(bitmask: number): string[] {
  const labels: string[] = [];
  for (let bit = 0; bit < MAX_REASON_BITS; bit++) {
    if ((bitmask & (1 << bit)) === 0) continue;
    labels.push(REASON_LABELS[bit] ?? `reserved(bit ${bit})`);
  }
  return labels;
}

// Severity is a uint8 calibration value — bucket to color, render the number verbatim.
export function severityColor(severity: number): string {
  if (severity >= 192) return '#d63131'; // red-ish
  if (severity >= 128) return '#f57c00'; // orange
  return '#fbc02d'; // yellow
}

export function formatZoneLabel(props: SqueezeZoneProps): string {
  const reasons = decodeReasons(props.reasons_bitmask).join(', ');
  return [
    `zone ${props.event_id}`,
    reasons,
    `severity ${props.severity}`,
    `confidence ${props.confidence}`,
  ]
    .filter((part) => part !== '')
    .join(' · ');
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Parse + validate the cue pipeline's FeatureCollection contract. Throws on any
// malformed feature (all-or-nothing — the caller never partially renders).
// Returns normalized features so downstream code needs no further guards.
export function parseSqueezeZones(text: string): SqueezeZoneFeature[] {
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

  const features: SqueezeZoneFeature[] = [];
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
    for (const key of ['event_id', 'severity', 'confidence', 'reasons_bitmask'] as const) {
      if (!isFiniteNumber(p[key])) {
        throw new Error(`feature ${i}: property ${key} must be a number`);
      }
    }
    features.push({
      coordinates,
      properties: {
        event_id: p['event_id'] as number,
        severity: p['severity'] as number,
        confidence: p['confidence'] as number,
        reasons_bitmask: p['reasons_bitmask'] as number,
      },
    });
  }
  return features;
}

const STORAGE_KEY = 'webmap-squeeze-zones-geojson';

const BASE_WEIGHT = 5;
const BASE_OPACITY = 0.8;
const HOVER_WEIGHT = 8;

function renderZones(group: L.LayerGroup, features: SqueezeZoneFeature[]): void {
  // Segments sharing an event_id form one logical zone — highlight all members on hover.
  const zoneMembers = new Map<number, { line: L.Polyline; color: string }[]>();

  for (const f of features) {
    const latlngs = f.coordinates.map(([lng, lat]) => L.latLng(lat, lng));
    const color = severityColor(f.properties.severity);
    const line = L.polyline(latlngs, {
      color,
      weight: BASE_WEIGHT,
      opacity: BASE_OPACITY,
      interactive: true,
    });
    const label = formatZoneLabel(f.properties);
    line.bindTooltip(label, { sticky: true });
    line.bindPopup(label); // tap on touch devices, where hover tooltips don't fire

    let members = zoneMembers.get(f.properties.event_id);
    if (!members) {
      members = [];
      zoneMembers.set(f.properties.event_id, members);
    }
    members.push({ line, color });
    const zone = members; // shared array — sees members added after this one
    line.on('mouseover', () => {
      for (const m of zone) m.line.setStyle({ weight: HOVER_WEIGHT, opacity: 1 });
    });
    line.on('mouseout', () => {
      for (const m of zone) m.line.setStyle({ color: m.color, weight: BASE_WEIGHT, opacity: BASE_OPACITY });
    });
    group.addLayer(line);
  }
}

/**
 * Build the layers-control overlay — see createFileBackedOverlay for the
 * file-picker / persistence / self-disable contract.
 */
export function createSqueezeZonesOverlay(
  showToast: (msg: string, durationMs?: number) => void,
  disableOverlay: () => void,
): L.LayerGroup {
  return createFileBackedOverlay<SqueezeZoneFeature>({
    storageKey: STORAGE_KEY,
    toastPrefix: 'Squeeze zones',
    parse: parseSqueezeZones,
    render: renderZones,
    describeLoad: (count) => `Loaded ${count} squeeze zone segment${count === 1 ? '' : 's'}`,
    showToast,
    disableOverlay,
  });
}
