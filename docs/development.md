# Development Guide

## Environment Setup

### Prerequisites

- **Node.js** 22 or later (matches the GitHub Actions runner)
- **npm** 10 or later (bundled with Node.js)
- A code editor (VS Code, Vim, etc.)

### Installation

```bash
git clone https://github.com/jasoneplumb/webmap.dev.git
cd webmap.dev
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```
VITE_ESRI_API_KEY=AAPKd...     # Required for address search and reverse geocoding
```

**Getting tokens.** Sign up at [arcgis.com](https://arcgis.com) and create an API key in the developer dashboard. Without the key the search control is skipped at startup (no broken UI) and reverse geocoding silently returns coordinates only.

The four base maps (CyclOSM, OSM Streets, OpenTopo, Humanitarian) and the Esri hillshade overlay all use free, public endpoints — no token required.

## Key Commands

All commands are run from the project root:

```bash
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Build production bundle → dist/
npm run preview      # Preview production bundle locally
npm run type-check   # TypeScript compiler in check-only mode
npm run lint         # ESLint
npm test             # Run unit tests (vitest)
npm run size         # size-limit check (≤103 kB gzipped)
npm run og           # Regenerate the social-preview OG image (uses sharp)
npm run icons        # Regenerate the maskable PWA icons
npm run screenshots  # Regenerate the README preview screenshots (see below)
```

### Regenerating the README screenshots

`npm run screenshots` rewrites every PNG in `docs/images/` from the live app —
`scripts/capture-screenshots.mjs` boots its own Vite dev server, drives headless Google
Chrome over the DevTools protocol, and captures one 393×852 shot per scene (the scenes,
with their base map, overlays, and map centre, are declared at the top of that file).

- **`.env` must be populated.** The Thunderforest key backs the Cycle and Outdoors bases;
  the ESRI key backs search and reverse geocoding. Without them those scenes capture
  error tiles or time out.
- **The ESRI key is referrer-restricted to `www.webmap.dev`,** so Chrome is launched with
  `--host-resolver-rules` pointing that hostname at the loopback dev server. The page is
  genuinely served from the origin the key expects; nothing outside the browser process
  is changed, and no `/etc/hosts` edit is needed.
- Pass substrings to capture a subset: `npm run screenshots -- nav layers`.
- `DEBUG=1 npm run screenshots` forwards the page's console and uncaught exceptions,
  which is the fastest way to see why a scene stalled.
- Chrome is found at the standard macOS path; override with `CHROME_PATH`.

Framing depends on the DEV-only `window.__webmapMap` handle set in `main.ts`
(`import.meta.env.DEV`, so it is dropped from production builds).

### Development Workflow

1. **Start the dev server:**

   ```bash
   npm run dev
   ```

   The app opens at `http://localhost:5173`. Vite's HMR refreshes your browser when files change.

2. **Edit source files** in `src/`:

   ```text
   main.ts              # entry point — wires modules; owns the GPS polling refcount
   types.ts             # AppState + GuidanceState; createInitialState()
   map.ts               # Leaflet init; tile layers; offline tile fallback
   controls.ts          # Toggle button factory; locate-icon updater; setupCollapsibleLabel
   geocoding.ts         # ESRI search dropdown + reverse-geocode bar
   location.ts          # GPS handler — haversine filter, blue dot, heading wedge
   timer.ts             # map.locate({ watch }) wrapper with adaptive accuracy
   guidance.ts          # Routed-guidance state machine + bottom-left pill UI
   routing.ts           # FOSSGIS Valhalla client + polyline6 decoder
   geo.ts               # Pure helpers: haversineDistance, bearingDeg, pointToSegmentMeters
   compass.ts           # Top-right compass rose
   orientation.ts       # DeviceOrientationEvent wrapper + iOS-13+ permission gate
   keepalive.ts         # Wake Lock + silent-audio loop for background GPS
   layers-control.ts    # Custom layers popover
   offline-download.ts  # Region pre-download UI; parallel Cache API writes
   bottom-sheet.ts      # Mobile snap-point sheet + desktop side panel
   battery.ts           # Battery API monitoring
   consent.ts           # First-run consent modal
   sw-constants.ts      # Shared OSM tile cache name
   style.css            # All app styles
   ```

