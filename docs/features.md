# Features

## Live GPS Tracking

**What it does.** Shows your real-time location on the map as a blue dot with an accuracy circle, plus a translucent heading-cone wedge that points in your GPS course.

**How to use:**

1. Tap the **Locate button** (arrow icon) in the bottom-left thumb cluster.
2. Your location appears as a blue dot; the gray circle around it shows the GPS accuracy (wider circle = less accurate).
3. The map automatically centers on your position and follows you as you move.

**Three-state button** (all states share the same outline arrow shape, only the color changes):

- **Off** (dark outline) — Location disabled; no blue dot, no polling.
- **Active** (blue) — Following — map pans to keep you centered on each accepted GPS fix.
- **Passive** (gray) — Blue dot visible but the map stops following (auto-entered when you drag or wheel-zoom). Tap the button to re-center; or, on touch devices, **double-tap the map** to re-center.

The "Locate" text label is shown on first load for discoverability and collapses to icon-only after the first tap (persisted in `localStorage`).

**Heading-cone wedge.** When GPS reports a course (`e.heading` from the Geolocation API), a translucent cone behind the blue dot rotates to match. At low speeds the browser reports `NaN`; the wedge holds the last valid bearing for ~10 seconds before fading out. The map itself never rotates — north stays up.

**Accuracy circle.**

- Larger circle = GPS is less accurate (typical: 10–50 m).
- Smaller circle = GPS is precise (typical: 5–10 m, often degraded indoors / in tunnels).
- Fill opacity scales with accuracy: more transparent when precise, more opaque when imprecise.

**GPS weak-signal badge.** When fixes are coarser than 30 m for 2 consecutive samples, a weak-signal badge appears. It hides again after 2 consecutive samples better than 25 m. The 25–30 m deadband prevents flicker.

**Adaptive accuracy.** After 5 consecutive stationary fixes (`speed < 0.5 m/s`) the watch downgrades to coarse GPS to save battery. On movement it restores high-accuracy. There's a brief gap during the switch — acceptable trade-off.

**Permission denial debouncing.** iOS Safari sometimes fires a transient `PERMISSION_DENIED` error before the first valid fix arrives. The locate flow waits 3 seconds for a fix to override the error before showing the "Location access is denied" sticky toast.

**Known limitations:**

- GPS requires a clear view of the sky; accuracy degrades indoors and in dense urban canyons.
- Heading wedge doesn't show direction-of-travel below ~1 m/s — use the compass widget for stationary orientation.

---

## Turn-by-Turn Routed Navigation

