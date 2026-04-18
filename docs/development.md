# Development Guide

## Environment Setup

### Prerequisites

- **Node.js** 18.0 or later (check with `node --version`)
- **npm** 9.0 or later (bundled with Node.js)
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
VITE_MAPBOX_TOKEN=pk.eyJ...                # Optional (falls back to OpenStreetMap)
VITE_ESRI_API_KEY=AAPKd...                 # Required for address search
```

**Getting tokens:**
- **Mapbox token**: Sign up at [mapbox.com](https://mapbox.com), create a public token on the Tokens page
- **ESRI API key**: Sign up at [arcgis.com](https://arcgis.com), create an API key in your dashboard

If you don't have these, the app still works:
- Without Mapbox token: OpenStreetMap tiles are used instead
- Without ESRI key: Address search is disabled (UI skipped, no error)

## Key Commands

All commands are run from the project root:

```bash
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Build production bundle → dist/
npm run preview      # Preview production bundle locally
npm run type-check   # Run TypeScript compiler in check-only mode
npm run lint         # Run ESLint
npm test             # Run unit tests (vitest)
```

### Development Workflow

1. **Start the dev server:**
   ```bash
   npm run dev
   ```
   The app opens at `http://localhost:5173`. Hot-module reloading (HMR) automatically refreshes your browser when files change.

2. **Edit source files** in `src/`:
   ```bash
   src/main.ts              # entry point
   src/types.ts             # AppState, interfaces
   src/map.ts               # Leaflet initialization
   src/location.ts          # GPS handling
   src/recording.ts         # Trail recording, GPX export
   src/geocoding.ts         # Search, reverse geocode
   src/controls.ts          # Toggle button factory, label collapse
   src/timer.ts             # GPS polling loop
   src/bottom-sheet.ts      # mobile/desktop info panel
   src/layers-control.ts    # Custom layers popover
   src/offline-download.ts  # Region tile pre-download
   src/consent.ts           # First-run consent modal
   src/battery.ts           # Battery drain estimation
   src/trail-backup.ts      # Crash recovery backup
   src/sw-constants.ts      # Service worker constants
   src/style.css            # styles
   ```

3. **Type-check and lint** before committing:
   ```bash
   npm run type-check && npm run lint
   ```

4. **Build for production:**
   ```bash
   npm run build
   npm run preview   # preview the built app locally
   ```

## File Structure Walkthrough

### `src/main.ts` — Entry Point

Wires all modules together:
- Creates `AppState` via `createInitialState()`
- Creates the Leaflet map
- Registers event handlers for location, controls, recording
- Implements the polling refcount (shared by locate and recording)

**Key patterns:**
- `activatePolling()` / `deactivatePolling()` — refcount-based GPS polling
- Toast notifications for user feedback
- Three-state locate button logic

### `src/types.ts` — Shared State

Defines `AppState` interface (all mutable application state) and `createInitialState()`.

Every module receives `state: AppState` and mutates it directly. No events, no dispatch — just TypeScript strict mode for type safety.

### `src/location.ts` — GPS Event Handler

Runs when a new GPS fix arrives (`map.on('locationfound')`):
- Applies haversine jitter filter
- Updates blue dot and accuracy circle
- Appends to trail if recording
- Pans the map if in "active" locate state

**Haversine filter:** Only accepts position updates if accuracy improved OR we've moved >0.5× the accuracy radius. Prevents recording noise when standing still.

### `src/timer.ts` — GPS Polling Loop

Schedules `map.locate()` every 500ms.

- `scheduleUpdateCallback()` — queue next location request
- `cancelUpdateCallback()` — stop the timer
- `updateLocation()` — fire location request and reschedule

Called by the polling refcount system in `main.ts`.

### `src/recording.ts` — Trail Recording & GPX Export

Implements the recording state machine (idle → recording → paused → idle).

**Key functions:**
- `addRecordingControl()` — create the record/pause/stop button panel
- `startRecording()` — initialize trail polylines and stats bar
- `appendTrailPoint()` — add a point to the trail (called by location.ts on each GPS fix)
- `downloadGpx()` — generate and download the GPX file

**Trail visualization:**
- Glow layer (semi-transparent blue, weight 14)
- Main trail (solid blue, weight 4)
- Direction arrows every ~50m

**Stats bar:** Real-time elapsed time, distance, speed updated every 1 second.

### `src/geocoding.ts` — Search & Reverse Geocoding

Uses ESRI ArcGIS and `esri-leaflet-geocoder`:

**Search:**
- Autocomplete search box with 3-character minimum
- Results appear in the info panel (bottom sheet on mobile, side panel on desktop)
- Clicking a result flies the map to that location

**Reverse geocoding:**
- Triggered by right-click (desktop) or long-press (mobile)
- Shows address and coordinates in the info panel

**Error handling:** Search errors are silenced (logged to console, not shown to user); if a search fails, an empty result set is shown.

### `src/controls.ts` — UI Controls

Creates reusable toggle buttons for the map toolbar via a factory function (`makeToggleControl`):

**Controls:**
- **Locate**: Three-state button (off → active → passive) with consistent outline icon shape across all states
- **Tracking**: Trail recording toggle

**Label collapse:** Controls with the `collapseOnFirstUse` flag strip their text label after the first tap, keeping only the icon. The exported `collapseControlLabel()` helper is also used by the Layers and Download controls.

Each button is a Leaflet control with SVG/emoji icon, styled container, and event handler.

### `src/layers-control.ts` — Custom Layers Popover

Replaces Leaflet's native `L.control.layers` with a button + popover UI:
- Radio buttons for base maps (OSM, Mapbox, Google)
- Checkboxes for overlays (hillshade)
- Persists selection to localStorage
- Re-stacks overlays above base map after switching

### `src/offline-download.ts` — Offline Tile Pre-Download

Lets users select a region and zoom range to pre-cache tiles via the Cache API:
- Draggable selection rectangle with corner handles
- Real-time tile count and size estimation
- Parallel download (6 concurrent fetches)
- Skips already-cached tiles
- Mobile: bottom-anchored panel with collapsible header

### `src/consent.ts` — Consent Modal

First-run consent dialog with sticky header/footer layout:
- Privacy Policy listed before Terms of Use
- Title and buttons pinned; legal text scrolls independently
- Consent version gating forces re-acceptance on content changes
- Stores consent record + anonymous install ID in localStorage

### `src/battery.ts` — Battery Estimation

Estimates remaining recording time based on battery drain rate during trail recording. Uses the Battery API when available; shown as a badge in the recording stats bar.

### `src/trail-backup.ts` — Trail Crash Recovery

Backs up in-progress trail recordings to localStorage for crash recovery. On reload during an active recording, offers to restore the trail from the backup.

### `src/bottom-sheet.ts` — Responsive Info Panel

Mobile-friendly bottom sheet (drag, snap points) + desktop side panel.

**Mobile (≤768px width):**
- Snaps to hidden, peek, half, or full height
- Draggable handle; swipe up/down to snap
- Map pans to keep POI visible when at half height

**Desktop (>768px width):**
- Slide-in left panel
- Fixed size
- Click close button or press Escape to hide

**Snap points (mobile):**
- **Hidden**: Off-screen below
- **Peek**: 72px visible (hint to swipe up)
- **Half**: Half viewport height
- **Full**: Nearly full viewport

### `src/map.ts` — Leaflet Initialization

Creates the Leaflet map and configures tile layers:

**Tile layers:**
- **Mapbox outdoors** (primary, with token): best trail/topographic data
- **OpenStreetMap** (fallback, free): general-purpose
- **Google Satellite** (optional): imagery context

Users can switch layers via the layer picker (top-left).

**Controls:**
- Zoom in/out (top-left)
- Layer picker (top-left)
- Scale bar (bottom-left)
- Zoom level indicator (bottom-left, very subtle)

**Performance tuning:**
- `preferCanvas: true` — canvas rendering instead of SVG (faster)
- `zoomSnap: 0, zoomDelta: 0.5` — smooth fractional zoom levels
- `keepBuffer: 3` — cache extra tiles for smooth panning
- `updateWhenZooming: false` — defer tile loads during pinch zoom

### `src/style.css` — Styles

Contains all app styles:
- Map container and responsive layout
- Control buttons (locate, clipboard, record, pause, stop)
- Recording stats bar (positioned top-left)
- Blue dot and accuracy circle (CSS animations)
- Info panel / bottom sheet (responsive breakpoints)
- Offline banner
- Toast notifications
- Version badge (button) + changelog panel

**Key classes:**
- `.blue-dot`, `.blue-dot--gray` — pulsing location dot
- `.recording-stats` — stats bar
- `.info-panel`, `.info-panel--visible` — side panel
- `.offline-banner` — offline indicator
- `.locate-toast` — notification messages

## Adding a New Feature

**Example: Add a waypoint marker feature**