3. **Quality gate before committing:**

   ```bash
   npm run type-check && npm run lint && npm test && npm run build
   ```

4. **Production preview:**

   ```bash
   npm run build
   npm run preview
   ```

## File Structure Walkthrough

### `src/main.ts` — Entry Point

Wires all modules together:

- Gates the entire app behind `hasConsent()` — runs the consent modal first if needed.
- Creates `AppState` via `createInitialState()` and the Leaflet map via `createMap()`.
- Implements the GPS polling refcount (`activatePolling` / `deactivatePolling`) shared by locate and guidance.
- Owns the toast helper, the three-state locate button transitions, and the changelog panel.
- Registers the service worker via `vite-plugin-pwa`'s `registerSW`. `onNeedRefresh` defers `updateSW(true)` to a `requestAnimationFrame` so iOS Safari doesn't blank-page during init.

### `src/types.ts` — Shared State

Defines `AppState`, `LocateState`, `GuidanceStatus`, `GuidanceState`, and the `createInitialState()` factory. Every module receives `state: AppState` and mutates it directly. No events, no dispatch — TypeScript strict mode (`noUncheckedIndexedAccess`) provides the safety.

### `src/location.ts` — GPS Handler

Runs on every Leaflet `locationfound` event:

- Tracks raw accuracy on `state.lastGpsAccuracy` for the weak-signal badge hysteresis (2-streak debounce, 25–30 m deadband).
- Applies the **haversine jitter filter**: accept the fix if accuracy improved or distance moved > accuracy/2.
- Updates the blue dot, accuracy circle, and the heading-cone wedge via the `--heading-deg` CSS custom property.
- Holds the last valid bearing for 10 seconds when `e.heading` is `NaN`.
- Calls `updateGuidance()` to advance the navigation state machine.
- Switches between high and low GPS accuracy via `setWatchAccuracy()` after 5 stationary samples.
- Pans the map when `locateState === 'active'`.

`onLocationError()` grays the dot on signal loss; `clearLocationMarkers()` removes the dot and circle when locate is turned off.

### `src/timer.ts` — GPS Watch Wrapper

Thin wrapper over Leaflet's `map.locate({ watch: true })`:

- `startWatching()` — high-accuracy watch.
- `stopWatching()` — `map.stopLocate()`.
- `setWatchAccuracy(map, high)` — restarts the watch with a different `enableHighAccuracy` / `maximumAge`. There's a brief gap; acceptable trade-off for the battery savings while stationary.

### `src/guidance.ts` — Routed-Guidance State Machine

Implements the `idle → routing → guiding ↔ off-route → arrived → idle` flow.

**Public API:**

- `startGuidance(state, map, dest, showToast?)` — kicks off `routing`; transitions to `guiding` on success.
- `stopGuidance(state, map)` — aborts in-flight fetch, removes route polylines + destination marker, releases the polling refcount, and resets the state.
- `updateGuidance(e, state, map)` — called by `location.ts` on every accepted GPS fix. No-op when `idle`/`routing`/`arrived`. Computes off-route distance, advances the current step on proximity to the next maneuver, triggers `setArrived()` on arrival, and triggers `maybeRecalc()` on a 3-fix off-route streak (throttled to once per 15 s).

**Render survives jitter.** The pill's HTML is rebuilt on every fix. Click handlers live on the persistent panel element via **delegation** (`closest('.guidance-btn')`), not on the buttons themselves — iOS Safari's touch-to-click synthesis would otherwise drop taps when the button DOM node was destroyed mid-tap.

### `src/routing.ts` — Valhalla Client

