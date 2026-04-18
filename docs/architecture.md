# Architecture

webmap.dev is built around a **single shared AppState object** that flows through all modules by reference. No event emitters, no Redux, no observable chains — just TypeScript and mutable state. This section covers the eight key architectural patterns.

## 1. Single Shared State (types.ts)

The entire application state lives in one TypeScript interface (`AppState`) defined in `types.ts`:

```typescript
export interface AppState {
  // GPS position tracking
  youAreHereLocation: L.LatLng | null;
  youAreHereLocationlat: number;
  youAreHereLocationlng: number;
  prior: number; // last known accuracy in meters

  // Control toggle states
  copyToClipboard: boolean;
  locateState: LocateState; // 'off' | 'active' | 'passive'

  // Timer/polling state
  updateCallback: number; // refcount: 0=stopped, 1+=running
  timer: ReturnType<typeof setTimeout> | undefined;
  initialZoom: boolean;

  // Recording state machine
  recordingState: RecordingState; // 'idle' | 'recording' | 'paused'
  recordingStartMs: number;
  recordingPauseMs: number;
  recordingPauseStart: number | null;
  totalDistance: number;
  trailPoints: Array<{ latlng: L.LatLng; t: number; speedMs: number }>;
  // ... more fields for trail visualization
}
```

**Why single state?** At this application scale, the indirection of event buses, actions, and dispatch functions adds more code than it saves. TypeScript's strict mode (`noUncheckedIndexedAccess`, strict equality) prevents the worst footguns of mutable state.

**Pattern:** `main.ts` calls `createInitialState()` once, then passes the state object by reference to all module initialization functions. Each module mutates state directly:

```typescript
// main.ts
const state = createInitialState();
addLocateControl(map, () => {
  // Toggle the state directly
  state.locateState = state.locateState === 'off' ? 'active' : 'off';
});

// controls.ts receives state from main.ts and mutates it
state.copyToClipboard = !state.copyToClipboard;
```

**Type safety:** AppState enforces all properties and types at compile-time. Typos, wrong types, and undefined fields are caught immediately.

---

## 2. GPS Polling Refcount (timer.ts + main.ts)

Leaflet's `map.locate()` is one-shot; to track the user continuously, we need a polling loop. **Two independent features need GPS polling:**
1. **Locate button** (following the user)
2. **Recording** (capturing trail points)

Both must request/release polling independently without interfering.

**The refcount solution:**

```typescript
// In AppState
updateCallback: number; // 0 = stopped, 1 = locate active, 2 = locate + recording

// In main.ts
function activatePolling(): void {
  state.updateCallback += 1;
  if (state.updateCallback === 1) {
    scheduleUpdateCallback(state, map, 3000); // initial delay
  }
}

function deactivatePolling(): void {
  state.updateCallback -= 1;
  if (state.updateCallback === 0) {
    cancelUpdateCallback(state, map); // stop the timer entirely
  }
}
```

**How it works:**
- When locate turns on, `activatePolling()` increments the refcount from 0 → 1 and starts the timer.
- When recording starts, `activatePolling()` increments again: 1 → 2 (timer already running, so do nothing).
- When recording stops, `deactivatePolling()` decrements: 2 → 1 (timer keeps running for locate).
- When locate turns off, `deactivatePolling()` decrements: 1 → 0 (timer stops).

**timer.ts implementation:**

```typescript
export function scheduleUpdateCallback(state: AppState, map: L.Map, delayMs = 500): void {
  if (state.timer !== undefined) clearTimeout(state.timer);
  state.timer = setTimeout(() => updateLocation(state, map), delayMs);
}

function updateLocation(state: AppState, map: L.Map): void {
  map.stopLocate();
  if (state.initialZoom) {
    map.setZoom(16);
    state.initialZoom = false;
  }
  map.locate({ setView: false, maxZoom: map.getZoom() });
  scheduleUpdateCallback(state, map); // reschedule for next cycle
}
```

