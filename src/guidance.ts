// Routed-guidance state machine + bottom-left pill UI.
// Feeds off the GPS stream from location.ts via updateGuidance(); fetches
// routes from routing.ts; renders maneuvers / off-route / arrived states.

import L from 'leaflet';
import type { AppState } from './types';
import type { Route } from './routing';
import { fetchRoute } from './routing';
import { haversineDistance, pointToSegmentMeters } from './geo';

// Profile-dependent thresholds (metres).
const ARRIVAL_RADIUS_M: Record<string, number> = {
  auto: 25,
  pedestrian: 10,
  bicycle: 15,
};
const OFF_ROUTE_THRESHOLD_M: Record<string, number> = {
  auto: 30,
  pedestrian: 15,
  bicycle: 20,
};
const OFF_ROUTE_STREAK = 3;
const RECALC_THROTTLE_MS = 15_000;
const ARRIVED_TRANSIENT_MS = 3_000;
const STEP_ADVANCE_RADIUS_M = 10;

const ROUTE_LINE_OPTS: L.PolylineOptions = {
  color: '#4287f5',
  weight: 4,
  smoothFactor: 2,
  interactive: false,
};
const ROUTE_GLOW_OPTS: L.PolylineOptions = {
  color: 'rgba(66,135,245,0.25)',
  weight: 14,
  smoothFactor: 2,
  interactive: false,
};

