# Changelog

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