**Why the 3-second initial delay?** When the locate button is clicked, `map.locate()` is called immediately (within the user gesture so iOS Safari shows the permission prompt). The 3-second delay gives that request time to resolve before the 500ms polling loop starts.

---

## 3. Three-State Locate Button

The locate button has three distinct states, each with different behavior:

| State | Icon | Behavior |
|-------|------|----------|
| **off** | Lines (disabled) | Location disabled; no polling |
| **active** | Color (blue) | Following user; map pans to position on each update |
| **passive** | B&W (gray) | Dot visible but not following; tap to re-center |

**State transitions (in main.ts):**

```typescript
addLocateControl(map, () => {
  switch (state.locateState) {
    case 'off':
      state.locateState = 'active';
      map.locate({ setView: false, maxZoom: map.getZoom() }); // immediate request
      activatePolling(); // start timer
      updateLocateIcon('active');
      break;

    case 'active':
      state.locateState = 'off'; // turn off
      deactivatePolling(); // stop timer
      clearLocationMarkers(state, map);
      updateLocateIcon('off');
      break;

    case 'passive':
      state.locateState = 'active'; // re-center
      map.flyTo(state.youAreHereLocation, map.getZoom(), { duration: 0.8 });
      updateLocateIcon('active');
      break;
  }
});

// Pan while following → drop to passive
map.on('dragstart', () => {
  if (state.locateState === 'active') {
    state.locateState = 'passive';
    updateLocateIcon('passive');
  }
});
```

**Why three states?** Users expect to swipe/pan the map freely without the app fighting them. The active→passive transition lets them view other parts of the map while keeping the blue dot visible as a "return to me" button.

---

## 4. Haversine Jitter Filter (location.ts)

GPS fixes arrive noisy: standing still, you get position updates every 500ms within a ~10m circle. Recording every fix wastes memory and creates jagged trails. The haversine formula filters redundant updates.

**The filter rule (in location.ts):**

```typescript
// Accept update if accuracy improved OR we've moved meaningfully
if (e.accuracy < state.prior || dist > e.accuracy / 2) {
  state.prior = e.accuracy;
  state.youAreHereLocationlat = e.latlng.lat;
  state.youAreHereLocationlng = e.latlng.lng;
  // update markers, trail, etc.
}
```

**How it works:**
- `state.prior` tracks the best accuracy we've ever seen (lower = better).
- When a new fix arrives, calculate the haversine distance from the last position.
- If accuracy improved (e.g., 15m → 10m), accept the update even if we didn't move — the dot becomes more precise.
- If we moved more than half the accuracy radius (e.g., moved 6m when accuracy is 12m), accept the update — we've moved meaningfully.
- Otherwise, ignore the fix — it's just noise.

**Haversine formula (great-circle distance):**

```typescript
const p = Math.PI / 180;
const f =
  0.5 -
  Math.cos((latA - latB) * p) / 2 +
  (Math.cos(latB * p) * Math.cos(latA * p) * (1 - Math.cos((lngA - lngB) * p))) / 2;
const R = 6371000; // Earth's radius in meters
const dist = 2 * R * Math.asin(Math.sqrt(f));
```

**Effect on trail recording:** Trail points are appended via `appendTrailPoint()` only when:
1. The haversine filter accepts the location update, AND
2. The new point is at least 5m from the previous trail point (MIN_TRAIL_DIST_M).

This gives clean, compressed trails.

---

## 5. Recording State Machine (recording.ts)

Trail recording is a three-state machine: **idle** → **recording** → **paused** (or back to idle).

**State diagram:**
```
idle
  ↓ (click Record button; requires locate on)
recording
  ├→ (click Pause button) → paused
  └→ (click Stop button) → [export GPX] → idle
paused
  ├→ (click Resume button) → recording
  └→ (click Stop button) → [export GPX] → idle
```

**Key state fields:**

