# Changelog

## v0.52.3 (2026-09-20)

Two things on the map were hard to see or hard to reach.

### Fixed

- **The direction arrow on the position marker is readable against any tile.** It was a bare triangle with no outline, so it disappeared over pale satellite imagery and anywhere the ground was busy. It now sits on a white casing, and the arrowhead itself is flatter — the old one was within 8% of equilateral, which gave away little about which end was the point. Both arrows get it: the blue one for direction of travel and the amber one for where the device is facing (#331)
- **The Map Layers popover can always be closed while a route is running.** On a short screen it opened underneath the guidance banner, which covered its header and with it the only close button. It now treats the banner's lower edge as a ceiling and shortens from the top, leaving its bottom edge where it was. Two faults sat behind it and went at the same time: the height limit was written onto a box that could not contain its own contents, so it shrank the border while the list spilled straight past it, and the limit was never cleared afterwards — once a route had squeezed the popover, it stayed squeezed for the rest of the session, long after the route ended (#332)

### Documentation

- README and the architecture notes rewritten to drop em-dashes and deposition framing (#329)

## v0.52.2 (2026-09-14)

### Fixed

- **Double-tap zooms in one level on the point you tapped.** Two faults were stacked. The map set its discrete zoom step to half a level, so on desktop a double-tap moved so little it looked like nothing happened — that step controls the +/- buttons and keyboard too, and all three now move a whole level while pinch keeps its smooth half-steps. On iPhone the gesture never arrived at all: Leaflet pairs two taps within 200 ms, tighter than an ordinary thumb, and iOS does not reliably report a double-tap on a map that has already claimed the touch for dragging. The app now recognises the gesture itself, with a window wide enough for a real hand, and rejects a pan's release so dragging the map and then tapping no longer zooms by accident (#296)

## v0.52.1 (2026-09-14)

No user-facing change. Two internal measurements were lying.

### Internal

- **`npm test` no longer counts the same tests several times.** `clones/` holds git worktrees of this repo, so every test file existed once per worktree and the local run reported a multiple of the real count — 926 "passing" against 391 actual. CI checks out clean and was always right, so the two disagreed with nothing failing, and the inflated figure reached PR descriptions. Vitest's own default exclusions are preserved rather than replaced
- **`package.json` is pinned to LF.** A single npm write left it CRLF, and npm preserves whatever endings it finds, so it stuck: every later edit rendered as a full-file rewrite, and a one-line version bump showed as 55 changed lines with the real change buried inside. Normalized and pinned in `.gitattributes` alongside the lockfile

## v0.52.0 (2026-09-14)

Three corrections to things the map was doing wrong in plain sight: a compass that shivered, credits that were cut off and printed twice, and a double-tap that refused to zoom.

### Changed

- **Double-tap zooms in, like every other map.** It used to re-centre on your position instead — but only while location following was paused, so the same gesture did different things depending on state you could not see, and the standard zoom was actively suppressed. Re-centring moves to a tap on the guidance banner at the top of the screen, where your attention already is while following a route. The locate button remains the way to re-centre at any other time (#296)

### Fixed

- **The compass rose no longer shivers when you stand still.** The position marker was filtered twice — once for sensor noise, once for animation — and the rose only once, so it drew raw magnetometer jitter. Made worse by the filter being applied per sensor reading rather than per unit time: on a phone reporting at 60 Hz it converged within a frame and smoothed nothing. The rose now eases the same way the marker does, and a leftover CSS transition that was fighting the new easing is gone (#323)
- **Every map credit is visible, and OpenStreetMap is credited once.** The attribution line ran past the right edge of a phone screen and its tail — carrying the OpenStreetMap and Thunderforest credits — was simply cut off. It now wraps. Separately, the same OpenStreetMap phrase was embedded in three different provider strings, so the default layer stack printed it two or three times over; the shared credit is now contributed once by whichever layers use OpenStreetMap data, and disappears when the last of them is switched off

### Internal

- Drawing a custom zone temporarily disables double-tap zoom: a vertex lands on every click, so tracing a corner quickly would otherwise zoom the view out from under the next one (#296)

## v0.51.0 (2026-09-14)

Offline maps stop being one base layer you hope survives eviction: you choose which layers to save, the tiles land in a cache nothing else can evict, and the app shows you what you have. The position marker also learned which way you are facing while standing still.

### Added

- **Save a region for offline use across multiple layers, in a cache that cannot be evicted out from under you.** Pre-downloaded tiles used to share the passive cache, whose LRU could quietly discard the region you deliberately saved — and only the one base map was saved at all, so switching layers offline showed nothing. Downloads now cover every provider whose terms allow bulk fetching (OSM Streets plus Terrarium hillshade), land in their own protected cache with no expiry, and are listed in a manager showing each region's layers, zoom range and size, with per-layer offline badges in the layers picker (#304)
- **The position marker shows which way you are facing, not just which way you are moving.** GPS course is `NaN` below walking pace, so the direction indicator vanished whenever you stopped. The marker now falls back to the device compass while stationary and draws it in a different colour — facing and travelling are different claims and are no longer made in the same voice (#311)
- **Deploys apply the nginx config from the repo instead of trusting whatever is on the host.** The config was applied by hand, so the repo copy could drift from what was actually serving — drift that caused and prolonged the blank-page outage, where a repo-only fix could not take effect. The config is now shipped and validated on every deploy, and a config that fails `nginx -t` is never activated (#211, #321)

### Fixed

- **Re-downloading an area no longer creates a second entry that silently empties the first.** Each download minted a fresh manifest id, and because deleting a region recomputes its tile URLs from the area and zoom range, deleting either twin removed the tiles the other still listed. The survivor went on reading as fully saved and the gap appeared only when you were offline. Re-downloads now update the existing entry in place (#318, #322)
- **Deleting a saved region asks first.** Deletion is irreversible and was one mis-tap away on a small mobile panel (#318, #322)
- **The compass rose no longer spins a full turn backwards every time you pass north.** The rose animates its rotation, and it was handed a wrapped angle, so 359° to 1° — two degrees of real movement — was drawn as a 358° spin the wrong way (#317)
- **The position marker's parts are centred on your actual position.** The dot sat two pixels off the fix it marks, the ring and its arrowhead each centred somewhere different, and the arrowhead orbited the marker's corner rather than its centre, so how far off it looked depended on which way you faced (#313)
- **The offline tile warning names a layer that exists.** It advised switching to "Structures", which has never been one of the bases, and it now only claims your saved regions cover the area when a region actually contains the tile that failed (#308, #309, #304)
- **The Cycle base is no longer multiplied by itself.** The base and its blend overlay requested the identical tile, so stacking them applied a gamma-2.0 curve — crushed midtones and oversaturated colour — from a single fetch (#305, #306)

### Security

- **`@babel/core` is pinned past a build-time advisory.** GHSA-4x5r-pxfx-6jf8 (arbitrary file read via a `sourceMappingURL` comment) reached the tree through `vite-plugin-pwa`, which resolved to the last affected version. Build-time only and never in a shipped bundle; `npm audit` now reports zero (#319, #320)

### Internal

- Bundle size is reported as a measurement rather than a stale budget: the main JS chunk measures 131 kB gzipped against a 150 kB CI-enforced ceiling, and the docs no longer quote the two interchangeably (#307)
- Development dependency updates: js-yaml, sharp, baseline-browser-mapping, browserslist, @humanfs/node (#294, #295, #297, #298, #302)

## v0.50.0 (2026-09-12)

First stable release — the `-beta` postfix is retired. The app has been serving production traffic at [webmap.dev](https://www.webmap.dev) through 49 minor releases; the version now says so.

### Security

- **Deploys now verify the server's SSH identity against a pinned host key.** The deploy workflow used to trust whatever key the server presented at deploy time, so a machine-in-the-middle or replaced server could silently receive the build. The known-hosts entry is now stored as a verified secret with strict host-key checking, and the deploy fails closed on any mismatch (#299)

## v0.49.0-beta (2026-08-31)

### Added

- **Search results are numbered in the list, matching the numbered pins on the map.** The map had always dropped numbered markers, but the list beside them was unnumbered, so there was nothing to tell you which row was pin 4. Each row now carries the same numbered disc as its pin, and both turn red together when you select one (#292)

### Fixed

- **The search results panel no longer runs off the right edge of a phone screen.** It was allowed to be wider than the screen itself, which pushed its close button and the arrow at the end of every row out of view (#292)

### Documentation

- **The README preview screenshots are regenerated by a command** (`npm run screenshots`) instead of being cropped by hand, which is why they had drifted: the old set showed base maps that have since been renamed and none of the app's actual screens. The new set covers every base map, the tile overlays, the layers popover, search results, and turn-by-turn guidance (#292)

## v0.48.0-beta (2026-08-31)

### Added

- **Custom squeeze zones now carry a direction of travel.** A zone is drawn as a line, so it always had one — nothing surfaced it. Arrows show it on the map, the popup names it, and it survives export, so a zone drawn for the descent of a road no longer biases cueing on the climb as well (#277, #278)
- **A faint tile grid appears while you zoom**, marking where the map's tiles will land. It costs nothing to draw, so it shows the zoom you're heading to immediately, and it disappears the moment the map settles (#287)

### Changed

- **The map now opens on Satellite with Cycle blend and Hillshade**, and the terrain sun follows the base map instead of being a separate setting — there is one right answer per base, so a toggle only offered a way to get it wrong. The starting base map was previously whichever layer happened to sit first in the list (#279, #280)
- **Every map layer is now kept offline once you've looked at it.** Only the Structures base was cached before, so the default Satellite and Hillshade view re-downloaded on every zoom step, even on ground you'd already browsed. Tiles you've viewed are now kept for 30 days, in storage separate from any region you deliberately pre-downloaded, so ordinary panning can't evict a saved area (#287)
- **The draw-zone and offline-download panels now open at the top of the screen.** They sat at the bottom, which is where every control now lives and where the navigation sheet sits; both top corners were empty. The offline panel previously dropped to the bottom on phones specifically — it no longer does, and its collapse control still gets it out of the way on a short screen (#289)
- **The control that put the map into a mode now turns blue while that mode is active** — the pencil while you're drawing a zone, the download arrow while its panel is open. Previously the floating panel was the only sign anything had changed (#289)

### Fixed

- **Zooming no longer shows two zoom levels blended together.** Tiles from the level you were leaving and the level you were arriving at were composited over one another — brighter where they overlapped, and offset by a pixel — until the new level finished loading. The map now holds one level for the whole gesture and swaps once, so every frame you see is a single, aligned image (#287)
- **The hillshade no longer changes strength depending on what you did last.** Switching base maps left the Cycle blend stacked over the terrain shading and muted it, and toggling Hillshade off and on was the only way to get it back. Layer order is now fixed rather than depending on the order you happened to turn things on (#287)
- **Terrain shading loads far less at high zoom.** The hillshade fetched a full grid of tiles above the elevation data's own ceiling, where a handful of scaled tiles carry exactly the same detail (#287)
- **Offline coverage now works for the layers that were silently failing.** Tiles cached by the app itself were stored in a form that nothing could read back, so the lower-zoom fallback that fills in missing tiles offline never had anything to draw (#287)
- **Copy left over from the removed trail-recording feature** has been replaced with navigation wording
- **Dependency update PRs can be reviewed again** — every commit pushed by Dependabot failed the review check outright (#284, #285)

### Security

- **GitHub Actions are pinned to full commit SHAs** rather than tags, so a moved tag cannot change what runs in CI
- **Dependency updates** across the build toolchain (#267, #268, #269, #270, #271, #272, #273, #274, #276, #282)

## v0.47.0-beta (2026-08-08)

### Added

- **The search box takes focus when the app loads**, so you can type a place and press Enter without reaching for the mouse. Not on phones and tablets: focusing an input there raises the on-screen keyboard over the map on every load, which is the opposite of useful for an app you open to see where you are (#263, #264)

### Fixed

- **The search box no longer collapses immediately after loading** — the map grabbed focus for its keyboard zoom shortcuts a moment after the search box received it, and the now-empty box closed itself 150 ms later. Keyboard zoom and pan shortcuts still work; they start as soon as you click the map (#265, #266)

## v0.46.0-beta (2026-08-08)

### Changed

- **Every map control now lives in a single column at the bottom left** — search, layers, download, draw-zone, compass, locate, zoom, scale, version and attribution were previously split across three corners; both top corners are now empty. Order, top to bottom: layers, download, draw-zone, compass, locate, zoom, search, results toggle, scale, version, attribution. The column is bounded to the space above the navigation sheet and scrolls internally, so a short or landscape viewport can never push a control off-screen (#262)
- **The compass keeps its place in the stack even when unavailable** — it previously collapsed entirely, which shifted every control above it the moment a permission prompt resolved (#262)
- **The navigation sheet is centred again** — it was anchored to the right edge to stay clear of the bottom-left controls, which is no longer needed now that the controls sit above it (#262)
- **The layers button uses a stacked-sheets icon** instead of a gear, which read as app settings rather than map layers, and now matches the other buttons' size on touch devices — it was 20px there while everything else was 16px (#262)

### Added

- **The search results list can be hidden and revealed** — a toggle beneath the search box brings the last set of results back without re-running the search. Result markers already stayed on the map; the list itself could previously only be recovered by tapping one of them (#261, #262)

### Fixed

- **Search failures explain themselves instead of failing silently** — a failed lookup was reported as *"No results found. Try zooming out or rewording your search."*, advice that cannot help when the service is unreachable, and autocomplete failures produced no feedback at all. The message now names the cause: offline, no API key in the build, a key that doesn't authorise this site, rate limiting, or a service outage. A genuine zero-match search keeps the original wording, which is only correct there (#260, #262)
- **Turn-by-turn directions no longer repeat themselves to screen readers** — the banner announced the full instruction, distance and ETA on every GPS fix, roughly once a second. Only the maneuver and status changes are announced now; the visible banner still updates continuously (#258, #259)

## Earlier releases

Condensed to one line each. Full entries for these versions remain in the git history of this file.

- **v0.45.0-beta** (2026-08-08) — Turn-by-turn directions moved to a banner across the top; navigation sheet anchored right at half its height; dropping a pin opens the sheet immediately; the bottom-left controls ride above the sheet instead of being buried by it (#253, #257)
- **v0.44.1-beta** (2026-08-08) — Switching the Hillshade sun direction no longer wipes the shading; elevation is cached separately from the shading it feeds, so re-lighting needs no network (#250)
- **v0.44.0-beta** (2026-07-29) — Direction-of-travel arrows and a "Too early" grade on cue events; the bottom navigation sheet drops to two sizes (#247, #248)
- **v0.43.0-beta** (2026-07-29) — Dismissing the navigation sheet minimizes it to a drag-handle pill instead of destroying it (#247)
- **v0.42.0-beta** (2026-07-29) — Hillshade re-lit on-device from Terrarium elevation to match Satellite imagery; new Bike infrastructure overlay (#246)
- **v0.41.0-beta** (2026-07-29) — Zoom limit raised from 18 to 19, rendering the deepest native tiles scaled up rather than asking providers for more
- **v0.40.0-beta** (2026-07-29) — New Satellite base map and Cycle blend overlay; cue files using the `unrecognized` grade load again (#244)
- **v0.39.0-beta** (2026-07-21) — New Custom squeeze zones overlay with draw, edit, export and import; draw mode no longer breaks reverse-geocode pin-drop (#243)
- **v0.38.0-beta** (2026-07-16) — Grade cue events on the map with a reviews sidecar export; GPS track and exact event positions; change an overlay's file without DevTools (#237, #238, #240, #242)
- **v0.37.0-beta** (2026-07-14) — New Cue events overlay showing where the cue policy actually fired during a ride, loaded from a local file only (#232)
- **v0.36.0-beta** (2026-07-13) — New Squeeze zones overlay rendering cycling squeeze zones from a local GeoJSON file, deliberately with no bundled or remote data (#228, #230)
- **v0.35.0-beta** (2026-06-05) — The first-run consent dialog requires reading the terms: Accept stays disabled until you scroll to the end (#226)
- **v0.34.9-beta** (2026-06-05) — Removed the temporary blank-page diagnostics; the iOS-26 WKWebView render freeze is paused pending a future iOS update (#224)
- **v0.34.8-beta** (2026-06-05) — Reduced first-paint compositing pressure as a further attempt at the Edge/Chrome-on-iPhone blank screen (#223)
- **v0.34.7-beta** (2026-06-05) — Blank screen on cold start now auto-recovers: no content paint after ~3s triggers one guarded reload (#221)
- **v0.34.6-beta** (2026-06-05) — Consent overlay mounts one animation frame after first paint so iOS WebKit composites it reliably (#219)
- **v0.34.5-beta** (2026-06-04) — Service worker rewritten to `injectManifest` so any failed navigation falls back to the precached shell (#217)
- **v0.34.4-beta** (2026-06-04) — Removed the NetworkFirst navigation timeout that fell back to a flaky runtime cache on slow cold starts (#215)
- **v0.34.3-beta** (2026-06-04) — Navigation served NetworkFirst; nginx serves `/sw.js` with `no-cache` instead of a year of `immutable` (#210, #213)
- **v0.34.2-beta** (2026-06-04) — Blank-page probe detects blankness by counting rendered map tiles rather than child nodes (#208)
- **v0.34.1-beta** (2026-06-04) — Temporary on-screen diagnostic for a blank-on-load reproducing only on mobile Chromium (#207)
- **v0.34.0-beta** (2026-06-04) — Hiking and Cycling routes split into independent overlays; a boot watchdog reloads once if the bundle never executes (#202, #206)
- **v0.33.2-beta** (2026-06-04) — Blank page on first load after an update fixed with `navigateFallback` and outdated-precache cleanup (#204)
- **v0.33.1-beta** (2026-06-04) — Removed a dead bottom-sheet module that flashed an empty tray over the map after an update (#200)
- **v0.33.0-beta** (2026-06-04) — Thunderforest Cycle and Outdoors base maps replace the unreliable CyclOSM source; new Routes overlay; unified search-to-navigation flow (#195)
- **v0.32.3-beta** (2026-06-02) — Service-worker update reload is visibility-aware and genuinely post-paint, applied at most once (#192)
- **v0.32.2-beta** (2026-05-23) — Browser tab title no longer hijacked by search and pin-drop; it tracks navigation only
- **v0.32.1-beta** (2026-05-20) — Routing failures surface in a modal above all app chrome; production deploys run only on version tags (#187, #188)
- **v0.32.0-beta** (2026-05-20) — Locale-aware distance units; opaque CORS failures become an actionable "routing service unavailable" message (#182, #184)
- **v0.31.4-beta** (2026-04-26) — Guidance Stop button switched to event delegation so ~1 Hz re-renders stop eating taps (#179, #180)
- **v0.31.3-beta** (2026-04-26) — Geocode-bar Navigate opts back into `pointer-events` in peek state; the search dropdown closes on "Navigate here" (#177, #178)
- **v0.31.2-beta** (2026-04-26) — The geocode bar hides itself before guidance starts, so its drag handle stops swallowing Stop taps (#175, #176)
- **v0.31.1-beta** (2026-04-26) — Hillshade blend reverted to layer level with `isolation: isolate`; the Navigate destination threaded through one shared setter (#171, #172, #173, #174)
- **v0.31.0-beta** (2026-04-26) — Device-orientation compass widget; per-tile hillshade blending to dodge stacking-context dropouts at max zoom (#163, #168, #169, #170)
- **v0.30.0-beta** (2026-04-26) — Turn-by-turn routed navigation via FOSSGIS Valhalla replaces GPS trail recording; heading cone on the GPS dot; ADR-006 (#154, #156, #158, #160, #162, #164, #166)
- **v0.29.0-beta** (2026-04-26) — Maskable PWA icons so Android adaptive shapes stop corner-cropping the logo (#56, #153)
- **v0.28.0-beta** (2026-04-26) — Programmatic OG / social-preview image with full `og:*` and `twitter:*` meta tags (#112, #152)
- **v0.27.1-beta** (2026-04-26) — A shared `setupCollapsibleLabel` helper consolidates three near-identical control patterns, removing a flash-then-collapse on reload (#140, #151)
- **v0.27.0-beta** (2026-04-26) — Hillshade blends with multiply for higher base-map contrast; wheel zoom drops locate to passive (#147, #148, #149, #150)
- **v0.26.1-beta** (2026-04-26) — Recording pill announces state and manages focus; dead CSS removed and control listeners detach on removal (#141, #143, #145, #146)
- **v0.26.0-beta** (2026-04-26) — Recording UI became a single bottom-left pill with idle, active and paused appearances (#138, #144)
- **v0.25.0-beta** (2026-04-26) — Two-step Pause then Finish reveal replaces the Stop button and its confirmation modal (#137, #142)
- **v0.24.0-beta** (2026-04-26) — Mobile-first layout: one bottom-left thumb cluster, Layers and Download moved to a top-right column (#135, #139)
- **v0.23.0-beta** (2026-04-18) — Double-tap locate hint on first pan; a GPS polling refcount guard warns on activate-without-deactivate leaks in dev (#124, #125, #126)
- **v0.22.2-beta** (2026-04-18) — Locate label persists collapsed across reloads; basemap screenshots aligned to identical tile coordinates (#127)
- **v0.22.1-beta** (2026-04-18) — Basemap preview images in the README; double-tap to re-center without triggering zoom (#123)
- **v0.22.0-beta** (2026-04-18) — Background GPS keepalive via Wake Lock and a silent audio loop; blank page after an iOS Safari update fixed (#119, #121)
- **v0.21.0-beta** (2026-04-17) — Tests for haversine distance, snap-point math and the recording state machine; `size-limit` bundle tracking in CI
- **v0.20.9-beta** (2026-04-17) — README badges, repo topics, PR and issue templates, five ADRs, SECURITY.md, CONTRIBUTING.md and a code of conduct
- **v0.20.8-beta** (2026-04-17) — Consent dialog condensed, with title and buttons pinned while the legal text scrolls independently
- **v0.20.7-beta** (2026-04-17) — Locate icon consistent across states; download panel repositioned and collapsible on mobile; control labels collapse after first use
- **v0.20.6-beta** (2026-04-17) — Bottom sheet no longer bleeds into view on older iOS Safari; snap points measure the rendered element instead of `innerHeight`
- **v0.20.5-beta** (2026-04-17) — Stop-recording dialog replaced the native `confirm()` with a styled modal
- **v0.20.4-beta** (2026-04-17) — Overlays re-stack above the new base map when switching layers, instead of being buried by it
- **v0.20.3-beta** (2026-04-17) — Layers popover clamps to the viewport when flipped above the button and caps its height so content stays scrollable
- **v0.20.2-beta** (2026-04-17) — Default hillshade renders on first load; a ghost OSM tile layer had been blocking the overlay
- **v0.20.1-beta** (2026-04-17) — Map no longer goes blank at high zoom; `maxZoom` and `maxNativeZoom` corrected per layer
- **v0.20.0-beta** (2026-04-17) — Trails became the default base with Hillshade on for new users; locate icon redesigned to the iOS arrow
- **v0.19.4-beta** (2026-04-17) — Layers popover font matches the buttons; the uninformative per-layer Offline badge removed
- **v0.19.3-beta** (2026-04-17) — Broken OpenTopoMap hillshade endpoint (403) replaced with the Esri World Hillshade service
- **v0.19.2-beta** (2026-04-17) — Consent modal reworded to cover general app usage; consent version bumped to 2.0, forcing re-acceptance
- **v0.19.1-beta** (2026-04-17) — Consent now gates all app usage at load time, not just starting a recording
- **v0.19.0-beta** (2026-04-16) — First-run consent dialog with inline Terms of Use and Privacy Policy (#103)
- **v0.18.1-beta** (2026-04-16) — Fixed a runtime error when the layers control added tile layers to the map
- **v0.18.0-beta** (2026-04-16) — Custom layers popover replaces Leaflet's native switcher; free OSM tile sources replace Mapbox and Google imagery
- **v0.17.1-beta** (2026-04-16) — Locate and Download tooltips trigger anywhere on the button, not just the icon
- **v0.17.0-beta** (2026-04-16) — Explanatory tooltips on Locate and Download to improve discoverability
- **v0.16.0-beta** (2026-04-16) — Text labels on the locate, tracking and download buttons; download control repositioned above search
- **v0.15.0-beta** (2026-04-14) — Adaptive GPS polling to cut battery drain; expandable search results on mobile; offline region pre-download UI (#95, #96, #97, #98, #99)
- **v0.14.3-beta** (2026-04-14) — GPS weak-signal badge in the stats bar; long addresses get a `title` tooltip (#90, #91)
- **v0.14.2-beta** (2026-04-11) — Top-left controls resized to match the geocoder search button
- **v0.14.1-beta** (2026-04-11) — Recording stats bar no longer overlaps the buttons on iPhone; vertical stack and compact buttons
- **v0.14.0-beta** (2026-04-11) — Ascent replaces Speed in the stats bar, tracked from GPS altitude deltas
- **v0.13.0-beta** (2026-04-11) — GPS trail recording with GPX export, offline resilience and localStorage crash recovery
- **v0.12.1-beta** (2026-04-09) — All edge-pinned controls and overlays respect Safari iPhone safe areas
- **v0.12.0-beta** (2026-04-09) — Locale-appropriate units, a Copy confirmation, larger recording buttons and higher-contrast stats
- **v0.11.0-beta** (2026-04-09) — Version badge became a button toggling a scrollable changelog panel
- **v0.10.0-beta** (2026-04-09) — Toast when the geocoder returns nothing; the iOS keyboard "Done" button submits the search
- **v0.9.4-beta** (2026-04-09) — Location-denied toast persists until dismissed and includes the iOS settings path
- **v0.9.3-beta** (2026-04-09) — Double-clicking a toolbar button no longer drops a pin; auto-reload after a service-worker update
- **v0.9.2-beta** (2026-04-08) — Reverse-geocode bottom sheet replaced with a compact single-line bar
- **v0.9.1-beta** (2026-04-08) — Selecting a search result clears the dropped pin and closes the info panel
- **v0.9.0-beta** (2026-04-08) — Toggle controls match Leaflet zoom button width; overlay shadows standardized
- **v0.8.6-beta** (2026-04-08) — Reverted the sticky-header dropdown; the search icon clears the previous dropdown and its pins
- **v0.8.5-beta** (2026-04-08) — Sticky dropdown header with only the results list scrolling
- **v0.8.4-beta** (2026-04-08) — Dropping a reverse-geocode pin clears the search result selection
- **v0.8.3-beta** (2026-04-08) — Dropdown dismisses only via its × button, removing spurious auto-dismiss
- **v0.8.2-beta** (2026-04-08) — Clicking a result no longer dismisses the dropdown; results gained hover tooltips
- **v0.8.1-beta** (2026-04-08) — Clicking a map marker restores the dropdown and updates the page title
- **v0.8.0-beta** (2026-04-08) — Search results moved to a floating dropdown anchored below the search bar
- **v0.7.2-beta** (2026-04-08) — Result list always visible after a search; the sheet upgrades from peek to half
- **v0.7.1-beta** (2026-04-08) — Zoom-responsive markers, corrected `flyToBounds` padding and ESRI-extent single-result zoom
- **v0.7.0-beta** (2026-04-08) — Numbered markers, richer result detail, smart zoom and bidirectional list/map selection (#69, #70, #71, #72, #73)
- **v0.6.2-beta** (2026-04-08) — Search results constrained to the visible map area at zoom 7 and above
- **v0.6.1-beta** (2026-04-07) — `watchPosition` replaces the GPS polling loop; locate icon became the standard angled arrow (#60, #62)
- **v0.6.0-beta** (2026-04-01) — Bottom-sheet drift and tile blur fixed; GPX export correctness; PWA guarded against auto-update while recording (#49, #54, #57, #58)
- **v0.5.1-beta** (2026-04-01) — GPS refcount leaks resolved, ESRI private-API access removed, docs and the MIT license added (#42, #51, #52, #53, #55)
- **v0.5.0-beta** (2026-03-31) — GPX export on stop; search spinner and Enter fixed; racy iOS `permissions.query` check removed (#37, #38, #40, #41)
- **v0.4.0-beta** (2026-03-31) — Controls relocated to top-left; version badge; iOS user-gesture fixes for GPS and clipboard (#20, #23, #24, #25, #26)
- **v0.3.0-beta** (2026-03-18) — Three-state locate, enhanced search, track recording, mobile bottom sheet, service worker and the Vite + TypeScript toolchain (#10, #11, #12, #13, #14, #15, #16, #18)
