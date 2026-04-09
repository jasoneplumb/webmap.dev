# Features

## Live GPS Tracking

**What it does:** Shows your real-time location on the map as a blue pulsing dot with an accuracy circle.

**How to use:**
1. Tap the **Locate button** (crosshairs icon) in the top-left toolbar.
2. Your location appears as a blue dot; the gray circle around it shows the GPS accuracy (wider circle = less accurate).
3. The map automatically centers on your position and keeps following you as you move.

**Three-state button:**
- **Off** (lines icon) — Location disabled; no blue dot
- **Active** (blue icon) — Following your location; map pans as you move
- **Passive** (gray icon) — Blue dot visible but map stopped following (appears when you pan away); tap the button again to re-center

**Accuracy circle:**
- Larger circle = GPS is less accurate (typical: 10–50 meters)
- Smaller circle = GPS is very accurate (typical: 5–10 meters indoors/tunnels)
- Circle opacity fades as accuracy improves (more opaque = less precise)

**Known limitations:**
- GPS requires clear sky view; accuracy degrades indoors or in dense urban canyons
- Accuracy circle is estimated; actual error may be different
- Passive mode appears after panning; locate state shows in the title bar if available

---

## Trail Recording

**What it does:** Records your journey as a colored line on the map with real-time stats (elapsed time, distance, current speed).

**How to use:**
1. Enable the Locate button first (required for recording).
2. Tap the **Record button** (⏺ icon) in the bottom-right.
3. A blue trail line appears as you move; stats bar shows in real-time at the top.
4. To pause: tap the **Pause button** (⏸); the stats bar shows "PAUSED".
5. To resume: tap the **Resume button** (▶).
6. To stop: tap the **Stop button** (⏹); a confirmation dialog appears.

**Stats displayed during recording:**
- **Time**: Elapsed time (MM:SS or H:MM:SS); paused time is not counted
- **Distance**: Total trail distance in meters or kilometers
- **Speed**: Current speed from GPS (km/h); shows "-- km/h" if stopped

**Trail visualization:**
- **Main line**: Solid blue polyline showing your path
- **Glow effect**: Subtle semi-transparent blue layer beneath the main line (visual depth)
- **Direction arrows**: Small markers placed every ~50 meters showing your travel direction

**Trail filtering:**
- Points closer than 5 meters apart are skipped (GPS jitter reduction)
- Only accepted GPS fixes are recorded (haversine filter; see architecture.md)
- Very slow or stationary movement is still recorded

**Known limitations:**
- Pause/resume works, but total distance doesn't decrease (only forward distance counts)
- Speed is from GPS; may lag 1–2 seconds behind actual movement
- Very long trails (thousands of points) may impact map performance

---

## GPX Export

**What it does:** Saves your recorded trail in GPX format, a standard file format compatible with all mapping software (Strava, AllTrails, Google Maps, Garmin, etc.).

**How to use:**
1. Record a trail (see Trail Recording above).
2. When you tap Stop, the app automatically generates and downloads a `.gpx` file.
3. The file is named with the start date/time (e.g., `2026-03-31 14:30:45.gpx`).
4. Open the file in any mapping app to view, share, or upload.

**What's included in the GPX file:**
- **Track name**: ISO timestamp of when recording started
- **Track segment**: Full list of waypoints
- **Each waypoint**:
  - Latitude and longitude (7 decimal places = ~1 cm precision)
  - Timestamp (ISO 8601 format)
  - Speed (m/s) from GPS (if available)

**Example GPX:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="webmap.dev" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>2026-03-31 14:30:45</name>
    <trkseg>
      <trkpt lat="37.1234567" lon="-122.1234567">
        <time>2026-03-31T14:30:46.000Z</time>
        <extensions><speed>2.5432</speed></extensions>
      </trkpt>
      <!-- more points -->
    </trkseg>
  </trk>