```typescript
recordingState: 'idle' | 'recording' | 'paused';
recordingStartMs: number;               // performance.now() when started
recordingPauseMs: number;               // total accumulated pause duration (ms)
recordingPauseStart: number | null;     // performance.now() when paused (null if not paused)
totalDistance: number;                  // total distance in meters
trailPoints: Array<{
  latlng: L.LatLng;                    // position
  t: number;                           // performance.now() timestamp
  speedMs: number;                     // m/s from GPS
}>;
trail: L.Polyline | null;              // main trail line (blue)
trailGlow: L.Polyline | null;          // glow underneath (transparent blue)
arrowMarkers: L.Marker[];              // direction arrows every ~50m
```

**Trail visualization:**

When recording starts, two Leaflet polylines are created:
1. **Glow layer** (beneath): semi-transparent blue, weight 14, creates depth illusion
2. **Main trail** (on top): solid blue, weight 4, sharp edges

Direction arrows are placed every 50m (`MIN_ARROW_DIST_M`) to show travel direction.

**Elapsed time calculation (accounting for pauses):**

```typescript
function elapsedMs(state: AppState): number {
  const currentPause =
    state.recordingPauseStart !== null
      ? performance.now() - state.recordingPauseStart
      : 0;
  return performance.now() - state.recordingStartMs - state.recordingPauseMs - currentPause;
}
```

This ensures paused time doesn't count toward the elapsed display.

**Stats bar (real-time display):**

Every 1 second, the stats bar updates with:
- **Time**: formatted elapsed (H:MM:SS or MM:SS)
- **Distance**: total distance (km or m)
- **Speed**: current speed from the latest GPS fix (km/h or "-- km/h" if stopped)
- **Status indicator**: pulsing red dot (animated, paused state dims it)

**GPX export:**

When recording stops, if trail points exist, `downloadGpx()` generates a GPX 1.1 file:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="webmap.dev" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>2026-03-31 12:34:56</name>
    <trkseg>
      <trkpt lat="37.123456" lon="-122.123456">
        <time>2026-03-31T12:34:56.000Z</time>
        <extensions><speed>5.1234</speed></extensions>
      </trkpt>
      <!-- more points -->
    </trkseg>
  </trk>
