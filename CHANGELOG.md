# Changelog

## v0.22.2-beta (2026-04-18)

### Fixed

- **Locate label persists collapsed** — after tapping the Locate button once (collapsing the text label), the collapsed state is now stored in `localStorage` (`webmap-ctrl-label-locate`) and restored on reload; previously the label reappeared on every page load (#127)
- **Basemap screenshots aligned** — all four basemap preview images now use identical tile coordinates (z=13, eastern SF) so they show the same geographic region; streets image switched to `tile.openstreetmap.de` to avoid OSM policy blocks on scripted tile fetches

## v0.22.1-beta (2026-04-18)

### Added

- **Basemap previews** — docs/images now includes screenshots for all four basemaps (Trails, Streets, Topographic, Parks & POIs); README Preview section shows them side by side

### Fixed

- **Double-tap to re-center** — double-tapping the map on mobile re-activates locate from passive state without triggering zoom-in; uses capture-phase `touchend` with `passive:false` so `preventDefault()` suppresses the synthesized `dblclick`; guards simultaneous multi-finger lifts via `changedTouches.length === 1` (#123)

## v0.22.0-beta (2026-04-18)

### Added

- **Background GPS keepalive** — new `Keepalive` class (`src/keepalive.ts`) wraps Screen Wake Lock API and a silent `AudioContext` loop to keep GPS active when the phone locks or the browser is backgrounded during recording; wake lock re-acquired automatically on screen wakeup; both mechanisms degrade gracefully if unavailable (#119)

### Fixed

- **Blank page on iOS Safari after app update** — service worker `onNeedRefresh` reload now deferred via `requestAnimationFrame` so the map renders before any SW-triggered navigation fires; also adds a guarded `.catch()` on the consent promise chain to reload on failure without looping (#121)

## v0.21.0-beta (2026-04-17)

### Added

- **Test coverage** — 3 new test files: haversine distance formula (`location.test.ts`), bottom-sheet snap-point math (`bottom-sheet.test.ts`), recording state machine transitions (`recording.test.ts`); 23 new tests bringing total to 103
- **Bundle size tracking** — `size-limit` checks gzipped JS bundle stays under 100KB; added to CI pipeline and README badge (93KB gzip)

### Changed

- **Haversine distance** — extracted as exported `haversineDistance()` function from inline code in `location.ts` for testability
- **Snap-point math** — extracted as exported `computeSnapPx()` function and constants from `bottom-sheet.ts` for testability

## v0.20.9-beta (2026-04-17)

### Added

- **README badges** — CI status, license, and TypeScript badges at the top of README
- **Repo topics** — 10 topics (pwa, typescript, leaflet, gps, etc.) for GitHub discoverability
- **PR and issue templates** — bug report, feature request, and PR templates in `.github/`
- **README screenshots section** — Preview placeholder with `docs/images/` directory
- **Design principles** — offline-first, local-only data, progressive enhancement, mobile-native UX, minimal dependencies, transparent architecture
- **Architecture Decision Records** — 5 ADRs documenting single state, refcount polling, iOS Safari viewport, local-only data, and offline tile strategy
- **SECURITY.md** — threat model, data architecture, vulnerability reporting via GitHub private advisories
- **CONTRIBUTING.md** — development workflow, code conventions, quality gate, file structure
- **CODE_OF_CONDUCT.md** — simplified Contributor Covenant

### Changed

- **Repo description** — updated to "Privacy-first PWA for GPS trail recording, offline maps, and address search"
- **Documentation** — updated README, architecture, features, and development guides with all new source files and features

## v0.20.8-beta (2026-04-17)

### Changed

- **Consent dialog** — condensed title and summary into a one-liner; reordered Privacy Policy above Terms of Use; removed preamble text; title and buttons now stay pinned while legal text scrolls independently

## v0.20.7-beta (2026-04-17)

### Fixed

- **Locate icon consistency** — active and passive states now use the same outline shape as the off state, differing only in stroke color (blue for active, gray for passive)
- **Download panel on mobile** — repositioned to bottom of screen and made collapsible so it no longer blocks the map and selection handles

### Changed

- **Control labels** — Locate, Layers, and Download buttons collapse to icon-only after first use, reclaiming screen space on mobile

## v0.20.6-beta (2026-04-17)

### Fixed

- **Bottom sheet on older iOS Safari** — info-panel no longer bleeds ~80px into view on load; `vh` units and `window.innerHeight` disagree on older iOS Safari, so snap-point math now uses the actual rendered element height (`offsetHeight`) instead of computing from `innerHeight`

## v0.20.5-beta (2026-04-17)

### Changed

- **Stop recording dialog** — replaced browser's native `confirm()` with a styled custom modal; removes the browser's "Prevent this page from creating additional dialogs" checkbox

## v0.20.4-beta (2026-04-17)

### Fixed

- **Hillshade after base map switch** — overlays now re-stack above the new base map when switching layers; previously the opaque base map was added on top of the tile pane, burying the hillshade overlay

## v0.20.3-beta (2026-04-17)

### Fixed

- **Layers popover** — popover no longer goes off-screen when flipped above the button; clamps to viewport bounds and caps height so content remains scrollable

## v0.20.2-beta (2026-04-17)

### Fixed

- **Hillshade overlay** — default hillshade now renders on initial load; a ghost OSM tile layer added in `createMap()` was sitting permanently in the tile pane, blocking the overlay; also fixes offline tile fallback which referenced the wrong layer variable

## v0.20.1-beta (2026-04-17)

### Fixed

- **Zoom limits** — map no longer goes blank at high zoom; added map-level maxZoom (18), corrected OpenTopoMap maxNativeZoom from 18 to 17, and set layer maxZoom to 20 so Leaflet upscales tiles gracefully

## v0.20.0-beta (2026-04-17)

### Added

- **Default layers** — Trails (CyclOSM) is now the default base map and Hillshade overlay is enabled by default for new users; returning users keep their persisted selection

### Changed

- **Locate icon** — redesigned to match the Apple iOS location services arrow: elongated diagonal pointer with iOS blue (#007AFF) when active, gray when passive, outline-only when off

## v0.19.4-beta (2026-04-17)

### Fixed

- **Layers popover font** — popover now uses `system-ui, sans-serif` consistently with button text; previously inherited the body default since the popover is appended to `document.body`
- **Offline badges removed** — the green "Offline" badge appeared on every layer, adding visual noise without conveying useful information; the `offline` property has been removed from layer definitions

## v0.19.3-beta (2026-04-17)

### Fixed

- **Hillshade overlay** — replaced broken OpenTopoMap hillshade endpoint (403 Forbidden) with Esri World Hillshade service

## v0.19.2-beta (2026-04-17)

### Changed

- **Consent modal** — reworded to cover general app usage, not just GPS recording; includes a description of webmap.dev and inlines shorter Terms of Use and Privacy Policy without expandable sections; bumps consent version to 2.0 so existing users re-accept
- **Recording button** — removed redundant consent check since consent is now required at app load time

## v0.19.1-beta (2026-04-17)

### Fixed

- **Consent gate** — consent modal now blocks all app usage at load time until terms are accepted; previously it only appeared when starting a recording, allowing unrestricted map usage without consent

## v0.19.0-beta (2026-04-16)

### Added

- **Consent modal** — first-run consent dialog shown before GPS recording begins; displays inline Terms of Use and Privacy Policy with expandable sections; stores consent version, timestamp, and anonymous install ID in localStorage (#103)

## v0.18.1-beta (2026-04-16)

### Fixed

- **Layers control** — fixed runtime error when layer control tried to add tile layers to the map; tile layers are now properly exported and retrieved via getTileLayers() function


## v0.18.0-beta (2026-04-16)

### Added

- **Layers** — custom popover UI control replacing Leaflet's native layer switcher; allows switching between base maps (Streets, Trails, Topographic, Parks) and toggling overlays (Hillshade)
- **Free tile sources** — replaced Mapbox and Google imagery with community-maintained alternatives: CyclOSM (trails-focused), OpenTopoMap (topographic), Humanitarian OSM (parks & POIs); all sources are free and offline-cacheable

### Changed

- **Layers control** — new button with gear icon (⚙) in top-left, matching Locate and Download control styling; opens popover on click with layer selection UI
- **Service Worker caching** — updated to cache all free OSM tile sources (CyclOSM, OpenTopoMap, Humanitarian OSM) alongside existing OSM Standard tiles; removed Mapbox and Google caching

### Removed

- **Mapbox Topo layer** — replaced with free OpenTopoMap (same topographic + hillshade features, zero cost, offline-capable)
- **Google Imagery layer** — removed to eliminate vendor lock-in and unapproved costs

### Benefits

- **Zero cost** — unregulated public traffic no longer risks surprise billing
- **Offline resilience** — all layers available for pre-download via offline-download panel; no vendor outages can break the app
- **Improved UX** — visual layer switcher with descriptions; matches existing control aesthetic


## v0.17.1-beta (2026-04-16)

### Fixed

- **UI** — tooltips on Locate and Download buttons now appear when hovering anywhere on the button (was only showing on icon, not label area)


## v0.17.0-beta (2026-04-16)

### Added

- **UI** — explanatory tooltips on Locate and Download buttons to improve discoverability; Locate tooltip guides users through state transitions (off → following → passive)

### Changed

- **UI** — Locate button tooltips now explain the button's function rather than just showing state


## v0.16.0-beta (2026-04-16)

### Added

- **UI** — locate, tracking, and download buttons now display with text labels for clarity; offline download control repositioned above search control for better logical flow

### Changed

- **UI** — button width adjusted to accommodate text labels with uniform padding and icon-label spacing


## v0.15.0-beta (2026-04-14)

### Added

- **GPS** — adaptive polling interval reduces battery drain during trail recording; GPS poll frequency lowers when stationary and increases on movement (#99)
- **Search** — expandable result items on mobile: first tap shows full address, type badge, coordinates, and action buttons; second tap flies to location (#98)
- **UX** — mouse drag support for reverse geocode bottom sheet handle on desktop (#96)
- **Offline** — region pre-download UI: select bounding box and zoom range to pre-cache tiles for offline use, with progress bar and Safari quota warnings (#97)

### Fixed

- **UX** — GPS weak-signal badge now uses hysteresis (show after 2+ consecutive weak fixes, hide below 25m) to prevent flicker in marginal signal (#95)
- **UX** — long addresses in geocode bar peek state are tap-to-expand on mobile: tap reveals full text for 3s, then collapses (#94)


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
