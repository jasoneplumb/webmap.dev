# ADR-006: Routed Turn-by-Turn Guidance over GPS Trail Recording

**Status:** Accepted

## Context

The original feature set centered on GPS trail recording: the user starts a recording, the app appends every GPS fix to a polyline, and at the end exports a GPX. This is useful after the fact (sharing a hike, importing into Strava) but does little in the moment — there is no destination, no route, no turn-by-turn instructions.

For the typical "I'm at point A and I want to get to point B" flow, recording is the wrong primitive. Live guidance is what people actually do with a map app on the move. The destination surfaces (search results, long-press reverse-geocode) already exist in the UI but did not lead anywhere.

A guidance feature requires three external decisions:

1. Which routing service to use (driving, cycling, walking — all three required)
2. How to indicate direction of travel on the map (rotation? compass? something else?)
3. How to disclose the additional privacy tradeoff (every route request leaves the device)

## Decision

Replace GPS trail recording with **turn-by-turn routed guidance** powered by:

### 1. Valhalla via FOSSGIS

Routing requests go to `https://valhalla1.openstreetmap.de/route`, the FOSSGIS public Valhalla instance.

- All three required profiles (`auto`, `pedestrian`, `bicycle`) are served from a single endpoint.
- Pre-formatted natural-language maneuver instructions in the response (saves ~50 LOC of formatting).
- No API key. CORS-enabled. Best-effort SLA — same risk class as OSRM's public demo.
- Polyline6-encoded geometry; a ~25-LOC inline decoder handles parsing.

### 2. Heading-Cone Wedge on the Blue Dot (no map rotation)

Direction of travel is indicated by a translucent **heading-cone wedge** rendered behind the GPS blue dot — the same idiom used by Google Maps and Apple Maps. The wedge is a CSS `conic-gradient` masked by a `radial-gradient`, rotated by a `--heading-deg` custom property.

- The wedge points in the direction of GPS course (`e.heading` from the Geolocation API).
- When `e.heading` is `NaN` (typical at speeds < 1 m/s), the last valid bearing is held for ~10 s before the wedge fades out.

The map itself does **not** rotate.

### 3. Updated Consent Text

`src/consent.ts` now explicitly lists Valhalla / FOSSGIS as a third-party service, and `CONSENT_VERSION` was bumped to force re-acceptance from existing users.

## Alternatives Considered

### Routing Service

1. **OSRM (public demo)** — only the `car` profile is hosted on the public demo server; would have required either self-hosting or an additional service for cycling/walking. Rejected for v1.
2. **Mapbox Directions API / OpenRouteService** — both require API keys, billing accounts, and server-side proxying to avoid leaking the key in client code. Out of scope for an MIT, no-account, no-backend project.
3. **Self-hosted Valhalla / OSRM** — operationally heavyweight; rejected.

### Direction-of-Travel Indicator

1. **`leaflet-rotate` plugin (full map rotation)** — the most-maintained fork is GPL-3 licensed; webmap.dev is MIT, and importing GPL-3 code would force a relicense or a dual-license arrangement. Rejected.
2. **CSS-transform rotation** — requires manual coordinate inversion on every overlay (markers, popups, accuracy circle, route polyline) to keep them upright. Per-overlay invariants would multiply across the codebase. Rejected.
3. **MapLibre GL** — first-class rotation support, but the migration is much larger than the guidance feature itself. Out of scope.
4. **Compass-rose widget alone (no heading indicator on the dot)** — provides north-up orientation but does not show direction of travel, which is the actually-useful signal during navigation. Rejected as insufficient.

The heading-cone wedge solves the actually-useful subset of "rotation" (showing the user which way they are facing) without the licensing or refactor cost.

## Consequences

### Advantages

- **Three travel modes from a single endpoint.** No additional service for cycling or walking.
- **Pre-formatted instructions.** Less client-side formatting code.
- **Familiar UX pattern.** The wedge-on-dot idiom is recognized by anyone who has used Google Maps or Apple Maps.
- **No license entanglement.** All new code is MIT-compatible; CSS gradients and Geolocation `heading` are platform features, not third-party dependencies.
- **Smaller diff than full rotation.** No plugin, no shim, no per-overlay coordinate work.

### Disadvantages

- **Privacy regression vs. the local-only baseline ([ADR-004](ADR-004-local-only-data.md)).** Every routing request sends the start and destination to FOSSGIS. Mitigated by: explicit consent text, only firing on explicit "Navigate here" actions (no background traffic), and abstracting `fetchRoute()` so the provider can be swapped in one place.
- **Public Valhalla server reliability.** No SLA. Failure mode is a clear error toast with manual Retry; no auto-loop.
- **GPS course `NaN` at low speeds.** Many devices report `NaN` below ~1 m/s. Mitigated by holding the last valid bearing for ~10 s before fading the wedge.
- **No north-up disorientation cue.** Without a compass widget, the user has no built-in way to recover north-up if they manually rotate or tilt the map. Acceptable because the map itself does not rotate — north is always up.

### Privacy Mitigation

- Routing requests fire only on explicit user action (`Navigate here` button).
- Consent text (`src/consent.ts`) explicitly lists FOSSGIS Valhalla as a third-party service alongside OpenStreetMap and Esri.
- Consent version bumped to force re-acceptance from upgrading users.
- `fetchRoute()` is the single egress point; replacing the provider is a one-line change.

## Implementation Details

- **Module:** `src/routing.ts` — Valhalla client, polyline6 decoder, types (`RouteRequest`, `Route`, `RouteStep`, `Costing`).
- **State machine:** `idle → routing → guiding ↔ off-route → arrived → idle` (`src/guidance.ts`).
- **Off-route detection:** profile-dependent thresholds (driving 30 m / cycling 20 m / walking 15 m) with a 3-fix streak before recalc, throttled to once per 15 s.
- **Arrived detection:** profile-dependent radius (driving 25 m / cycling 15 m / walking 10 m).
- **Heading hold:** 10 s window after the last valid `e.heading`, then the wedge fades.

## Related Decisions

- [ADR-001: Single Mutable State](ADR-001-single-mutable-state.md) — Guidance state lives as a nested `guidance` object on `AppState`; no event bus.
- [ADR-002: Refcount-based GPS Polling](ADR-002-refcount-gps-polling.md) — Guidance holds one refcount on `updateCallback` while active, mirroring the previous recording lifecycle.
- [ADR-004: Local-Only Data](ADR-004-local-only-data.md) — Guidance is the first feature that *intentionally* breaks the local-only invariant for routing requests; the privacy mitigations above are why.