</gpx>
```

**Known limitations:**
- GPX is only generated when the trail has at least one recorded point
- Paused sections are not marked in the GPX file; the track is continuous
- Some mapping apps require manual import; some auto-detect `.gpx` files

---

## Address Search & Autocomplete

**What it does:** Find places, streets, and addresses by typing; results appear in a list in the bottom sheet (mobile) or side panel (desktop).

**How to use:**
1. Tap the **Search box** at the top of the map (if you see one).
2. Type at least 3 characters (e.g., "Golden Gate", "market street").
3. The app shows suggestions as you type (autocomplete).
4. Tap a result to select it; the map zooms to that location.
5. The location details are displayed in the info panel.

**Supported search types:**
- **Places**: "Eiffel Tower", "Apple Park", "Golden Gate Bridge"
- **Addresses**: "123 Main St, San Francisco"
- **Intersections**: "Mission St and Market St"
- **Landmarks**: "Tower of London", "Central Park"

**Search behavior:**
- Minimum 3 characters required before searches start
- Results are biased toward the current map center (not your GPS location)
- Up to 15 results are shown
- Autocomplete narrows results as you type

**Known limitations:**
- Search requires internet; offline mode cannot search
- Results come from ESRI ArcGIS service; coverage is worldwide but may miss very small/local places
- Spelling matters; "Sn Frsiscco" won't find "San Francisco"
- Non-Latin characters may have inconsistent results

---

## Reverse Geocoding (Pin Drop)

**What it does:** Drop a pin on the map and look up the address at that location.

**How to use:**

**On Desktop:**
1. Right-click (context menu) on any location on the map.
2. The info panel opens showing the address and coordinates.

**On Mobile:**
1. Long-press (2–3 seconds) on any location on the map.
2. The info panel slides up showing the address and coordinates.

**What appears in the info panel:**
- **Address**: Human-readable address (street, city, region, postal code)
- **Coordinates**: Latitude and longitude (6 decimal places)

**Clipboard copy:**
There's a **Clipboard toggle button** (copy icon) in the top-left toolbar that you can enable to automatically copy dropped-pin coordinates to your clipboard when you drop a pin.

**Known limitations:**
- Reverse geocoding requires internet; offline mode cannot look up addresses
- Results are approximate; nearby pins may return the same address
- Some locations (oceans, mountains, remote areas) may not have usable addresses

---

## Changelog

**What it does:** Shows the full release history inline without leaving the app.

**How to use:**
1. Tap the **version badge** (e.g., `v0.11.0-beta`) in the upper-right corner of the map.
2. A scrollable panel slides in listing all past releases with their changes.
3. Dismiss by tapping the badge again, pressing the **✕** button, or pressing **Escape**.

**Known limitations:**
- Changelog content is bundled at build time; it reflects the version of the app you have installed.

---

## Offline Mode

**What it does:** Caches map tiles and app code so you can use the app without internet (limited functionality).

**What works offline:**
- ✅ View cached map tiles (Mapbox, OpenStreetMap, Google Imagery)
- ✅ Pan and zoom the map
- ✅ Record your trail (GPS works without internet on most phones)
- ✅ View the live blue dot and accuracy circle
- ✅ All UI interactions (buttons, controls, bottom sheet)

**What requires internet:**
- ❌ Address search (queries ESRI API)
- ❌ Reverse geocoding (queries ESRI API)
- ❌ Tile caching (cached tiles expire after 30 days of no use)

**How to populate the offline cache:**
1. Use the app normally with internet enabled.
2. As you view different parts of the map, tiles are cached automatically.
3. Each tile layer (Mapbox, OSM, Google) caches up to 500 tiles.
4. Cached tiles stay for 30 days; using them refreshes the timer.

**Enabling offline mode:**
- The app detects when internet is lost and shows an "Offline" banner at the top.
- No action needed; the app continues to work with cached data.
- Search and geocoding buttons remain visible but won't function.

**Offline banner:**
- Appears when the browser detects `navigator.onLine === false`
- Disappears when internet returns
- Does not disable the map or trail recording

**Known limitations:**
- Offline functionality depends on your browser's PWA/service worker support (works on all modern browsers and mobile apps)
- Tiles are cached per device; offline use on a new device requires fetching tiles first
- Very old cached tiles may be inaccurate if the map changed significantly
