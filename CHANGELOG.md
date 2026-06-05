# Changelog

## v0.34.3-beta (2026-06-04)

### Fixed

- **Blank page on cold start in Edge on iPhone** — navigation requests are now served NetworkFirst instead of cache-first from the service-worker precache. Third-party iOS browsers (WKWebView) have flakier Cache Storage than Safari, so the cache-first navigation route intermittently returned a blank document; an online cold start now always fetches a fresh `index.html` from the network, with the last cached navigation as the offline fallback (#213)
- **Stale service worker pinned for a year** — nginx now serves `/sw.js` with `no-cache` instead of the generic 1-year `immutable` rule that applied to every `.js` file. Because the service-worker filename is stable (unhashed), that rule kept browsers on a stale SW that never discovered new deploys; it is now re-fetched and revalidated on every load (#210)

## v0.34.2-beta (2026-06-04)

### Changed

- **Diagnostic refinement** — the temporary blank-page probe now detects "blank" by counting actually-rendered map tiles (Leaflet adds panes/controls to `#map` immediately, so the previous child-count check missed a blank-but-initialized map) and always appends its state dump alongside any captured error (#208)

## v0.34.1-beta (2026-06-04)

### Changed

- **Temporary on-screen diagnostic** for a blank-on-load that only reproduces on mobile Chromium (Edge/Chrome) on the returning-user path. On an uncaught error or a map that never renders, it now shows an error/state readout instead of a blank page; invisible on normal loads. Instrumentation to be removed once the root cause is fixed (#207)

## v0.34.0-beta (2026-06-04)

### Added

- **Separate Hiking and Cycling route overlays** — the combined "Routes" overlay is now two independent toggles, **Hiking routes** and **Cycling routes** (both on by default). Because Waymarked colors routes by network hierarchy rather than by activity, turning Cycling off is the way to reveal hiking-only segments (#202)

### Fixed

- **Blank page on first load could require a manual reload** — added an inline boot-watchdog that reloads the page once (within ~3s) if the JS bundle never executes (e.g. a stale service worker serving a 404'd chunk), so the app recovers automatically instead of waiting for a manual refresh. Complements the `navigateFallback` app-shell fix in v0.33.2-beta (#206)

## v0.33.2-beta (2026-06-04)

### Fixed

- **Blank page on first load after an update** — a returning user (with the previous service worker cached) could get a blank white page until a manual reload, because the service worker had no navigation fallback and a navigation could be answered with a stale app-shell/chunk-hash mismatch. The SW now serves the app shell via `navigateFallback` and cleans up outdated precaches on activation, and the app self-heals with a one-shot reload if initialization fails — so it no longer requires a manual refresh (#204)

## v0.33.1-beta (2026-06-04)

### Fixed

- **Blank tray flashed over the map on the first load after an update** — an orphaned bottom-sheet ("info panel"), unused since search moved to the floating dropdown, computed its off-screen position from `offsetHeight` before layout was ready on the service-worker update's cold first paint, leaving an empty tray covering the map until a manual refresh. Removed the dead module, its call, test, and styles entirely (#200)

## v0.33.0-beta (2026-06-04)

### Added

- **Dedicated hiking & cycling trail base maps** — new **Cycle** (OpenCycleMap, now the default base) and **Outdoors** maps from Thunderforest, replacing the unreliable CyclOSM source that frequently left the trail map blank at city zoom levels. A new toggleable **Routes** overlay (Waymarked hiking + cycling routes) highlights marked routes over any base map, alongside the existing Hillshade overlay (#195)

### Changed

- **Unified search-to-navigation flow** — tapping a search result (or its numbered map marker) now flies to it and opens the same bottom sheet used for dropped pins, with Drive/Bike/Walk options and a prominent Start button, instead of a cramped accordion with four buried buttons (#195)
- **Map recenters at neighborhood zoom on locate** — the first GPS fix and every locate activation now frame your position at a readable neighborhood zoom rather than leaving the map zoomed out (#195)
- **Quieter, clearer GPS status messages** — the location-status toast now shows at most once per loss/acquisition episode (auto-clearing when a fix returns), with platform-specific guidance and a grace period for transient macOS location errors (#195)

### Fixed

- **Search result text no longer clips** — long place names and the "POI" badge were cut off (e.g. showing "PO"); results now truncate cleanly and the dropdown stays within the screen on narrow phones (#195)
- **Trail base map renders reliably** — the previous CyclOSM tile server timed out at city zoom levels, leaving only the hillshade visible; the new Thunderforest bases render at every zoom (#195)
- **PWA manifest syntax error** — a duplicate manifest link caused a "Manifest: Line 1, column 1, Syntax error"; the link is now injected once by the build (#195)

### Removed

- **Accordion search-result detail UI** — replaced by the unified bottom sheet (~150 lines removed); also removed the redundant standalone Topographic base map (its terrain view is covered by Outdoors) and the unused Mapbox token wiring (#195)

## v0.32.3-beta (2026-06-02)

### Fixed

- **Page didn't load until the user manually reloaded** — the service-worker update reload gated `updateSW(true)` behind a single `requestAnimationFrame`, which fires *before* that frame's paint, so the page reloaded before Leaflet had painted (a blank page on iOS Safari that only a manual reload recovered). `requestAnimationFrame` is also paused while the document is hidden, so an update that landed while the tab/PWA was backgrounded never applied and the page stayed on the stale worker. The update reload is now visibility-aware (defers until the document is visible) and genuinely post-paint (waits two animation frames), applied at most once (#192)

## v0.32.2-beta (2026-05-23)

### Fixed

- **Browser tab title hijacked by search and pin-drop** — `document.title` was overwritten on every search-result selection, marker click, and reverse-geocode lookup, leaving the tab labeled with stale addresses or coordinates long after the user moved on. The title now stays as `webmap.dev` until turn-by-turn navigation actually starts, switches to the destination label while guiding, and reverts to `webmap.dev` when navigation stops

## v0.32.1-beta (2026-05-20)

### Fixed

- **Routing failures were hidden behind the navigation tray** — routing errors (e.g. the Valhalla service being unreachable) were shown in a toast (`z-index 1000`) that the geocode-bar tray (`z-index 1500`) covered, so the message went unseen exactly when navigating from the tray. Routing failures now appear in a modal dialog above all app chrome, with distinct titles for an initial route failure vs. a route-type change failure (#188)

### Changed

- **Production deploys now run only on releases** — the deploy workflow triggered on every push to `mainline`, shipping unreleased work and running independently of CI. It now runs only on a version-tag (`v*`) push or manual `/deploy`, and only after the full CI quality gate passes against the release tag (#187)

## v0.32.0-beta (2026-05-20)

### Added

- **Locale-aware distance units** — turn-by-turn maneuver distances and route summaries now display in miles/feet or kilometres/metres based on the browser locale (imperial for US/GB/MM/LR regions, metric elsewhere). Valhalla is queried with matching units so its instruction text agrees with the pill display (#184)

### Changed

- Moved the navigation dashboard into the tray and trimmed the tray navigation bundle

### Fixed

- **Opaque CORS error when routing was unreachable** — `fetch()` rejects with a raw `TypeError` on any network-level failure (DNS, connection refused, TLS, blocked CORS preflight), which the browser surfaces as an opaque "CORS request did not succeed / Status (null)" console error and a cryptic toast. `fetchRoute()` now converts these into an actionable "routing service unavailable" message while letting `AbortError` propagate unchanged; also fixed a double-prefixed HTTP-error message (#182)
- Fixed routed guidance controls

## v0.31.4-beta (2026-04-26)

### Fixed

- **Guidance Stop button silently dropped taps on mobile** — `updateGuidance()` runs on every accepted GPS fix (~1 Hz on a moving phone) and ends with `render()`, which does `panelEl.innerHTML = ''` and re-creates the Stop button. iOS Safari's touch-to-click synthesis tracks the specific DOM element that received `touchstart`; if it's destroyed before `touchend`, the click never fires. With GPS fixes coming faster than typical tap-and-release timing, the user perceived "Stop doesn't respond like it's not a button". Switched to event delegation: a single persistent `click` listener on `panelEl` checks `closest('.guidance-btn')` and dispatches to `onStop`. The listener survives every render so the button can come and go without breaking the touch path. Added `type="button"` defensively (#179, #180)

## v0.31.3-beta (2026-04-26)

### Fixed

- **Geocode-bar Navigate button silently swallowed taps in peek state** — `.geocode-bar__nav` was missing from the peek-state `pointer-events: auto` opt-in list (`.geocode-bar--peek` is `pointer-events: none` and only specific children opt back in). Mobile Safari has long-standing quirks where `pointer-events: none` propagates to children that don't explicitly override — exactly what was already happening for handle / copy / close / addr. Adding Navigate to the list makes long-press → Navigate fire reliably. This also unblocks the Stop fix from #176: when Navigate doesn't fire, `hideGeocodeBar()` doesn't run, and the bar's drag handle keeps eating taps intended for the guidance pill's Stop button (#177, #178)
- **Search dropdown stayed open after "Navigate here"** — the `.sheet-result__nav-btn` handler started guidance without closing the dropdown. The dropdown sits at `z-index: 2000` (above the guidance pill) and on smaller viewports could overlap the pill area. Added `hideDropdown()` before `startGuidance()` (#177, #178)

## v0.31.2-beta (2026-04-26)

### Fixed

- **Guidance Stop button silently swallowed taps when navigation started from the geocode-bar** — the geocode-bar (`position: fixed; bottom: 0; height: 60vh; z-index: 1500`) in peek state covers the bottom ~130 px of the viewport above all Leaflet controls. Its drag handle has `pointer-events: auto` and spans the bar's full width, sitting at the top of the visible peek area — exactly the y-coordinate of the guidance pill's Stop button at the bottom of the bottom-left control cluster. Every tap intended for Stop hit the handle instead. Hide the bar from its own Navigate click handler before `startGuidance()` runs — the bar is redundant once the pill shows the destination, and the overlap goes away (#175, #176)

## v0.31.1-beta (2026-04-26)

### Fixed

- **Hillshade rendered fully opaque, hiding the base map** — v0.31.0's per-tile-image `mix-blend-mode` placement put the blend INSIDE the transformed `.leaflet-tile-container`'s stacking context, where it had nothing to multiply against and rendered the source pixels opaque. Reverted to the layer-level `.hillshade-blend` selector and added `isolation: isolate` on `#map` so the multiply blend has the base layer as a stable backdrop. Addresses both the v0.31.0 regression and the original "sometimes not applied at max zoom" symptom from #168 (#171, #172)
- **Navigate button silently failed for search results and drag-moved pins** — the geocode-bar's "Navigate" button tracked its destination via a `pinLayer` `layeradd` listener, which only fires on layer *addition*. That missed two flows: search → "Go to location" (which clears the pin layer without re-adding) and pin-drag (which moves the same marker without re-adding), causing Navigate to either silently no-op or, worse, route to a stale prior pin. Threaded `latlng` through `showGeocodeBar` so the single setter all three flows already share captures the destination reliably. Added a "No destination set" toast so any future regression surfaces visibly (#173, #174)

## v0.31.0-beta (2026-04-26)

### Added

- **Device-orientation compass widget** — top-right SVG compass rose that shows where the device is physically facing relative to the (always-north-up) map. Tap to enable on iOS (handles the iOS-13+ `DeviceOrientationEvent.requestPermission()` user-gesture flow); non-iOS browsers grant immediately. Most useful at low speed / stationary at a junction, where the GPS-course heading-cone fades. Hidden entirely on platforms without orientation sensors. Prefers iOS `webkitCompassHeading` (true-north calibrated); falls back to W3C `alpha` flipped to clockwise. Driven by `--heading-deg` CSS custom property with a 0.12 s transition for jitter smoothing (#163, #170)

### Fixed

- **Hillshade multiply blend dropouts at max zoom** — `mix-blend-mode: multiply` is now applied to individual hillshade tile images (`.hillshade-blend img.leaflet-tile`) instead of the Leaflet layer container. The container's inner `.leaflet-tile-container` uses `transform: translate3d` for hardware-accelerated zoom animation, which can intermittently establish its own stacking context and isolate the container-level blend from the base layer below — visible as the multiply effect "dropping out" at the closest zoom levels, most noticeable on the Topographic basemap where Esri's hillshade upscales from its z=16 native ceiling. Per-tile blending sidesteps the isolation entirely (#168, #169)

## v0.30.0-beta (2026-04-26)

### Added

- **Turn-by-turn routed navigation replaces GPS trail recording** — tap "Navigate here" on any search result or dropped pin and the app fetches a route from the FOSSGIS Valhalla service (driving / cycling / walking) and shows a bottom-left guidance pill with the next maneuver, distance, and ETA. Off-route detection (3-fix streak with profile-dependent thresholds: driving 30 m / cycling 20 m / walking 15 m) triggers automatic recalculation, throttled to once per 15 s. Arrival within a profile-dependent radius (driving 25 m / cycling 15 m / walking 10 m) collapses the pill back to idle after a brief "Arrived" confirmation (#154, #156, #158, #160, #166)
- **Heading-cone wedge on the GPS dot** — the same Google / Apple Maps idiom: a translucent cone behind the blue dot shows direction of travel from GPS course (`e.heading`). At low speeds where the browser reports `heading: NaN`, the wedge holds the last valid bearing for ~10 s before fading. No map rotation; north always stays up (#162, #165)
- **ADR-006: Routed Turn-by-Turn Guidance** — documents the architectural decisions: Valhalla via FOSSGIS over OSRM (multi-profile support), heading-cone over `leaflet-rotate` (GPL-3 license clash with the project's MIT), and the privacy regression vs. ADR-004 with explicit mitigations (single egress point, explicit-action only, consent re-acceptance) (#166)

### Changed

- **Consent text discloses routing egress** — added a new "Turn-by-turn routing" privacy bullet that names the FOSSGIS Valhalla service and discloses that current location + destination are sent only when the user explicitly taps "Navigate here". Privacy Policy and Terms of Use updated for the navigation use-case (e.g., "GPS trail recording" → "GPS-based navigation"; safety disclaimer updated to mention routing-direction accuracy). `CONSENT_VERSION` bumped 2.1 → 2.2, forcing re-acceptance from existing users (#166)

### Removed

- **GPS trail recording feature** — `src/recording.ts`, `src/trail-backup.ts`, `recording.test.ts`, the recording pill UI, GPX export (`buildGpx` / `downloadGpx`), localStorage trail-backup crash recovery, and the recording fields on `AppState`. Replaced by the routed guidance feature above. The `Keepalive`, battery monitoring, and GPS-weak-signal hysteresis subsystems carry over and are reused by guidance (#154, #156)

### Fixed

- **Mainline type-check on `lastValidHeading*` fields** — PR #162 introduced `state.lastValidHeadingDeg` / `state.lastValidHeadingMs` references in `src/location.ts` without declaring the corresponding `AppState` fields, breaking `npm run type-check`. Fields added next to the existing GPS-fix metadata; `createInitialState()` defaults updated (#164, #165)

## v0.29.0-beta (2026-04-26)

### Added

- **Maskable PWA icons for Android adaptive shapes** — installed PWAs on Android 13+ now render with proper rounded / squircle / teardrop shapes without corner-cropping the logo. Added `purpose: 'maskable'` icon entries (192×192 and 512×512) generated programmatically from the source SVG with 20%-per-side safe-zone padding, on a white background. Regenerate with `npm run icons` (#56, #153)

## v0.28.0-beta (2026-04-26)

### Added

- **Programmatic OG / social-preview image** — link previews on Slack / X / Discord / Facebook / iMessage now render a custom 1200×630 image: dark navy with topo-line pattern, "webmap.dev" wordmark + tagline ("Record GPS trails. Offline maps. No account."), three feature pills, and a stylized GPS pulse-dot. Source SVG lives at `public/og-image.svg`; rendered PNG is committed; regenerate with `npm run og` (uses `sharp`). Full `og:*` and `twitter:*` meta tags wired in `index.html` (#112, #152)

## v0.27.1-beta (2026-04-26)

### Changed

- **Shared collapse-helper consolidates label-collapse code across controls** — three near-identical inline patterns in `controls.ts`, `layers-control.ts`, and `offline-download.ts` collapsed into a single `setupCollapsibleLabel` helper exported from `controls.ts`. The new helper skips appending the label entirely when previously collapsed (read from `localStorage`), which incidentally fixes a brief flash-then-collapse the old `makeToggleControl` pattern produced on reload after first use. No user-facing behavior change beyond the eliminated flash (#140, #151)

## v0.27.0-beta (2026-04-26)

### Added

- **Hillshade blends with multiply for higher base-map contrast** — the hillshade overlay now uses CSS `mix-blend-mode: multiply` instead of a 0.4 alpha blend. Flat/lit areas (where hillshade is near-white) leave the base map untouched; only shaded slopes darken. Result: street and topo colors stay vivid when hillshade is enabled, while relief is still readable (#149, #150)

### Changed

- **Mouse-wheel zoom drops locate to passive** — wheel zoom translates the view toward the cursor (same effective consequence as a drag), so the "follow" semantic no longer holds. Wheel-zoom now mirrors the existing `dragstart` handler and flips locate from active → passive on the first wheel turn. Subsequent wheel ticks short-circuit; button zoom is unaffected (deliberate, keeps active center) (#147, #148)

## v0.26.1-beta (2026-04-26)

### Changed

- **Recording pill announces state to screen readers and manages focus** — the recording panel container now has `role="group"` and a state-driven `aria-label` ("Recording controls" / "Recording in progress" / "Recording paused"). Each button gets a plain-text `aria-label` so screen readers don't read the leading emoji glyph. On real state transitions (Record → Pause, Pause → Resume, Resume → Pause) keyboard focus moves to the new primary button, triggering AT announcement of the action. No visual or behavioral changes for sighted users (#143, #146)

### Fixed

- **Dead CSS rules removed** — six `.leaflet-bottom.leaflet-right` rules that targeted the empty post-rebalance cluster are gone; two compact-sizing rules that had been silently broken (targeting the wrong cluster) are now correctly scoped to `.leaflet-bottom.leaflet-left`. Plus `onRemove` cleanup added to LayersControl and the offline-download toggle so their `mouseenter` / `touchstart` / `touchend` / `click` listeners detach if the controls are ever removed and re-added (#141, #145)

## v0.26.0-beta (2026-04-26)

### Changed

- **Recording UI is now a single bottom-left "pill"** — the standalone `#recording-stats` overlay is gone; the recording panel now owns the full lifecycle as a pill with three state-driven appearances. Idle: compact transparent pill with just the green Record button. Active (recording): dark expanded pill with Duration / Dist / Ascent stats above Pause. Active (paused): same dark pill, Resume + Finish in place of Pause. After Finish: 1.5 s green "Saved ✓" confirmation, then collapses back to idle. CSS transitions `padding`, `background-color`, and `box-shadow` over 0.25 s for a smooth idle ↔ active morph; a `.recording-panel--always-expanded` fallback class is shipped for low-end Android. The `createStatsBar()` and `setStatsBarVisible()` helpers are removed in favor of state-driven class + content swaps in `renderButtons()` (#138, #144)

## v0.25.0-beta (2026-04-26)

### Changed

- **Two-step Pause→Finish reveal during recording** — the always-visible Stop button is gone. While recording, only Pause is shown; tapping Pause reveals Resume + Finish in the paused state. The reveal IS the confirmation, so the Stop confirmation modal (`confirmStop()`) and its `#consent-overlay`/`#consent-panel` modal is removed entirely. Strava + AllTrails dominant convention. Renamed `.rec-btn-stop` → `.rec-btn-finish` (#137, #142)

## v0.24.0-beta (2026-04-26)

### Changed

- **Mobile-first control layout (Phase 1 of the layout-rebalance epic)** — relocated frequently-used map controls into a single bottom-left thumb-reach cluster, reading top→bottom: locate, record, zoom +/−, scale, version-badge, attribution. Layers and Download moved to a top-right column; both labels collapse on first hover or touch with the state persisted in `localStorage`. Compact 28×28 sizing with 4px column gap and lighter shadow. The recording dashboard (`#recording-stats`) moves to upper-left during active recording. Honors the project's Mobile-First design principle (#135, #139)

### Fixed

- **Stop-recording dialog text padding** — the `<p>` element no longer butts up against the rounded panel's left edge; added a CSS rule for `#consent-panel > p` (#139)
- **Scale bar visibility** — restored the U-shaped left/right/bottom border with a darker `#333` stroke for readability against light terrain (#139)
- **Version badge clickable** — added `pointer-events: auto` to `#version-badge` so the changelog modal opens on click; the badge now lives inside `.leaflet-bottom.leaflet-left` which is `pointer-events: none` by default and only opts `.leaflet-control` children back in (#139)

### Removed

- **ZoomViewer dev indicator** — removed the 200px-wide opacity:0.15 "Zoom level: X.X" overlay from `map.ts` (was barely visible and was forcing the bottom-left cluster width to 200px) (#139)

## v0.23.0-beta (2026-04-18)

### Added

- **Double-tap locate hint** — when the map is panned (locate drops to passive), a 2.5s toast "Double-tap map to re-center" appears on touch devices on the first pan per session (`sessionStorage` key `locate-hint-shown`); the locate button icon also pulses twice via a one-shot CSS animation to draw the eye (#124)

### Fixed

- **GPS polling refcount guard** — `activatePolling()` now emits a `console.warn` in dev builds (`import.meta.env.DEV`) when `updateCallback` exceeds 2, catching activate-without-deactivate leaks before they silently keep GPS running forever; stripped by Vite in production (#125)
- **GPX trkpt timestamp docs** — added inline comments in `buildGpx()` documenting that `<time>` is required on every `<trkpt>` for Strava/Garmin moving-time and elevation-over-time compatibility, and that GPX 1.1 schema order is `<ele> → <time> → <extensions>` (#126)

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
