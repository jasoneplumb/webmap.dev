# Architecture

webmap.dev is built around a **single shared `AppState` object** that flows through all modules by reference. No event emitters, no Redux, no observable chains — just TypeScript and mutable state. This document covers the patterns that make that work.

## 1. Single Shared State (`types.ts`)

The entire application state lives in one TypeScript interface (`AppState`) defined in `src/types.ts`:

```typescript
export interface AppState {
  // GPS position tracking
  youAreHereLocation: L.LatLng | null;
  youAreHereLocationlat: number;
  youAreHereLocationlng: number;
  prior: number;                    // best accuracy seen (m); used by haversine jitter filter

  // Three-state locate button: 'off' | 'active' | 'passive'
  locateState: LocateState;

  // GPS watch refcount — each consumer (locate, guidance) increments by 1
  updateCallback: number;
  initialZoom: boolean;             // zoom-to-16 on first fix only

  // Live blue dot + accuracy circle
  locationMarker: L.Marker | null;
  accuracyCircle: L.Circle | null;

  // Per-fix metadata reused by guidance
  lastSpeedMs: number;
  lastAltM: number | undefined;
  lastGpsAccuracy: number | null;

  // Heading-cone wedge: hold last valid GPS bearing for ~10 s when course is NaN
  lastValidHeadingDeg: number | null;
  lastValidHeadingMs: number;

  // Device-orientation compass permission state
  compassPermission: OrientationPermission;

  // GPS weak-signal hysteresis (badge debounce)
  gpsWeakStreak: number;
  gpsStrongStreak: number;
  gpsWeakBadgeVisible: boolean;

  // Battery efficiency
  stationaryFixCount: number;       // consecutive low-speed fixes → coarse GPS
  screenOff: boolean;               // Page Visibility API
  batteryLevel: number | null;
  batteryCharging: boolean;
  batteryDrainStartLevel: number | null;
  batteryDrainStartMs: number;

  // Background-GPS keepalive (Wake Lock + silent audio)
  keepalive: Keepalive | null;

  // Routed-guidance state machine
  guidance: GuidanceState;
}
```

**Why single state?** At this scale, the indirection of action creators, dispatchers, and selectors costs more than it saves. TypeScript strict mode (`noUncheckedIndexedAccess`, strict equality) catches the mutable-state footguns at compile time.

**Pattern.** `main.ts` calls `createInitialState()` once, then passes the state object by reference to every initialization function. Modules mutate state directly:

```typescript
// main.ts
const state = createInitialState();
const map = createMap();
addLocateControl(map, () => { /* mutates state.locateState directly */ });
addGuidanceControl(map, state, activatePolling, deactivatePolling);
```

See [ADR-001](adr/ADR-001-single-mutable-state.md) for the full rationale and trade-offs.

---

## 2. GPS Polling Refcount (`timer.ts` + `main.ts`)

Two independent features need GPS fixes:

1. **Locate** (following the user's blue dot)
2. **Guidance** (turn-by-turn navigation)

Both must be able to start and stop polling without disturbing the other.

**The refcount.** `state.updateCallback` is an integer; each consumer increments it on activation and decrements on release:

```typescript
function activatePolling(): void {
  state.updateCallback += 1;
  if (state.updateCallback === 1) startWatching(map);   // 0 → 1
}

function deactivatePolling(): void {
  state.prior = 1000;                                    // reset jitter filter
  state.updateCallback -= 1;
  if (state.updateCallback === 0) stopWatching(map);     // 1 → 0
}
```

`startWatching()` calls `map.locate({ watch: true, enableHighAccuracy: true })`; `stopWatching()` calls `map.stopLocate()`. There is no internal polling loop — Leaflet's watch dispatches `locationfound` events directly.

**Adaptive accuracy.** `setWatchAccuracy(map, false)` re-runs `map.locate()` with `enableHighAccuracy: false` and `maximumAge: 5000` after the fix-handler observes 5+ consecutive stationary samples (`speed < 0.5 m/s`). On movement it restores high-accuracy. This trades brief gaps for meaningful battery savings during long stops.

**Refcount safety.** `main.ts` warns in dev when the count drifts above 2 (likely activate-leak) or below 0 (double-release). See [ADR-002](adr/ADR-002-refcount-gps-polling.md) for why pub/sub was rejected.

---

## 3. Three-State Locate Button

| State | Icon | Behavior |
|-------|------|----------|
| **off** | Lines (gray outline) | No polling; no markers |
| **active** | Color (blue arrow) | Following — map pans on each fix |
| **passive** | B&W (gray arrow) | Dot visible, map free; tap to re-center |

**Transitions** (in `main.ts`):

- **off → active** — synchronous within the click handler so iOS Safari shows the permission prompt; calls `activatePolling()`.
- **active → off** — `deactivatePolling()`, clear the blue dot and accuracy circle.
- **passive → active** — `flyTo()` the last known position; no refcount change (already polling).
- **active → passive** — automatic on `dragstart` or first wheel-zoom; a one-shot toast tells touch users to "Double-tap map to re-center".
- **passive → active (touch)** — a double-tap on the map at capture-phase calls `reactivateLocate()` and `preventDefault()`s the synthesized `dblclick` so the browser doesn't zoom in.

GPS errors with `code === 1` (PERMISSION_DENIED) are debounced: a 3-second timer waits for a fix to arrive, since iOS Safari sometimes fires a spurious permission-denied right before the first valid `locationfound`. If the fix arrives the timer is cancelled; otherwise the state collapses to `off` and a sticky toast explains how to re-grant permission.

---

## 4. Haversine Jitter Filter + Heading-Cone Wedge (`location.ts`)

GPS fixes arrive every ~1 s within a ~10 m circle when standing still. Without filtering, the blue dot wanders.

**The filter rule:**

```typescript
if (e.accuracy < state.prior || dist > e.accuracy / 2) {
  state.prior = e.accuracy;
  // accept the update
}
```

- If accuracy improved (15 m → 10 m), accept — the dot becomes more precise.
- If we moved farther than half the accuracy radius, accept — real motion.
- Otherwise drop the fix.

The pure haversine, bearing, and point-to-segment helpers live in `src/geo.ts` and are independently unit-tested.

**Heading-cone wedge.** A translucent CSS cone rendered behind the blue dot rotates to match `e.heading` (GPS course, 0–360°). It's the same idiom as Google Maps and Apple Maps — direction of travel without rotating the map.

Two implementation details matter:

1. **Hold last bearing for 10 s** when `e.heading` is `NaN` (typical at speeds < 1 m/s). After the hold window, the wedge fades.
2. **`--heading-deg` CSS custom property** drives a `conic-gradient` masked by a `radial-gradient`, with a 0.12 s transition for jitter smoothing.

The map itself does **not** rotate — this is the explicit trade-off in [ADR-006](adr/ADR-006-routed-guidance.md), chosen over `leaflet-rotate` (GPL-3 license clash) and CSS-transform rotation (per-overlay coordinate inversion).

**GPS weak-signal hysteresis.** A badge surfaces in the UI when fixes degrade. Two-fix streaks debounce the badge in either direction with a deadband (25–30 m) so flickering signal doesn't toggle the badge.

---

## 5. Routed-Guidance State Machine (`guidance.ts` + `routing.ts`)

The guidance feature replaced GPS trail recording in v0.30.0 (see [ADR-006](adr/ADR-006-routed-guidance.md)). It is a five-state machine:

```
idle ──Navigate-here──▶ routing ──route-fetched──▶ guiding
                            │                        │
                            ▼                        ▼
                          idle ◀───arrived───── arrived
                                      ▲              │
                                      │              ▼
                                  off-route ◀───off-route streak (3)
```

- **idle** — pill is hidden; no refcount held.
- **routing** — POSTs to FOSSGIS Valhalla; spinner pill with "Cancel". Fetch is `AbortController`-friendly so a newer route supersedes a stale in-flight request.
- **guiding** — refcount incremented; route polyline + glow + destination marker drawn; pill shows next maneuver, distance to maneuver, total remaining, ETA, and the `auto`/`pedestrian`/`bicycle` chip.
- **off-route** — set after `OFF_ROUTE_STREAK = 3` consecutive fixes farther than the profile threshold from the route polyline. Throttled recalc fires once per 15 s; recovery within tolerance returns the status to `guiding`.
- **arrived** — entered when straight-line distance ≤ profile arrival radius. The pill displays "Arrived" for 3 s, then `stopGuidance()` collapses to idle.

**Profile-dependent thresholds** (initial v1 values in `src/guidance.ts`):

| Profile | Arrival radius | Off-route threshold |
|---------|----------------|---------------------|
| auto (driving) | 25 m | 30 m |
| pedestrian | 10 m | 15 m |
| bicycle | 15 m | 20 m |

**Routing client (`src/routing.ts`).** Single `fetchRoute()` POSTs to `https://valhalla1.openstreetmap.de/route` with the start, destination, and `costing`, requesting kilometer units. The response carries pre-formatted natural-language maneuver instructions and a polyline6-encoded shape; a 25-LOC inline decoder converts the shape to `L.LatLng[]`. The endpoint URL is the **single egress point** — replacing the routing provider is a one-line change.

**Render survives GPS jitter.** `updateGuidance()` runs on every accepted fix and ends with `render()`, which rebuilds the pill's inner HTML. Click handlers are bound by **delegation on the persistent panel element** (not on the buttons themselves) so iOS Safari's touch-to-click synthesis still finds a target after re-render. The Stop tap-drop bug from #180 is the cautionary tale.

**Privacy egress.** Each route request sends start + destination to FOSSGIS. This is the first feature that intentionally breaks the local-only invariant of [ADR-004](adr/ADR-004-local-only-data.md); the consent modal explicitly names FOSSGIS Valhalla and `CONSENT_VERSION` was bumped 2.1 → 2.2 to force re-acceptance.

---

## 6. Device-Orientation Compass (`compass.ts` + `orientation.ts`)

A top-right SVG compass rose rotates by `-deviceHeading` so true north stays at the top. It complements the heading-cone wedge: the wedge shows GPS course (works while moving), the compass shows where the device is physically pointing (works while stationary).

**Permission gate.** iOS 13+ requires `DeviceOrientationEvent.requestPermission()` to be called from a user gesture. `compass.ts` calls it in the click handler, caches the result on `state.compassPermission`, and only subscribes to events if `'granted'`. Non-iOS browsers (no `requestPermission` static method) skip the prompt and return `'granted'` immediately. Desktop platforms with no `DeviceOrientationEvent` are detected at `onAdd` time and the button hides itself.

**Heading extraction (`orientation.ts`).** Prefers iOS's `webkitCompassHeading` (already true-north calibrated, clockwise). Falls back to W3C `alpha`, flipped from anti-clockwise to clockwise. Subscribes to `deviceorientationabsolute` when available — it provides true-north headings without manual calibration.

The rose is driven by a `--heading-deg` CSS custom property (same pattern as the wedge) with a 0.12 s transition for smoothing.

---

## 7. Background-GPS Keepalive (`keepalive.ts`)

Mobile browsers throttle JS timers and pause `geolocation.watchPosition` when the screen is off. The `Keepalive` class works around it with **two complementary mechanisms**:

1. **Wake Lock API** — `navigator.wakeLock.request('screen')` keeps the screen on (where supported). Released cleanly on stop.
2. **Silent audio loop** — A 1-second silent `AudioBufferSourceNode` looped via Web Audio. iOS Safari treats audible playback as a foreground activity even when the screen is off, which keeps the JS event loop alive long enough for GPS fixes to dispatch. The buffer is silent (zeros) so no sound plays.

`startSilentAudio()` runs synchronously **before** the `await` in `start()` — it must execute inside the user-gesture stack frame for iOS Safari to honor it. `acquireWakeLock()` runs after, since wake-lock has no gesture requirement.

The keepalive is owned by guidance (started on `enterGuiding`, stopped on `stopGuidance`). A `reacquireWakeLock()` method exists for the page-visibility-change path where the OS releases the lock when the tab backgrounds.

---

## 8. Bottom Sheet / Side Panel (`bottom-sheet.ts`)

webmap.dev adapts its info panel between mobile and desktop:

- **Mobile** (≤ 768 px): bottom sheet with four snap points (`hidden`, `peek`, `half`, `full`)
- **Desktop** (> 768 px): slide-in left side panel

**Snap points (mobile):**

| Snap | Position | Use |
|------|----------|-----|
| hidden | Off-screen below | Nothing to show |
| peek | 72 px visible | Hint to swipe up |
| half | Half viewport | Reading search results |
| full | Nearly full viewport | Long lists, detailed view |

**Drag gestures.** Drag handle for snap-changes; Escape dismisses. `> 60 px` deltas snap to the next level.

**iOS Safari `offsetHeight` trick.** Snap-point math uses the rendered element's `offsetHeight`, not `window.innerHeight` or CSS `vh` units. On older iOS Safari, `vh` is based on the largest viewport (toolbar hidden) while `innerHeight` reflects the current viewport — they disagree by up to ~75 px during scroll. `offsetHeight` matches what the user actually sees. See [ADR-003](adr/ADR-003-offsetheight-ios-safari.md).

The sheet is positioned `fixed` and translated with `translateY()` for GPU-accelerated animation. The CSS fallback `translateY(110%)` keeps it hidden until JS takes over.

**Map offset (mobile only).** When the sheet is at half height, the map center shifts upward so the focal point stays visible above the sheet. Desktop ignores the offset.

---

## 9. Consent Modal (`consent.ts`)

A first-run dialog blocks app initialization until the user accepts the privacy policy and terms of use. `CONSENT_VERSION` is the gate: `hasConsent()` returns true only when `localStorage.getItem('webmap-consent-version') === CONSENT_VERSION`. Bumping `CONSENT_VERSION` forces every existing user to re-accept.

**Layout.** A flex column with three zones — sticky title, scrollable body (Privacy then Terms), sticky button row. This keeps the action buttons visible on small screens where the legal text needs scrolling.

**Storage on accept.** `webmap-consent-version`, `webmap-consent-accepted-at` (ISO timestamp), and `webmap-consent-install-id` (anonymous UUID via `crypto.randomUUID()`). The install ID is generated once and never changes between accepts.

The current text discloses three third-party services: OpenStreetMap (tiles), Esri ArcGIS (geocoding), and FOSSGIS Valhalla (routing on explicit "Navigate here" only). `CONSENT_VERSION` was bumped to 2.2 when guidance landed.

---

## 10. Layers Control + Adaptive Control Labels (`layers-control.ts`, `controls.ts`)

A custom popover replaces Leaflet's native `L.control.layers`:

- One toggle button in the top-right column
- Radio buttons for base maps (CyclOSM Trails, OSM Streets, OpenTopo, Humanitarian)
- Checkboxes for overlays (Esri hillshade, defaulted on)
- Selection persisted to `localStorage` (`webmap-layer-selection`, `webmap-overlay-selection`)
- Re-stacks overlays above the base map after switching

**Adaptive labels.** Locate, Layers, and Download buttons start with a text label for discoverability and collapse to icon-only after first use. The shared `setupCollapsibleLabel()` helper in `controls.ts` reads `webmap-ctrl-label-<id>` from `localStorage`, skips appending the label when previously collapsed (avoiding a flash-then-collapse on reload), and persists the collapse on first click.

---

## 11. Offline Tile Strategy

Two layers of offline support work together — see [ADR-005](adr/ADR-005-offline-tile-strategy.md):

**Passive: Workbox runtime caching (`vite.config.ts`).** OSM tile requests (`*.tile.openstreetmap.org`) are intercepted with `StaleWhileRevalidate`: serve the cached tile immediately, refetch in the background. 500-entry cap, 30-day expiration. ESRI geocode requests are `NetworkOnly` — there is no useful offline behavior for a search query.

```typescript
runtimeCaching: [
  {
    urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: OSM_TILE_CACHE_NAME,
      expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
    },
  },
  {
    urlPattern: /^https:\/\/geocode\.arcgis\.com\/.*/,
    handler: 'NetworkOnly',
  },
]
```

**Proactive: Cache API pre-download (`offline-download.ts`).** Users select a bounding box and a min/max zoom range; the app pre-fetches every tile in the region directly into the same OSM tile cache (6 concurrent fetches matching browser per-domain limit, skipping already-cached tiles). The shared `OSM_TILE_CACHE_NAME` constant in `sw-constants.ts` is referenced by both the Vite config and the runtime download to avoid drift.

**Tile error fallback (`map.ts`).** When a tile request fails offline, `initOfflineTileFallback()` looks up the parent zoom-level tile in the OSM cache (up to 3 zoom levels above) and crops it onto a 256×256 canvas — degraded but visible. A 10-second cooldown limits the "tiles unavailable" toast to one fire per cluster of failures.

**App code** is precached by the build (Vite's PWA plugin). `clientsClaim: true` means a new SW activates on the next page load and `location.reload()` is fired automatically once the new SW takes control.

---

## 12. nginx Infrastructure

Production deploys land in `/var/www/webmap/web/dist/` and are served by nginx:

- **HSTS** — `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Browsers cache for 1 year.
- **SPA fallback** — `try_files $uri $uri/ /index.html` so client-side routing works without 404s.
- **Asset caching** — Hashed Vite assets (`*.js`, `*.css`, images, fonts) get `expires 1y; Cache-Control "public, immutable"`. Code changes get a new hash, so the immutable promise is safe.
- **HTML uncached** — `index.html` always re-fetches: `expires -1; Cache-Control "no-cache, no-store, must-revalidate"`.
- **Gzip** — JS/CSS/JSON compressed (~70% size reduction).
- **TLS** — Let's Encrypt certs via certbot; HTTP/2; auto-renew.
- **Apex redirect** — `webmap.dev` 301s to `https://www.webmap.dev`.
- **Hidden file lock-down** — `location ~ /\.` denies all (no `.env`, no `.git` exposure).
- **Security headers** — `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

See `infrastructure/nginx/www.webmap.dev.conf` for the canonical config.

---

## Summary

These patterns work together to keep webmap.dev small, responsive, and offline-tolerant:

1. **Single state** keeps the codebase simple and type-safe.
2. **Refcount** lets locate and guidance share GPS without coordination.
3. **Three-state locate button** matches the user's mental model of "follow / look / off".
4. **Haversine filter + heading wedge** clean up GPS noise and show direction without rotating the map.
5. **Guidance state machine** owns the routing → guiding ↔ off-route → arrived lifecycle.
6. **Device-orientation compass** complements the wedge while stationary.
7. **Keepalive** keeps GPS flowing with the screen off on iOS.
8. **Responsive sheet** adapts to mobile and desktop with the iOS `offsetHeight` workaround.
9. **Consent modal** gates third-party egress with explicit re-acceptance on `CONSENT_VERSION` bumps.
10. **Layers control + adaptive labels** keep the toolbar clean after first use.
11. **Two-tier offline** combines passive Workbox SWR with proactive Cache API pre-download.
12. **nginx** owns HTTPS, caching, and the SPA fallback at the edge.