**What it does.** Fetches a driving / cycling / walking route from the [FOSSGIS Valhalla](https://valhalla1.openstreetmap.de/) public service and guides you with a maneuver pill, ETA, off-route recalculation, and arrival detection.

**How to use:**

1. Search for a destination, or long-press / right-click to drop a pin.
2. Tap **Navigate here** in the search dropdown row, or in the geocode-bar that appears at the bottom of the screen.
3. The bottom-left guidance pill enters **routing** state with a spinner, then transitions to **guiding** when the route arrives.
4. Follow the maneuver instructions; the pill updates on every accepted GPS fix with the current step, distance to maneuver, total remaining, and ETA.
5. Tap **Stop** at any time to cancel.

**Travel modes.**

- **auto** (driving) — default
- **pedestrian** (walking)
- **bicycle** (cycling)

The mode chip in the pill shows the active profile.

**State machine.** `idle → routing → guiding ↔ off-route → arrived → idle`. The full flow is documented in [docs/architecture.md §5](architecture.md#5-routed-guidance-state-machine-guidancets--routingts).

**Off-route recalculation.** A 3-fix streak farther than the profile threshold (driving 30 m / cycling 20 m / walking 15 m) from the route polyline triggers a recalc — throttled to once per 15 seconds. The pill displays "Off route — recalculating…" while the new route is being fetched. Recovery within tolerance returns the pill to the guiding state without recalculating.

**Arrival.** Triggered when straight-line distance to destination is within the profile radius (driving 25 m / cycling 15 m / walking 10 m). The pill displays "Arrived" for 3 seconds, then collapses.

**ETA.** Computed by scaling Valhalla's predicted leg duration by the share of distance still remaining — degrades gracefully if you stop or detour.

**Privacy disclosure.** Each route request sends start + destination to FOSSGIS. This is the only outbound traffic that depends on user-controlled coordinates beyond explicit search. The consent modal lists this explicitly; current `CONSENT_VERSION` is `2.2`.

**Known limitations:**

- The FOSSGIS public Valhalla server has no SLA — failures show a "Routing failed: …" toast and require a manual retry.
- Off-route detection uses point-to-segment distance, not on-route projection — it can confuse parallel paths (e.g., divided highways) by a few meters.
- ETA assumes Valhalla's posted-speed model and ignores live traffic.

---

## Device-Orientation Compass

**What it does.** Top-right compass rose that rotates so true north stays at the top, regardless of how the device is physically held. Complements the heading-cone wedge (which only works while moving).

**How to use:**

1. Tap the compass rose to enable.
2. On iOS 13+ the browser shows a permission prompt — tap **Allow**.
3. Once granted, the rose rotates with the device.

**Why two heading indicators?** The heading-cone wedge shows GPS course (direction of travel) and works only while moving. The compass shows where the device is physically pointing and works while stationary — most useful at junctions, when matching the map to your surroundings.

**Heading source.** Prefers iOS's `webkitCompassHeading` (true-north calibrated, clockwise). Falls back to the W3C `alpha` (anti-clockwise, flipped to clockwise) and the `deviceorientationabsolute` event when available.

**Known limitations:**

- Desktop platforms with no `DeviceOrientationEvent` hide the rose entirely.
- iOS-13+ permission must be requested from a user gesture; the prompt is silently suppressed if you call from a timer.
- Magnetic interference (cars, cases with magnets, indoor steel) can throw the heading off — a calibration figure-8 helps.

---

## Address Search & Autocomplete

**What it does.** Find places, addresses, and intersections via ESRI ArcGIS geocoding; results appear in a floating dropdown.

**How to use:**

1. Tap the **Search box** (top-left).
2. Type at least 3 characters (e.g., "Golden Gate", "market street").
3. The control debounces 250 ms between keystrokes; suggestions update as you type.
4. Tap a result to fly the map to that location and drop a numbered marker.
5. Each result row has two actions: **Go to location** (fly + show geocode bar) and **Navigate here** (start turn-by-turn guidance).

**Search behavior:**

- **3-character minimum** — shorter queries don't fire.
- Results are biased toward the current map center when zoomed in to level 7+; below that, the bbox is omitted (avoids the world-bbox returning no results at low zoom).
- Up to 15 results.
- Numbered markers (1–15) show on the map; the active result is highlighted.
- iOS keyboard "Done" button is honored as a synthetic Enter so search fires on blur.

**Error handling.** Search and suggest errors are logged to the console and presented as empty result sets — no broken UI, no error toasts on every keystroke.

**Known limitations:**

- Search requires internet; it silently returns nothing offline.
- ESRI coverage is worldwide but small / very local places may be missing.
- Spelling matters: "Sn Frsiscco" won't find "San Francisco".
- Without `VITE_ESRI_API_KEY` configured, the search control is skipped entirely at startup.

---

## Reverse Geocoding (Pin Drop)

**What it does.** Drop a pin anywhere on the map and look up the address at that location.

**How to use:**

- **Desktop:** double-click on any location.
- **Mobile:** long-press (~700 ms) on any location.

A pin drops at the tapped position and a **geocode bar** slides up at the bottom of the screen with:

- **Address** — human-readable (street, city, region, postal code), or the coordinates as a fallback when geocoding has nothing usable.
- **Copy** — copies the address + coordinates to the clipboard.
- **Navigate** — starts turn-by-turn guidance to the pin.
- **Close** — dismisses the bar (the pin stays).

The pin can be dragged to refine the location; the geocode bar updates with the new address.

**Known limitations:**

- Reverse geocoding requires internet; offline drops show coordinates only.
- Some remote locations (oceans, mountains) have no usable address.

---

## Layer Switching

**What it does.** Switch between four base maps and toggle the hillshade overlay.

**Base maps:**

- **CyclOSM Trails** — emphasizes hiking and cycling routes (default)
- **OSM Streets** — general-purpose street map with labels
- **OpenTopo** — contour lines and topographic relief
- **Humanitarian (Parks & POIs)** — highlights amenities and features

**Overlay:**

- **Hillshade** (Esri World Hillshade) — multiplied with the base map for contrast on slopes; near-white pixels pass through, only shaded slopes darken.

**How to use:**

1. Tap the **Layers button** (top-right).
2. The popover opens with radio buttons (base maps) and checkboxes (overlays).
3. Tap a base map to switch immediately; toggle the hillshade checkbox to overlay relief.
4. Close the popover by tapping outside, the close button, or pressing Escape.

**Persistence.** Both selections are saved to `localStorage` and restored on next visit. The "Layers" text label collapses to icon-only after the first tap.

---

## Offline Tile Download

**What it does.** Pre-cache map tiles for a region and zoom range so they load instantly when offline.

**How to use:**

1. Tap the **Download button** (top-right).
2. A draggable selection rectangle with corner handles appears on the map.
3. Drag the corners to define the region.
4. Adjust the **min zoom** and **max zoom** sliders.
5. The tile count and estimated size update in real time.
6. Tap **Download**; a progress bar shows completion. Already-cached tiles are skipped.

The "Download" text label collapses to icon-only after the first tap.

**Mobile.** The panel anchors to the bottom of the screen so it doesn't block the selection handles. Tap the header to collapse / expand the panel while dragging.

**Limits:**

- Safari has a ~50 MB cache quota; a warning surfaces if your estimate exceeds it.
- Only OSM tiles are cached by both the service worker and the proactive download (CyclOSM, OpenTopo, and Humanitarian are not — see [ADR-005](adr/ADR-005-offline-tile-strategy.md)).
- Download requires internet; tiles land in the same Cache API store the service worker uses.

---

## Background-GPS Keepalive

**What it does.** Keeps GPS fixes flowing while navigation is active, even with the screen off.

**How it works.** When guidance enters the **guiding** state, the app:

1. Requests a screen wake lock (`navigator.wakeLock.request('screen')`) — keeps the display on where supported.
2. Starts a silent `AudioBufferSourceNode` looped at 1 Hz — iOS Safari treats audio playback as a foreground activity, so the JS event loop keeps running and the geolocation watch keeps dispatching fixes.

The audio is silent (zero-amplitude buffer); no sound plays. Both mechanisms are released cleanly when guidance stops.

**Why both?** Wake Lock isn't supported on iOS Safari; silent audio is. Wake Lock works on Chrome / Firefox; silent audio also keeps Chrome from throttling background timers as aggressively. Belt and suspenders.

---

## Consent Dialog

**What it does.** First-run modal that blocks app initialization until the user accepts the privacy policy and terms of use.

**Layout.** Three zones — sticky title, scrollable body (Privacy Policy first, then Terms of Use), sticky button row. The action buttons remain visible on small screens where the legal text needs scrolling.

**Storage on accept.** `webmap-consent-version`, `webmap-consent-accepted-at` (ISO timestamp), and `webmap-consent-install-id` (anonymous UUID generated once via `crypto.randomUUID()`) are written to `localStorage`.

**Re-acceptance.** `CONSENT_VERSION` is the gate. Bumping it forces every existing user to re-accept on the next visit. Current value is `2.2` (bumped when turn-by-turn guidance landed because routing introduced a new third-party egress — FOSSGIS Valhalla).

**Disclosed third-party services:**

- **OpenStreetMap** (and its derivative tile servers) — every map tile request
- **Esri ArcGIS** — every search query and pin-drop reverse geocode
- **FOSSGIS Valhalla** — only when the user explicitly taps "Navigate here"

---

## Changelog

**What it does.** Read the full release history without leaving the app.

**How to use:**

1. Tap the **version badge** (e.g., `v0.31.4-beta`) in the bottom-left thumb cluster.
2. A scrollable panel slides in listing every release with its changes.
3. Dismiss by tapping the badge again, the **✕** button, the panel backdrop, or pressing Escape.

The changelog content is bundled at build time from `CHANGELOG.md` — it reflects the version of the app you have installed.

---

## Offline Mode

**What works offline:**

- Cached map tiles (OSM, including the proactively-downloaded region)
- Pan and zoom the map
- The live blue dot, accuracy circle, and heading-cone wedge (GPS works without internet on most phones)
- All UI controls (locate, layers, compass, consent, changelog)
- Tile-error fallback: when a tile is missing, the app crops a parent-zoom tile from the cache onto a canvas — degraded but visible

**What requires internet:**

- Address search (ESRI; silently empty offline)
- Reverse geocoding (ESRI; the geocode bar shows coordinates only)
- Turn-by-turn navigation (FOSSGIS Valhalla; routing fails with a clear toast)
- Tile cache refresh (cached tiles still serve; expired entries fall through to error fallback)

**How to populate the cache:**

1. **Passive** — use the app normally with internet; tiles you've viewed are cached automatically.
2. **Proactive** — use the Download button to pre-cache a specific region and zoom range.

Cached tiles stay for 30 days; using them refreshes the timer (`StaleWhileRevalidate`).

**Offline banner.** The app watches `navigator.onLine` and shows a banner at the top when it goes false. The banner clears automatically when connectivity returns. The banner does not disable any UI — controls remain visible and offline-capable features keep working.

**Known limitations:**

- Offline depends on browser PWA / service worker support — works on all modern browsers and the installed PWA.
- Tiles cache per device; a fresh device must fetch tiles before they're available offline.
- Very old cached tiles can be stale if the map data has changed significantly since they were fetched.