</gpx>
```

The file is automatically downloaded via `createElement('a') + click()`.

---

## 6. Bottom Sheet / Side Panel (bottom-sheet.ts)

webmap.dev adapts its UI between mobile and desktop:

- **Mobile** (≤768px width): Bottom sheet with four snap points (hidden, peek, half, full)
- **Desktop** (>768px): Slide-in side panel (left side)

Both show search results, reverse geocode locations, and any other contextual info.

**Mobile bottom sheet snap points:**

| Snap Point | Position | Use Case |
|-----------|----------|----------|
| **hidden** | Off-screen below | No info to show |
| **peek** | Bottom 72px visible | "Swipe up to see results" hint |
| **half** | Half viewport height | Reading search results |
| **full** | Nearly full viewport | Detailed view, long lists |

**Drag gesture (mobile only):**

- Users can drag the handle to snap to different heights.
- Swipe down (> 60px delta) → next lower snap point.
- Swipe up (< -60px delta) → next higher snap point.
- Keyboard: Escape key dismisses the sheet.

**Implementation:**

`fullHeightPx()` uses `_el.offsetHeight` (the actual rendered element height) rather than computing from `window.innerHeight`. On older iOS Safari, CSS `vh` units and `window.innerHeight` disagree — `vh` is based on the largest viewport (toolbar hidden) while `innerHeight` reflects the current visible viewport. Using `offsetHeight` keeps snap-point calculations consistent with the rendered sheet size.

```typescript
function fullHeightPx(): number {
  if (_el) return _el.offsetHeight;
  return Math.round(window.innerHeight * SHEET_VH);
}
```

The sheet is positioned absolutely and transformed via `translateY()` for smooth GPU-accelerated animations. The CSS fallback `translateY(110%)` keeps it hidden until JS takes over.

**Map offset (mobile only):**

When the sheet is at half height, the map center shifts upward so the point of interest stays visible above the sheet. Desktop ignores the offset.

---

## 7. Consent Modal (consent.ts)

A first-run consent dialog blocks app usage until the user accepts privacy policy and terms of use. Re-prompts when `CONSENT_VERSION` changes.

**Layout:** The dialog uses a flex-column layout with three zones:
- **Title** (sticky top): One-line summary pinned at the top
- **Body** (scrollable): Privacy Policy followed by Terms of Use
- **Buttons** (sticky bottom): "I agree" and "Decline" pinned at the bottom

This ensures the title and action buttons remain visible on small screens where the legal text requires scrolling.

**Consent storage:** On acceptance, three values are written to localStorage:
- `webmap-consent-version` — current consent version string
- `webmap-consent-accepted-at` — ISO timestamp
- `webmap-consent-install-id` — anonymous UUID (generated once via `crypto.randomUUID()`)

**Version gating:** `hasConsent()` checks `localStorage.getItem('webmap-consent-version') === CONSENT_VERSION`. Bumping `CONSENT_VERSION` forces all users to re-accept.

---

## 8. Layers Control (layers-control.ts)

A custom layers popover replaces Leaflet's native `L.control.layers`. It provides a curated button + popover UI for base maps (radio buttons) and overlays (checkboxes).

**Features:**
- Single toggle button in top-left toolbar (label collapses to icon-only after first use)
- Popover with radio buttons for base maps and checkboxes for overlays
- Persists selection to localStorage (`webmap-layer-selection`, `webmap-overlay-selection`)
- Re-stacks overlays above the base map after switching layers

**Implementation:** `LayersControl` extends `L.Control`. The popover is positioned relative to the toggle button and dismisses on outside click, Escape key, or close button.

---

## 9. Offline Tile Download (offline-download.ts)

Proactive region pre-download supplements the passive service worker caching strategy. Users select a bounding box and zoom range, and the app pre-fetches tiles into the Cache API.

**Flow:**
1. User taps Download button → panel opens (bottom-anchored on mobile, collapsible header)
2. A draggable selection rectangle with corner handles appears on the map
3. Zoom range sliders (min/max) control which zoom levels to cache
4. Tile count and estimated size are calculated in real-time
5. Download fetches tiles in parallel (6 concurrent fetches, matching browser per-domain limit)
6. Already-cached tiles are skipped; progress bar shows completion

**Mobile UX:** The panel anchors to the bottom of the screen (not top) so it doesn't block the selection handles. The header is tappable to collapse/expand the panel body.

**Tile math:** `lng2tile()` and `lat2tile()` convert geographic bounds to tile coordinates at each zoom level. `countTiles()` sums across all requested zoom levels for the estimate.

---

## 10. Adaptive Control Labels (controls.ts)

Locate, Layers, and Download toolbar buttons start with text labels (e.g., "Locate", "Layers", "Download") for discoverability. After the first tap, the label is removed and only the icon remains, reclaiming screen space.

**Implementation:** `collapseControlLabel()` removes the `.leaflet-control-toggle__label` span from the control container. For controls using the `makeToggleControl` factory, a `collapseOnFirstUse` flag triggers this on first click. Layers and Download wire it independently via a `labelCollapsed` boolean in their click handlers.

---

## 11. PWA / Offline Strategy (vite.config.ts)

webmap.dev uses **vite-plugin-pwa** and **Workbox** to cache assets and enable offline use.

**Offline capabilities:**
- ✅ Maps (Mapbox, OpenStreetMap, Google Imagery) cached for 30 days
- ✅ App code (JS, CSS, HTML) cached indefinitely
- ✅ Reverse geocoding results (from the blue dot marker) cached
- ❌ Address search requires internet (API calls not cached)

**Caching strategies (Workbox):**

```typescript
workbox: {
  runtimeCaching: [
    // Mapbox tiles (SWR: stale-while-revalidate)
    {
      urlPattern: /^https:\/\/api\.mapbox\.com\/styles\/.*/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'mapbox-tiles',
        expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
    // OpenStreetMap tiles (SWR)
    {
      urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'osm-tiles',
        expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
    // Google Imagery (SWR)
    {
      urlPattern: /^https:\/\/.*\.google\.com\/vt\/.*/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'google-imagery',
        expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
    // ESRI Geocode API (NetworkOnly: must have internet)
    {
      urlPattern: /^https:\/\/geocode\.arcgis\.com\/.*/,
      handler: 'NetworkOnly',
      options: { cacheName: 'geocode-api' },
    },
  ],
  skipWaiting: true,
  navigateFallback: null,
}
```

**SWR strategy:** Serve cached tiles immediately; fetch fresh tiles in the background. On the next visit, fresh tiles appear.

**Manifest (for install prompt):**

```typescript
manifest: {
  name: 'webmap.dev',
  short_name: 'webmap',
  description: 'GPS mapping and trail recording with offline support',
  display: 'standalone',
  start_url: '/',
  scope: '/',
  theme_color: '#4CAF50',
  icons: [
    { src: '/logo-color-v1.1.svg', sizes: '192x192', type: 'image/svg+xml' },
    { src: '/logo-color-v1.1.svg', sizes: '512x512', type: 'image/svg+xml' },
  ],
}
```

Browsers show "Add to Home Screen" prompts when visited from a mobile browser.

---

## 12. nginx Infrastructure

Production deployment uses **nginx** as a reverse proxy, serving the Vite build from `/var/www/webmap/web/dist/`.

**Key nginx patterns:**

**HSTS (HTTP Strict Transport Security):**
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```
Browsers cache this for 1 year; all future visits are HTTPS-only, even if the user types `http://`.

**SPA fallback (single-page app routing):**
```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```
This tells nginx: if a request matches a file, serve it; if not, serve `/index.html`. The SPA router (Leaflet events) handles all URL routing client-side.

**Asset caching (hashed files):**
```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}
```
Vite appends content hashes to filenames (e.g., `main.a1b2c3d4.js`). Changing code = new hash = new URL = no cache clash. Safe to cache for 1 year.

**HTML (never cached):**
```nginx
location ~* \.html$ {
  expires -1;
  add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```
`index.html` changes on every deploy. Browsers must re-fetch to see updates.

**Gzip compression:**
```nginx
gzip on;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;
```
Compresses text assets (~70% size reduction) without CPU overhead on modern hardware.

**Security headers:**
```nginx
add_header X-Frame-Options SAMEORIGIN always;
add_header X-Content-Type-Options nosniff always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

**Deny hidden files:**
```nginx
location ~ /\. {
  deny all;
  access_log off;
  log_not_found off;
}
```
Prevents accidental exposure of `.env`, `.git`, etc.

**TLS/SSL:**
- Certificates from Let's Encrypt (via certbot)
- HTTP → HTTPS redirect (automatic)
- Apex domain (`webmap.dev`) redirects to `www.webmap.dev`
- HTTP/2 enabled for multiplexing

---

## Summary

These twelve patterns work together to create a lightweight, responsive GPS app:

1. **Single state** keeps the codebase simple and type-safe.
2. **Refcounting** lets locate and recording share the GPS polling loop.
3. **Three-state button** gives users intuitive control.
4. **Haversine filter** prevents trail jitter.
5. **State machine** cleanly handles recording start/pause/resume/stop.
6. **Responsive UI** adapts between mobile and desktop (with iOS Safari compatibility).
7. **Consent modal** gates first-run usage with sticky header/footer layout.
8. **Layers control** provides curated base map and overlay switching.
9. **Offline download** enables proactive tile pre-caching for offline use.
10. **Adaptive controls** collapse labels to icons after first use.
11. **Service worker** enables passive offline caching.
12. **nginx** handles HTTPS, caching, and SPA routing at the edge.