const DEST_ICON = L.divIcon({
  className: 'guidance-dest-marker',
  html: '<div class="guidance-dest-marker__inner"></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

let panelEl: HTMLElement | null = null;
let storedState: AppState | null = null;
let storedMap: L.Map | null = null;
let storedActivatePolling: (() => void) | null = null;
let storedDeactivatePolling: (() => void) | null = null;
let arrivedTimer: ReturnType<typeof setTimeout> | null = null;

export function addGuidanceControl(
  map: L.Map,
  state: AppState,
  activatePolling: () => void,
  deactivatePolling: () => void,
): void {
  storedState = state;
  storedMap = map;
  storedActivatePolling = activatePolling;
  storedDeactivatePolling = deactivatePolling;

  const Ctrl = L.Control.extend({
    onAdd(): HTMLElement {
      const c = L.DomUtil.create('div', 'guidance-panel guidance-panel--idle');
      c.setAttribute('role', 'group');
      c.setAttribute('aria-label', 'Navigation');
      panelEl = c;
      L.DomEvent.disableClickPropagation(c);
      L.DomEvent.disableScrollPropagation(c);
      render();
      return c;
    },
  });

  new (Ctrl as new (opts: L.ControlOptions) => L.Control)({
    position: 'bottomleft',
  }).addTo(map);
}

// ── Public state-machine API ───────────────────────────────────────────────

export async function startGuidance(
  state: AppState,
  map: L.Map,
  dest: { lat: number; lng: number; label: string },
  showToast?: (msg: string, durationMs?: number) => void,
): Promise<void> {
  if (state.guidance.status !== 'idle') return;
  if (state.youAreHereLocation === null) {
    showToast?.('Enable location to navigate', 3000);
    return;
  }

  state.guidance.status = 'routing';
  state.guidance.destination = dest;
  render();

  if (state.guidance.recalcInFlight) state.guidance.recalcInFlight.abort();
  const ac = new AbortController();
  state.guidance.recalcInFlight = ac;

  try {
    const route = await fetchRoute({
      start: state.youAreHereLocation,
      dest: L.latLng(dest.lat, dest.lng),
      costing: state.guidance.costing,
      signal: ac.signal,
    });
    if (state.guidance.recalcInFlight !== ac) return; // newer fetch supersedes
    state.guidance.recalcInFlight = null;
    enterGuiding(state, map, route);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') return;
    state.guidance.recalcInFlight = null;
    state.guidance.status = 'idle';
    state.guidance.destination = null;
    render();
    showToast?.(`Routing failed: ${err instanceof Error ? err.message : String(err)}`, 5000);
  }
}

export function stopGuidance(state: AppState, map: L.Map): void {
  if (state.guidance.status === 'idle') return;

  const wasActive =
    state.guidance.status === 'guiding' ||
    state.guidance.status === 'off-route' ||
    state.guidance.status === 'arrived';

  if (state.guidance.recalcInFlight) {
    state.guidance.recalcInFlight.abort();
    state.guidance.recalcInFlight = null;
  }
  if (arrivedTimer !== null) {
    clearTimeout(arrivedTimer);
    arrivedTimer = null;
  }
  if (state.guidance.routePolyline) map.removeLayer(state.guidance.routePolyline);
  if (state.guidance.routeGlow) map.removeLayer(state.guidance.routeGlow);
  if (state.guidance.destMarker) map.removeLayer(state.guidance.destMarker);

  if (wasActive) storedDeactivatePolling?.();

  state.guidance.status = 'idle';
  state.guidance.destination = null;
  state.guidance.route = null;
  state.guidance.routePolyline = null;
  state.guidance.routeGlow = null;
  state.guidance.destMarker = null;
  state.guidance.currentStepIdx = 0;
  state.guidance.distanceToManeuverM = null;
  state.guidance.offRouteStreak = 0;
  state.guidance.arrivedAt = null;
  render();
}

/** Called from location.ts on every accepted GPS fix. No-op when idle/routing/arrived. */
export function updateGuidance(e: L.LocationEvent, state: AppState, map: L.Map): void {
  if (
    state.guidance.status === 'idle' ||
    state.guidance.status === 'routing' ||
    state.guidance.status === 'arrived'
  ) {
    return;
  }

  const route = state.guidance.route;
  const dest = state.guidance.destination;
  if (!route || !dest) return;

  const here = e.latlng;

  // Arrived check: within radius of final destination
  const distToDest = haversineDistance(here.lat, here.lng, dest.lat, dest.lng);
  if (distToDest <= ARRIVAL_RADIUS_M[state.guidance.costing]!) {
    setArrived(state, map);
    return;
  }

  // Off-route check
  const offRouteThreshold = OFF_ROUTE_THRESHOLD_M[state.guidance.costing]!;
  let minDist = Infinity;
  for (let i = 0; i < route.coords.length - 1; i++) {
    const a = route.coords[i]!;
    const b = route.coords[i + 1]!;
    const d = pointToSegmentMeters(here, a, b);
    if (d < minDist) minDist = d;
    if (d < offRouteThreshold) break;
  }

  if (minDist > offRouteThreshold) {
    state.guidance.offRouteStreak += 1;
    if (state.guidance.offRouteStreak >= OFF_ROUTE_STREAK) {
      maybeRecalc(state, map);
    }
  } else {
    state.guidance.offRouteStreak = 0;
    if (state.guidance.status === 'off-route') {
      state.guidance.status = 'guiding';
    }
  }

  // Step advance: when we approach the next maneuver location, increment.
  if (state.guidance.currentStepIdx < route.steps.length - 1) {
    const nextStep = route.steps[state.guidance.currentStepIdx + 1]!;
    const nextLoc = route.coords[nextStep.beginShapeIndex];
    if (nextLoc) {
      const distToNext = haversineDistance(here.lat, here.lng, nextLoc.lat, nextLoc.lng);
      if (distToNext < STEP_ADVANCE_RADIUS_M) {
        state.guidance.currentStepIdx += 1;
      }
      state.guidance.distanceToManeuverM = distToNext;
    }
  }

  render();
}

// ── Internal transitions ───────────────────────────────────────────────────

function enterGuiding(state: AppState, map: L.Map, route: Route): void {
  const wasInactive =
    state.guidance.status !== 'guiding' && state.guidance.status !== 'off-route';
  if (wasInactive) storedActivatePolling?.();

  state.guidance.status = 'guiding';
  state.guidance.route = route;
  state.guidance.currentStepIdx = 0;
  state.guidance.offRouteStreak = 0;
  state.guidance.distanceToManeuverM = null;

  if (state.guidance.routePolyline) map.removeLayer(state.guidance.routePolyline);
  if (state.guidance.routeGlow) map.removeLayer(state.guidance.routeGlow);
  state.guidance.routeGlow = L.polyline(route.coords, ROUTE_GLOW_OPTS).addTo(map);
  state.guidance.routePolyline = L.polyline(route.coords, ROUTE_LINE_OPTS).addTo(map);

  if (state.guidance.destMarker) map.removeLayer(state.guidance.destMarker);
  if (state.guidance.destination) {
    state.guidance.destMarker = L.marker(
      L.latLng(state.guidance.destination.lat, state.guidance.destination.lng),
      { icon: DEST_ICON, interactive: false },
    ).addTo(map);
  }

  render();
}

function maybeRecalc(state: AppState, map: L.Map): void {
  const now = performance.now();
  if (now < state.guidance.recalcThrottleUntilMs) return;
  if (state.guidance.recalcInFlight) return;

  state.guidance.status = 'off-route';
  state.guidance.recalcThrottleUntilMs = now + RECALC_THROTTLE_MS;
  render();

  const dest = state.guidance.destination;
  const here = state.youAreHereLocation;
  if (!dest || !here) return;

  const ac = new AbortController();
  state.guidance.recalcInFlight = ac;

  fetchRoute({
    start: here,
    dest: L.latLng(dest.lat, dest.lng),
    costing: state.guidance.costing,
    signal: ac.signal,
  })
    .then((route) => {
      if (state.guidance.recalcInFlight !== ac) return;
      state.guidance.recalcInFlight = null;
      enterGuiding(state, map, route);
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.name === 'AbortError') return;
      state.guidance.recalcInFlight = null;
      // Stay in off-route; next streak will retry past the throttle window.
    });
}

function setArrived(state: AppState, map: L.Map): void {
  state.guidance.status = 'arrived';
  state.guidance.arrivedAt = performance.now();
  render();
  if (arrivedTimer !== null) clearTimeout(arrivedTimer);
  arrivedTimer = setTimeout(() => {
    arrivedTimer = null;
    stopGuidance(state, map);
  }, ARRIVED_TRANSIENT_MS);
}

// ── Render ─────────────────────────────────────────────────────────────────

function render(): void {
  if (!panelEl || !storedState) return;
  const g = storedState.guidance;
  panelEl.className = 'guidance-panel';
  panelEl.innerHTML = '';

  if (g.status === 'idle') {
    panelEl.classList.add('guidance-panel--idle');
    return;
  }

  if (g.status === 'routing') {
    panelEl.classList.add('guidance-panel--routing');
    panelEl.innerHTML =
      '<div class="guidance-row guidance-row--maneuver">' +
      '<span class="guidance-spinner" aria-hidden="true"></span>' +
      `<span>Routing to ${escapeHtml(g.destination?.label ?? '?')}…</span>` +
      '</div>';
    appendButton('Cancel', 'guidance-btn--cancel', 'Cancel routing');
    return;
  }

  if (g.status === 'arrived') {
    panelEl.classList.add('guidance-panel--arrived');
    panelEl.innerHTML =
      '<div class="guidance-arrived">' +
      `Arrived${g.destination ? ' at ' + escapeHtml(g.destination.label) : ''}` +
      '</div>';
    return;
  }

  // guiding | off-route
  panelEl.classList.add('guidance-panel--active');
  if (g.status === 'off-route') panelEl.classList.add('guidance-panel--off-route');

  const route = g.route;
  if (!route) return;

  if (g.status === 'off-route') {
    panelEl.innerHTML =
      '<div class="guidance-row guidance-row--maneuver">' +
      '<span class="guidance-spinner" aria-hidden="true"></span>' +
      '<span>Off route — recalculating…</span>' +
      '</div>';
  } else {
    const stepIdx = Math.min(g.currentStepIdx, route.steps.length - 1);
    const step = route.steps[stepIdx];
    const remaining = route.distanceM;
    const eta = new Date(Date.now() + route.durationS * 1000);
    const etaStr = eta.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const dist = g.distanceToManeuverM ?? step?.lengthM ?? 0;

    panelEl.innerHTML =
      '<div class="guidance-row guidance-row--maneuver">' +
      `<span class="maneuver-icon">${maneuverIcon(step?.type ?? 0)}</span>` +
      `<span class="maneuver-distance">${formatDist(dist)}</span>` +
      `<span class="maneuver-text">${escapeHtml(step?.instruction ?? '')}</span>` +
      '</div>' +
      '<div class="guidance-row guidance-row--summary">' +
      `<span>${formatDist(remaining)}</span>` +
      '<span class="guidance-row__sep">·</span>' +
      `<span>ETA ${escapeHtml(etaStr)}</span>` +
      '<span class="guidance-row__sep">·</span>' +
      `<span class="guidance-mode-chip">${escapeHtml(g.costing)}</span>` +
      '</div>';
  }

  appendButton('Stop', 'guidance-btn--stop', 'Stop navigation');
}

function appendButton(label: string, modifier: string, ariaLabel: string): void {
  if (!panelEl) return;
  const btn = document.createElement('button');
  btn.className = `guidance-btn ${modifier}`;
  btn.textContent = label;
  btn.setAttribute('aria-label', ariaLabel);
  btn.addEventListener('click', onStop);
  panelEl.appendChild(btn);
}

function onStop(): void {
  if (storedState && storedMap) stopGuidance(storedState, storedMap);
}

function maneuverIcon(type: number): string {
  // Valhalla maneuver type codes — minimal subset; everything else falls back to →
  // https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/#maneuver-types
  switch (type) {
    case 1: return '↑';
    case 4: case 5: case 6: return '🏁'; // destination variants
    case 9: case 10: case 11: return '↰'; // left family
    case 12: case 13: return '↶'; // u-turn
    case 14: case 15: case 16: return '↱'; // right family
    case 17: case 18: return '↑'; // continue / straight
    default: return '→';
  }
}

function formatDist(m: number): string {
  if (!isFinite(m) || m < 0) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