- `fetchRoute(req)` — POSTs to `https://valhalla1.openstreetmap.de/route` with `start`, `dest`, `costing`, `directions_options.units = 'kilometers'`. AbortController-friendly via `req.signal`.
- `decodePolyline6(s)` — inline polyline6 decoder (Valhalla's twice-precision variant of Google polyline5).
- Types: `Costing` (`'auto' | 'pedestrian' | 'bicycle'`), `Route`, `RouteStep`, `RouteRequest`.

The `VALHALLA_URL` constant is the **single egress point** — replacing the routing provider is a one-line change.

### `src/geo.ts` — Pure Math Helpers

- `haversineDistance(lat1, lng1, lat2, lng2)` — great-circle distance in meters.
- `bearingDeg(a, b)` — initial bearing in degrees (0 = N, 90 = E).
- `pointToSegmentMeters(p, a, b)` — closest distance from a point to a segment, equirectangular with `cos(lat)` correction. Used by guidance for off-route detection.

All three are unit-tested in `geo.test.ts`.

### `src/compass.ts` — Device-Orientation Compass

Top-right SVG rose that rotates by `-deviceHeading` so true north stays at the top. Tap to enable; on iOS 13+ this triggers `requestOrientationPermission()`. Subscribes to `deviceorientationabsolute` (preferred) or `deviceorientation` and updates the `--heading-deg` CSS custom property on every event.

### `src/orientation.ts` — Permission Gate

- `requestOrientationPermission()` — calls iOS's `DeviceOrientationEvent.requestPermission()` if present; returns `'granted'` on platforms without the static method (no prompt needed); `'unsupported'` if `DeviceOrientationEvent` is missing entirely (desktop).
- `subscribeOrientation(onHeading)` — wires the event listener and returns an unsubscribe callback.
- `extractHeading(event)` — prefers iOS `webkitCompassHeading` (true-north, clockwise); falls back to W3C `alpha` flipped to clockwise.

### `src/keepalive.ts` — Background-GPS Helper

`Keepalive.start()` synchronously kicks off a silent 1-Hz `AudioBufferSourceNode` loop (must run inside the user-gesture stack on iOS Safari), then awaits `navigator.wakeLock.request('screen')`. `stop()` releases both. `reacquireWakeLock()` exists for the page-visibility-change path.

### `src/geocoding.ts` — Search & Reverse Geocoding

Uses ESRI ArcGIS via `esri-leaflet-geocoder`:

- **Forward search** — geosearch widget at top-left with autocomplete (3-character minimum, 250 ms debounce). Results render in a floating dropdown; each row exposes "Go to location" and "Navigate here" buttons.
- **Reverse geocode** — fired by double-click (desktop) or long-press (mobile). The pin and a bottom geocode bar with Copy / Navigate / Close actions appear; the pin is draggable and the bar updates with each new position.

Provider methods (`results` / `suggest`) are wrapped to silence and log errors instead of breaking the autocomplete spinner.

### `src/controls.ts` — UI Controls

`makeToggleControl(config)` — factory for icon-only Leaflet controls. Handles click + touchend (with `preventDefault` to avoid double-fire on mobile), label collapse, and propagation suppression so taps don't pass through to the map.

`setupCollapsibleLabel(container, label, storageKey)` — shared first-use label-collapse logic. Reads `webmap-ctrl-label-<id>` from `localStorage`, skips the label entirely when previously collapsed (avoiding a flash-then-collapse on reload), and persists the collapse on first click. Used by Locate, Layers, and Download.

`addLocateControl(map, onClick)` and `updateLocateIcon(state)` own the three-state icon swap.

### `src/layers-control.ts` — Custom Layers Popover

Replaces Leaflet's native `L.control.layers`:

- One toggle button in the top-right column, label collapsed after first use.
- Popover with radio buttons for base maps and checkboxes for overlays.
- Persists selections to `localStorage` (`webmap-layer-selection`, `webmap-overlay-selection`).
- Re-stacks overlays above the base map after switching — overlays must be removed and re-added to render on top.

### `src/offline-download.ts` — Region Pre-Download

- Toggle button in the top-right column with collapsible label.
- Bottom-anchored panel (mobile) with a draggable selection rectangle and corner handles on the map.
- Min/max zoom sliders; tile count and size estimate update live via `lng2tile()` / `lat2tile()`.
- Parallel fetch (6 concurrent, matching browser per-domain limit) into the same OSM cache (`OSM_TILE_CACHE_NAME`) the service worker uses; skips already-cached tiles.

### `src/bottom-sheet.ts` — Responsive Info Panel

- **Mobile** (≤ 768 px): bottom sheet with snap points (hidden, peek, half, full). Drag the handle to snap; swipe deltas > 60 px advance to the next snap.
- **Desktop** (> 768 px): slide-in left side panel.
- Snap-point math uses `_el.offsetHeight` instead of `window.innerHeight` to dodge the iOS Safari `vh` vs `innerHeight` mismatch ([ADR-003](adr/ADR-003-offsetheight-ios-safari.md)).

### `src/consent.ts` — First-Run Consent

Shows the privacy policy + terms modal until the user accepts. `CONSENT_VERSION` gating forces re-acceptance on content changes. On accept, writes `webmap-consent-version`, `webmap-consent-accepted-at`, and `webmap-consent-install-id` (anonymous UUID) to `localStorage`.

### `src/battery.ts` — Battery API Monitoring

Subscribes to `navigator.getBattery()` events and populates `state.batteryLevel`, `state.batteryCharging`. The fields exist for future surfacing; no UI consumes them currently.

### `src/map.ts` — Leaflet Initialization

- Creates the map with `preferCanvas: true`, `zoomSnap: 0.5`, `zoomDelta: 0.5`, `maxZoom: 18`.
- Adds tile-loading spinner, scale, and zoom controls (all in the bottom-left cluster).
- Defines the four base layers (CyclOSM, OSM Streets, OpenTopo, Humanitarian) and the Esri hillshade overlay (with `className: 'hillshade-blend'` for the multiply blend).
- Wires `initOfflineTileFallback()` — on `tileerror`, looks up the parent-zoom tile in the OSM cache (up to 3 zoom levels above) and crops it onto a 256×256 canvas. Toast notifies the user with a 10-second cooldown.

### `src/style.css` — Styles

All app styles live here:

- Map container, responsive layout, safe-area insets
- Bottom-left thumb cluster (locate, zoom, scale, version badge, attribution)
- Top-right column (compass, layers, download)
- Blue dot, accuracy circle, heading-cone wedge (`conic-gradient` + `radial-gradient` mask)
- Numbered search markers
- Bottom sheet / side panel
- Geocode bar (peek / half / full states)
- Guidance pill (idle / routing / active / off-route / arrived)
- Hillshade multiply blend (`.hillshade-blend img.leaflet-tile`)
- Offline banner, toast notifications, version badge + changelog panel
- Consent modal

Key classes: `.blue-dot`, `.blue-dot--has-heading`, `.blue-dot--gray`, `.guidance-panel`, `.guidance-pill--*`, `.geocode-bar--peek`, `.compass-rose--active`, `.numbered-marker`, `.search-dropdown`, `.locate-passive-pulse`.

## Adding a New Feature

**Example: add a "share my location" button.**

1. **Update `AppState`** if you need persistent state (skip if not).

2. **Create a new module** (`src/share.ts`):

   ```typescript
   import L from 'leaflet';
   import type { AppState } from './types';

   export function addShareControl(
     map: L.Map,
     state: AppState,
     showToast: (msg: string, durationMs?: number) => void,
   ): void {
     // L.Control with an icon button that, on click, builds a geo: URL
     // from state.youAreHereLocation and calls navigator.share() or copies it.
   }
   ```

3. **Wire in `main.ts`:**

   ```typescript
   import { addShareControl } from './share';
   addShareControl(map, state, showToast);
   ```

4. **Style** the button in `style.css`.

5. **Test:** `npm run type-check && npm run lint && npm test`.

## TypeScript Conventions

Strict mode with `noUncheckedIndexedAccess`:

```typescript
const points: number[] = [1, 2, 3];
const first = points[0];   // type is `number | undefined`
if (first !== undefined) { /* now narrowed to number */ }
```

**ES2020 target.** Modern async/await, destructuring, optional chaining, nullish coalescing — but not ES2022+ features like `new Error('msg', { cause })`. The `target` is set in `vite.config.ts`.

**Import style:**

```typescript
import type { AppState } from './types';   // type-only (stripped at build)
import { fetchRoute } from './routing';     // values
import L from 'leaflet';                    // default exports
```

**Pattern for module-level state.** When a module needs to retain references between calls (e.g., the guidance panel element), prefer module-scoped `let`s with documented intent (`storedState`, `storedMap`) rather than passing them through every API. Reset them on `onRemove` if the lifecycle requires it.

## Testing

The project uses **vitest** for unit tests. Tests live alongside source files (`geo.test.ts`, `routing.test.ts`, `guidance.test.ts`, `geocoding.test.ts`, `location.test.ts`, `orientation.test.ts`, `bottom-sheet.test.ts`).

Run tests:

```bash
npm test            # one-off
npx vitest          # watch mode
```

**What we test.** Pure helpers (`geo.ts`), the polyline6 decoder, off-route detection math, geocoding URL construction, the orientation heading-extraction logic, and the bottom-sheet snap math. We do **not** stub Leaflet or the DOM — UI integration is verified manually in the browser.

**Manual browser testing checklist:**

- **Locate button** — three-state cycle (off → active → passive → off); drag drops to passive; double-tap re-centers; wheel-zoom drops to passive on the first turn.
- **Search** — type a query, verify results, "Go to location" flies and shows the geocode bar, "Navigate here" starts the guidance pill.
- **Reverse geocode** — long-press / double-click drops a pin and shows the geocode bar; drag the pin to refine; Copy and Navigate work.
- **Guidance** — Navigate to a destination; verify the maneuver text, distance countdown, ETA, and mode chip; deliberately walk off-route and verify recalc fires; arrive within the radius and verify the pill collapses.
- **Compass** — tap to enable; on iOS verify the permission prompt; rotate the device and verify the rose tracks.
- **Layers** — switch base maps; toggle hillshade; verify selections persist on reload.
- **Offline** — DevTools → Network → "Offline"; pan/zoom should keep working; tile-error fallback fills missing tiles from parent-zoom; offline banner appears.
- **Consent** — clear `webmap-consent-version` from `localStorage` and reload; verify the modal blocks interaction until accepted.

## Quality Gate (Before Committing)

Always run the full gate:

```bash
npm run type-check && npm run lint && npm test && npm run build
```

All four must pass. CI runs `npm test`; the other three are local-only checks that catch issues before push.

## Performance Tips

- **GPS polling** — Leaflet's watch dispatches at the OS-defined cadence (~1 Hz); the haversine filter drops jitter to keep the dot stable.
- **Adaptive accuracy** — high-accuracy GPS is the dominant battery cost; the 5-fix stationary downgrade saves significant power on long stops.
- **Trail / route polylines** — `preferCanvas: true` on the map gives meaningfully better performance than the default SVG renderer for polylines and many markers.
- **Tile caching** — both passive (Workbox SWR) and proactive (Cache API pre-download) write to the same `OSM_TILE_CACHE_NAME` so they share storage.
- **Bundle size** — `npm run size` enforces a 103 kB gzipped budget on `dist/assets/index-*.js`.

## Debugging

**Browser DevTools:**

- **Console** — search/geocoding errors are logged with the `[webmap]` prefix; refcount-leak warnings fire in dev when `state.updateCallback` drifts above 2 or below 0.
- **Network** — inspect tile requests (filter "tile" or "valhalla"), API calls, and SW cache hits/misses.
- **Application** → Service Workers, Cache Storage (`OSM_TILE_CACHE_NAME`), Local Storage (`webmap-*` keys).
- **Performance** — profile during navigation to spot Leaflet redraw spikes.

**Local development:**

- HMR keeps your map state across edits; use it.
- `npm run preview` serves the production bundle locally, including the service worker — useful for verifying offline behavior without deploying.
- Clear `localStorage` (`webmap-*` keys) and re-test the consent / collapse flows.

## Contributing

See `CONTRIBUTING.md` for the PR workflow.