1. **Update AppState** (`src/types.ts`):
   ```typescript
   export interface AppState {
     // existing fields...
     waypoints: L.Marker[];
   }

   export function createInitialState(): AppState {
     return {
       // existing fields...
       waypoints: [],
     };
   }
   ```

2. **Create a new module** (`src/waypoints.ts`):
   ```typescript
   import L from 'leaflet';
   import type { AppState } from './types';

   export function addWaypointControl(map: L.Map, state: AppState): void {
     // Create a button to add waypoints
     // On click, prompt user for waypoint name
     // Create marker on current map center
     // Push to state.waypoints
   }

   export function removeWaypoint(state: AppState, map: L.Map, index: number): void {
     // Remove from state and map
   }
   ```

3. **Wire it in main.ts**:
   ```typescript
   import { addWaypointControl } from './waypoints';

   addWaypointControl(map, state);
   ```

4. **Add UI in style.css** for the waypoint markers.

5. **Test** with `npm run type-check && npm run lint && npm test`.

## TypeScript Conventions

The project uses **strict mode** with **noUncheckedIndexedAccess**:

```typescript
// ✅ Good
const state: AppState = createInitialState();
state.youAreHereLocation = e.latlng;  // type-safe

// ❌ Bad (TypeScript error)
const state: any = createInitialState();
state.unknownField = 123;  // error: no such property
```

**ES2020 target:**
- Modern async/await, destructuring, optional chaining (`?.`)
- Avoid ES2022+ features (e.g., `new Error('msg', { cause })`)

**Import style:**
```typescript
import type { MyType } from './types';  // types only (stripped at build time)
import { myFunction } from './utils';    // values
import L from 'leaflet';                 // default exports
```

## Testing

The project uses **vitest** for unit tests alongside type-checking and linting:

1. **Unit tests:** `npm test`
   - Tests live alongside source files (e.g., `src/geocoding.test.ts`)
   - Run with `npm test` or `npx vitest`

2. **Type-check:** `npm run type-check`
   - Catches typos, type mismatches, missing fields
   - Run before every commit

3. **Lint:** `npm run lint`
   - ESLint checks code style and common mistakes
   - Run before every commit

4. **Manual browser testing:**
   - Start `npm run dev`
   - Test the features you changed
   - Check mobile layout (DevTools → device emulation)
   - Test offline mode (DevTools → Network tab → select "Offline")

**Test scenarios for common features:**
- **Locate button**: Click three times and verify state transitions (off → active → passive → off)
- **Trail recording**: Record a short trail, pause, resume, stop; verify GPX file downloads
- **Search**: Search for a place, select a result, verify map zooms and info panel shows
- **Reverse geocode**: Right-click or long-press the map, verify address appears
- **Offline**: Stop the server, enable offline mode in DevTools, verify tiles load from cache

## Batching (Important for Contributors)

When reading multiple files in the codebase, batch your reads together in a single API call:

❌ **Inefficient:**
```typescript
// Read file 1
// wait for result
// Read file 2
// wait for result
```

✅ **Efficient:**
```typescript
// Read file 1, file 2, file 3 — all at once
// Process results together
```

This pattern also applies when using Grep or Glob to search the codebase.

## Quality Gate (Before Committing)

Always run this before committing:

```bash
npm run type-check && npm run lint && npm run build
```

All three must pass:
- `type-check` — no TypeScript errors
- `lint` — no style issues
- `build` — production bundle builds successfully

If any fail, fix the issue and re-run until all three pass.

## Performance Tips

- **GPS polling**: Default is 500ms; faster polling (e.g., 100ms) drains battery on mobile
- **Trail points**: Haversine filter (5m minimum distance) keeps memory usage low even on long hikes
- **Tile caching**: PWA caches tiles to 500 entries per layer; beyond that, oldest tiles are evicted
- **Map rendering**: Use `preferCanvas: true` for better performance with many polylines

## Debugging

**Browser DevTools:**
- **Console**: Check for errors/warnings (search APIs, geocoding errors, etc.)
- **Network tab**: Inspect tile requests, API calls, cache hits/misses
- **Application tab**: Inspect service worker, cached data, offline status
- **Performance tab**: Profile the app during recording (map panning, trail rendering)

**Local development:**
- Edit `src/types.ts` to add console.log statements in AppState fields
- Or add breakpoints in DevTools
- Use `npm run preview` to test production build locally

## Contributing

See the **Contributing** section in `README.md` for PR guidelines.
