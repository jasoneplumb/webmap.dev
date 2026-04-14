# Changelog

## v0.14.3-beta (2026-04-14)

### Fixed

- **UX** — GPS weak-signal badge appears in stats bar when recording and accuracy exceeds 30m; hides automatically when signal improves (#91)
- **UX** — geocode-bar address element now has a `title` attribute so long addresses are accessible via tooltip without expanding the sheet (#90)


## v0.14.2-beta (2026-04-11)

### Fixed

- **UI** — top-left controls (zoom, locate, track, layers) resized to match the geocoder search button: 26px on desktop, 34px on touch devices


## v0.14.1-beta (2026-04-11)

### Fixed

- **UI** — recording stats bar no longer overlaps Pause/Resume buttons on Safari iPhone; bottom offset raised to `145px + safe-area-inset-bottom` to clear the button panel
- **UI** — stats bar layout changed to vertical stack: Duration (top) / Dist + Ascent row / Recording indicator (bottom) — narrower footprint on small screens
- **UI** — recording buttons are no longer full-width; `width: auto` with `min-width: 80px` and symmetrical horizontal padding gives a more compact, well-padded appearance


## v0.14.0-beta (2026-04-11)

### Changed

- **UI** — recording stats bar reordered: Duration | Dist | Ascent | ● RECORDING indicator moved to trailing position
- **UI** — "Time" label renamed to "Duration"
- **UI** — "Speed" stat replaced with "Ascent" — displays cumulative elevation gain in metres; shows "-- m" until altitude data is available

### Added

- **Recording** — cumulative ascent (total metres gained) tracked from GPS altitude deltas during trail recording; persisted and restored via trail backup (backup schema v2)


## v0.13.0-beta (2026-04-11)

### Added

- **Trail Recording** — start, pause, resume, and stop GPS trail recording; real-time polyline rendered on the map during recording
- **GPX Export** — stop recording to auto-download a GPX 1.1 file importable by Strava, AllTrails, and Garmin Connect
- **Offline Resilience** — trail recording continues without network; GPS points persist to localStorage so a page reload mid-hike restores the session with a prompt to resume
- **Offline Tile Warnings** — toast notification when offline tiles are unavailable at the current zoom level (debounced, max once per 10s); lower-resolution canvas fallback renders instead of blank tiles

### Fixed

- **GPS Accuracy** — fixes with accuracy > 30m are discarded before being added to the trail, eliminating noise from weak satellite lock
- **Bottom Sheet** — reverse geocode bar upgraded to a draggable bottom sheet with peek/full snap points, drag-to-dismiss, peek-state map pass-through, haptic feedback on Copy, and keyboard accessibility
- **Offline Data Safety** — `beforeunload` handler flushes the trail backup to localStorage if the tab closes mid-recording; restore prompt shown once per session


## v0.12.1-beta (2026-04-09)

### Fixed

- **UI** — all edge-pinned controls, buttons, and overlays now respect Safari iPhone safe areas (notch, home indicator, side bezels) via `env(safe-area-inset-*)` and `viewport-fit=cover`


## v0.12.0-beta (2026-04-09)

### Added

- **UI** — recording stats bar uses locale-appropriate units (miles/mph in US, km/h elsewhere)
- **UI** — Copy button turns green with "✓ Copied" confirmation for 1.5s after clipboard write
- **UI** — selecting a search result now shows the geocode bar with the address and coordinates for copying
- **UI** — recording control buttons are larger (48px min-height) with Stop separated from Pause/Resume to prevent accidental taps
- **UI** — recording stats bar has larger text and higher contrast

### Changed

- **Docs** — source file headers migrated to JSDoc style matching tiles- project convention (Intent/Context/Pattern/Future)


## v0.11.0-beta (2026-04-09)

### Added

- **UI** — version badge (upper right) is now a button that toggles a scrollable changelog panel; click again or press Escape to dismiss


## v0.10.0-beta (2026-04-09)

### Added

- **Search** — toast notification when geocoder returns no results, with suggestions to zoom out or reword the search

### Fixed

- **Search** — iOS keyboard "Done" / checkmark button now submits the search instead of cancelling it


## v0.9.4-beta (2026-04-09)

### Fixed

- **Location** — "Location access is denied" toast now persists until dismissed (×) and includes iOS settings path: Settings > Privacy & Security > Location Services > Safari Websites > Allow


## v0.9.3-beta (2026-04-09)

### Fixed

- **Controls** — double-clicking a toolbar button no longer drops a pin on the map
- **PWA** — app now auto-reloads after a service worker update without requiring a manual refresh
- **UI** — scale bar raised to match the Record button's bottom offset, no longer obscured by the Safari toolbar
- **Location** — iOS no longer falsely reports "Location access is denied" after permission has been granted


## v0.9.2-beta (2026-04-08)

### Fixed

- **UI** — replaced the reverse geocode bottom sheet with a compact single-line bar (Copy | address | ×) centred at the bottom of the viewport; coordinates omitted when geocoding succeeds, shown as fallback on failure

## v0.9.1-beta (2026-04-08)

### Fixed

- **Search** — selecting a result in the floating dropdown now clears the dropped pin marker and closes the reverse-geocode info panel

## v0.9.0-beta (2026-04-08)

### Added

- **UI** — toggle controls (locate, track) now match Leaflet zoom button width: 36 px on desktop, 44 px on mobile

### Removed

- **UI** — removed "copy dropped pin to clipboard" toggle button and feature

### Fixed

- **UI** — standardized overlay shadows across map controls, panels, dropdown, and version badge for visual consistency

## v0.8.6-beta (2026-04-08)

### Fixed

- **Search** — reverted sticky-header dropdown layout; scrollbar restored to original behaviour
- **Search** — clicking the search icon now immediately dismisses the previous dropdown and clears result pins so each search starts clean

## v0.8.5-beta (2026-04-08)

### Fixed

- **Search** — dropdown header (search string + × button) is now sticky and always visible regardless of scroll position; only the results list scrolls
- **Search** — pressing Enter to start a new search immediately dismisses the previous dropdown and removes old result pins from the map

## v0.8.4-beta (2026-04-08)

### Fixed

- **Search** — dropping a reverse-geocode pin now clears the search result selection (all numbered markers reset to blue)

## v0.8.3-beta (2026-04-08)

### Fixed

- **Search** — dropdown now dismisses only via the × close button in its header, eliminating all spurious auto-dismiss behaviour when clicking results or markers

## v0.8.2-beta (2026-04-08)

### Fixed

- **Search** — clicking a result in the dropdown no longer spuriously dismisses it (stopPropagation prevents the outside-click handler from treating result clicks as outside-clicks)
- **Search** — result items now show a native tooltip (name · location · type · coordinates) on hover

## v0.8.1-beta (2026-04-08)

### Fixed

- **Search** — clicking a map marker now restores the floating dropdown if dismissed, clears any dropped reverse-geocode pin, and updates the page title to the selected result

## v0.8.0-beta (2026-04-08)

### Changed

- **Search** — results now appear in a floating dropdown anchored below the search bar, overlaying the map where the user typed; the bottom sheet / side panel is retained only for reverse-geocode (drop-pin) results

## v0.7.2-beta (2026-04-08)

### Fixed

- **Search** — result list now always visible after search; sheet upgrades from peek to half instead of staying collapsed

## v0.7.1-beta (2026-04-08)

### Fixed

- **Search** — zoom-responsive markers: full circle at zoom ≥ 12, compact at 7–11, dot-only below 7
- **Search** — `flyToBounds` mobile padding was incorrectly adding 300px to top/left; now bottom-only
- **Search** — single-result zoom uses ESRI extent so country/city results fit the right geographic scale
- **Search** — result subtitle no longer hard-truncated on narrow screens

## v0.7.0-beta (2026-04-08)

### Added

- **Search** — fit map to all result bounds on search so all pins are visible (#69)
- **Search** — numbered markers (1, 2, 3…) linking map pins to the result list (#71)
- **Search** — richer result detail: address subtitle and type badge per result (#72)
- **Search** — smart zoom using result bounds or Addr_type heuristics on click (#70)
- **Search** — bidirectional selection between result list and map markers (#73)
- **Map** — red dropped-pin marker renders above blue search result pins

## v0.6.2-beta (2026-04-08)

### Fixed

- **Search** — constrain search results to visible map area when zoomed in (zoom >= 7)

## v0.6.1-beta (2026-04-07)

### Fixed

- **Location** — replace GPS polling loop with `watchPosition` to eliminate user-gesture console violations (#60)
- **UI** — replace locate crosshair icon with angled navigation arrow — the standard location symbol (#62)

## v0.6.0-beta (2026-04-01)

### Added

- **UI** — fix bottom sheet drift, scroll jank, tile blur, and icon allocation (#54)

### Fixed

- **Recording** — GPX export data correctness: locale-safe track name, multi-segment support across pause/resume, timing drift fix, deferred revokeObjectURL (#57)
- **PWA** — guard against auto-update during active recording; add PNG icons; remove ToS tile caching (#49)
- **Recording** — reduce revokeObjectURL timeout from 1000ms to 0ms (#58)

## v0.5.1-beta (2026-04-01)

### Fixed

- **GPS** — resolved polling refcount leaks and state machine edge cases (#51)
- **Search** — replaced private API access with public APIs; added missing-key guard (#52)
- **Search** — spinner resolves on suggest errors; Enter no longer collapses before results (#42)
- **Mobile** — disabled button bypass fixed; iOS long-press fallback added; location markers removed when locate turns off (#53)

### Documentation

- Added README, architecture, features, development, and deployment docs (#55)

### Other

- Added MIT license
- Added Claude Code review CI workflow

## v0.5.0-beta (2026-03-31)

### Features

- **GPX export** — track is automatically downloaded as a GPX 1.1 file when recording is stopped; filename includes start date/time (#41)

### Fixes

- **Search** — spinner now resolves on results/error; pressing Enter submits the query instead of collapsing the control (#40)
- **iOS locate** — removed racy `permissions.query` check that caused the first Locate tap to fail with a false "access denied" (#38)
- **Map layers** — restored missing dropped-pin marker icon; default layer changed to Streets; layer labels renamed to Structures and Topo (#37)

## v0.4.0-beta (2026-03-31)

### Features

- **UI controls** — relocated controls from bottom-right to top-left for better thumb reach on mobile
- **Version badge** — version overlay displayed in upper-right corner of the map (#20)

### Fixes

- **iOS user gestures** — GPS and clipboard operations now execute within the user gesture to avoid Safari's permission expiry (#25, #26)
- **iOS GPS permission** — location request now occurs directly inside user gesture handler (#23)
- **Record button** — disabled when location is not enabled to prevent invalid state (#24)
- **Clipboard copy** — reverse geocode clipboard copy no longer fails due to expired user gesture

## v0.3.0-beta (2026-03-18)

### Features

- **Location button** — three-state locate button (off / following / passive) with blue pulsing dot, accuracy circle, and graceful GPS signal loss handling (#12)
- **Enhanced search** — throttled autocomplete (3 chars, 250ms debounce), viewport-biased results, draggable reverse-geocode pin, flyTo animation, right-click/long-press support (#11)
- **Track recording** — start/pause/resume/stop state machine with confirmation, real-time stats overlay (time, distance, speed), styled trail with glow and direction arrows (#13)
- **Mobile bottom sheet** — three-snap-point bottom sheet (peek/half/full) on mobile, side panel on desktop, for search results and reverse geocode info (#14)
- **Map interaction polish** — fractional zoom (`zoomSnap: 0`), smooth scroll-zoom, `flyTo` animations for all programmatic transitions, mobile-optimized control layout (#16)
- **Service Worker** — `vite-plugin-pwa` with Workbox; app shell cached (CacheFirst), map tiles cached (StaleWhileRevalidate, 500 entries/30 days), geocoding API NetworkOnly, offline banner (#15)
- **Canvas renderer** — `preferCanvas: true`, `keepBuffer: 3`, `updateWhenZooming: false` on tile layers, `idle.ts` utility for debounced map events (#10)
- **Vite + TypeScript** — modernized build toolchain with Vite 5, strict TypeScript, ESLint 9, and CI/CD pipeline

### Fixes

- **Search bar** — silent API key failure now warns in console; `useMapBounds` disabled at low zoom levels to prevent empty results (#18)
- **CI** — corrected branch trigger (`main` → `mainline`), deploy SSH key secret name, and enforced LF line endings for shell scripts
