# ADR-009: Rotate the map by turning an oversized container

- **Status:** Accepted, with the on-device gates below. Supersedes the "map does not rotate" part of [ADR-006](ADR-006-routed-guidance.md) decision 2, and the same sentence in [ADR-008](ADR-008-heading-source-selection.md).
- **Date:** 2026-11-14
- **Issue:** [#366](https://github.com/jasoneplumb/webmap.dev/issues/366) (Phase 1 of 3)
- **Spike:** branch [`spike/366-map-rotation`](https://github.com/jasoneplumb/webmap.dev/tree/spike/366-map-rotation), never to be merged

## Context

Issue #366 asks for a direction-up mode: once the compass is granted, a tap on the rose switches the map between north-up and direction-up. [ADR-006](ADR-006-routed-guidance.md) decided the map would not rotate and rejected three ways of rotating it:

1. `leaflet-rotate`, on the grounds that its best-maintained fork was GPL-3.
2. A CSS transform, because every overlay would need its coordinates inverted.
3. MapLibre GL, because the migration was larger than the feature.

That decision was made for a heading cue. A direction-up mode needs real rotation, so this record compares the options again with measured numbers and picks a mechanism before Phase 3 writes feature code. Licences were checked against each repository and the npm registry, not taken from ADR-006.

Constraints any mechanism has to meet:

- **Licence.** webmap.dev is MIT, so a GPL-3 dependency is out.
- **Bundle.** `size-limit` caps the gzipped app chunk at **150 kB**. Mainline (`81381e9`) measures **120.39 kB**, which leaves 29.61 kB of headroom.
- **Tile patches.** `src/map.ts` replaces `GridLayer._animateZoom` on each raster layer (`deferTileLoadsUntilZoomEnds`, #287). It depends on Leaflet 1.9.4 private internals, which is why `leaflet` is pinned exactly.
- **Pointer paths.** Pin drop (Leaflet `contextmenu` plus the iOS long-press fallback in `geocoding.ts`), the touch double-tap in `map.ts`, custom-zone drawing, and canvas hit-testing all turn a screen point into a coordinate.
- **iOS freeze.** WKWebView has frozen on a full-screen composited layer at first paint (`style.css`, [#223](https://github.com/jasoneplumb/webmap.dev/issues/223)).

## Options and measurements

**How sizes were measured.** In-app sizes come from `npm run build && npm run size` after importing the candidate into `src/main.ts`, or, for the Leaflet fork, aliasing `leaflet` to it in Vite. These builds ran on the spike branch, which already measures 121.30 kB, so each in-app delta is taken against 121.30 kB. Standalone sizes are `gzip -9` of the package's minified dist file. All versions are the latest on npm as of 2026-11-14.

### (a) A `leaflet-rotate` plugin or a rotating Leaflet fork

| Candidate | Licence (source) | Maintenance | Size, gzipped |
| --- | --- | --- | --- |
| `leaflet-rotate` 0.6.2 ([Raruto/leaflet-rotate](https://github.com/Raruto/leaflet-rotate)) | **GPL-3.0** ([LICENSE](https://github.com/Raruto/leaflet-rotate/blob/master/LICENSE), [registry](https://registry.npmjs.org/leaflet-rotate)) | Active: seven releases between 2026-10-28 and 2026-11-14 | 11.7 kB standalone; **+10.73 kB** in-app (132.03 kB) |
| `@vpulim/leaflet-rotate` 0.1.4, `leaflet-rotate-xiaoai` 0.2.35 | GPL-3.0 ([registry](https://registry.npmjs.org/@vpulim/leaflet-rotate), [registry](https://registry.npmjs.org/leaflet-rotate-xiaoai)) | Forks of the above; last published 2022 and 2025 | not measured |
| `@tomickigrzegorz/leaflet-rotate` 0.3.0 ([repo](https://github.com/tomickigrzegorz/leaflet-rotate)) | MIT as labelled ([LICENSE](https://github.com/tomickigrzegorz/leaflet-rotate/blob/master/LICENSE)); **provenance unclear**, see below | One maintainer; created 2026-06-18, last push 2026-09-29, 4 stars | 7.2 kB standalone; **+6.35 kB** in-app (127.65 kB) |
| `leaflet-rotate-map` 0.3.2 ([ronikar/Leaflet](https://github.com/ronikar/Leaflet)) | BSD-2-Clause, as Leaflet ([LICENSE](https://github.com/ronikar/Leaflet/blob/master/LICENSE), [registry](https://registry.npmjs.org/leaflet-rotate-map)) | A fork of all of Leaflet, built as `1.9.4+rotate`; one maintainer, 2 stars; last release 2026-07-28 | 43.7 kB vs 42.4 kB for stock Leaflet; **+1.22 kB** in-app (122.52 kB) |

**Licence.** ADR-006's GPL-3 note still holds for Raruto's package and every fork of it on npm. Raruto's README credits Iván Sánchez's `rotate` branch of Leaflet itself ([Leaflet/Leaflet@rotate](https://github.com/Leaflet/Leaflet/tree/rotate), BSD-2, last commit 2016-09-27; the upstream request, [Leaflet#268](https://github.com/Leaflet/Leaflet/issues/268), is closed). It also credits [fnicollet/Leaflet](https://github.com/fnicollet/Leaflet), which is BSD-2 and archived. `leaflet-rotate-map` descends from that BSD-2 line.

**Why the MIT label on `@tomickigrzegorz/leaflet-rotate` cannot be relied on.** Its `src/map-core.js` defines `_animateZoomNoDelay`, a method name from Raruto's `src/L.Map.js`, under the comment `PR#61 fix`. [Raruto/leaflet-rotate#61](https://github.com/Raruto/leaflet-rotate/pull/61) is a PR to the GPL-3 project. Its pane layout (`_rotatePane` / `_norotatePane`) is the same design. If the package derives from GPL-3 code, the MIT label does not make it MIT. Settling that needs the author's confirmation or a line-by-line review. Until then it carries the same risk as the GPL-3 package.

**Conflicts with the tile patches in `map.ts`.**

- Both plugins wrap `GridLayer.prototype.getEvents` and `_getTiledPixelBounds`. The MIT one also wraps `_invalidateAll` and calls `_resetView` on pans in heading-up mode.
- `deferTileLoadsUntilZoomEnds` replaces the instance `_animateZoom` before add, so the two can co-exist. But a rotate event then calls `_update()` while rotation is changing, which in heading-up is every frame. That is the mid-gesture tile churn #287 removed.
- `leaflet-rotate-map` leaves `GridLayer._animateZoom` and `_setView` unchanged: a whitespace-insensitive diff against 1.9.4 shows only a comment. It pads `_getTiledPixelBounds` by the rotated bounding box. The `map.ts` patch would therefore keep working, but against a fork's internals rather than Leaflet's.

**Overlays and pointer paths.** All three plugins move markers, popups and tooltips to an unrotated pane and reposition them in JavaScript on every bearing change. They also rotate pointer input inside their own `mouseEventToContainerPoint` and drag handlers.

- Bearing-encoded markers would each need *heading minus map bearing*: the heading ring, cue-event ticks and custom-zone arrows.
- The `getBoundingClientRect` arithmetic in `map.ts` (double-tap) and `geocoding.ts` (long-press) would still be wrong.

**iOS freeze risk:** moderate. A rotate pane inside the normal container, plus JavaScript marker moves and tile updates on every frame of rotation.

### (b) CSS transform on an oversized container (in-house)

`#map` becomes a square whose side is the viewport diagonal, centred on the viewport and turned with `transform: rotate()`. Leaflet still sees an ordinary, larger, unrotated map. The spike implements this approach.

- **Licence.** MIT; it is our own code.
- **Size.** **+0.91 kB** in-app: 121.30 kB against 120.39 kB, 28.70 kB under the cap. That covers the pure math module plus the DOM glue.
- **Tile patches.** None conflict. Leaflet's tile range already covers the larger square, so the rotated corners fill without touching `GridLayer`. Changing the bearing is a compositor-only transform, with no `_update()` or tile work per frame.
- **Free with no work.** The heading ring, accuracy circle, route line and its travelled split, cue-event ticks, custom-zone arrows and hillshade all turn with the map. Each draws a bearing or a shape in map space, so it stays correct. The issue expected the heading indicator to need *heading minus map bearing*; with this mechanism it needs nothing.
- **What has to be patched,** each done in the spike:
  - `map.mouseEventToContainerPoint` inverse-rotates client points about the container centre. That one public method covers map clicks and `contextmenu` (pin drop), canvas hit-testing, pinch, wheel and box zoom.
  - `Draggable._updatePosition` turns and rescales drag offsets. Leaflet reads a rotated square's "scale" as |cos| + |sin|.
  - `Marker._setPos` appends a counter-rotation about the icon anchor, so pins and number badges stay upright. Markers that draw a bearing are exempt.
  - `Popup._updatePosition` counter-rotates popups about their tip.
  - Leaflet's control container moves into an unrotated `.leaflet-container` layer, which keeps leaflet.css's scoping.
  - The double-tap and long-press handlers use `map.mouseEventToContainerPoint` instead of `getBoundingClientRect`.
- **Cost: more tile area.** For a 390 × 844 portrait phone the covering square is 930 px, **2.63×** the viewport's tile area (2.09× on a 1024 × 1366 tablet). That multiplies tile requests and network use. The canvas renderer grows by the same factor: about 45 MB of backing store at DPR 3, against about 17 MB today. The cost applies only while rotated, because north-up restores the normal container.
- **Cost: anything that reads `map.getSize()` or `map.getBounds()` sees the oversized square.** That includes `flyToBounds` padding, popup auto-pan, the offline-download area and the loading spinner's corner.
- **iOS freeze risk:** moderate, and the lowest of the Leaflet options. The transform is applied only after the compass is granted and streaming, which is after the consent tap and never at first paint. In north-up the container is restored to today's exact styling. What remains untested is one oversized layer turning continuously in WKWebView.

### (c) Migrate to MapLibre GL JS

- **Licence.** BSD-3-Clause ([LICENSE.txt](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt), [registry](https://registry.npmjs.org/maplibre-gl)). Actively maintained: 6.18.0 was published 2026-11-11.
- **Size.** `maplibre-gl.mjs` 6.18.0 is **295.9 kB** gzipped on its own, 1.97× the whole 150 kB cap, plus a 147.2 kB worker. Dropping Leaflet (42.4 kB) and esri-leaflet cannot close that gap.
- **Tile patches.** Not applicable. Every Leaflet-specific module would be rewritten: the layers control, the canvas hillshade `GridLayer`, the tile wireframe, the offline fallback, `esri-leaflet-geocoder`, every overlay and both pointer paths.
- **iOS freeze risk:** highest. The map becomes one full-screen WebGL canvas from first paint, which is exactly the #223 trigger profile. WebGL context loss in WKWebView would add a failure mode the app does not have today.

## Decision

**Use (b): rotate an oversized `#map` container with a CSS transform, in our own code, with the rotation math in pure functions.**

- It is the only option that is licence-clean, adds a negligible amount to the bundle (+0.91 kB), and leaves the `GridLayer` patches and Leaflet's tile logic alone.
- Its per-frame cost in direction-up is one transform write.
- ADR-006 rejected a CSS transform because every overlay would need inverting. That premise is backwards for this design: map-space overlays are correct for free, and only "keep upright" elements need a counter-rotation, at four patch points.

**Runner-up: `leaflet-rotate-map`** (BSD-2, +1.22 kB). Use it if (b) fails the on-device gates for a reason a plugin avoids, such as the 2.63× tile area. The trade-off is replacing Leaflet with a one-maintainer fork.

**Rejected:**

- GPL-3 `leaflet-rotate` and its forks, on licence.
- `@tomickigrzegorz/leaflet-rotate`, until its provenance is settled.
- MapLibre GL, on size (about 2× the cap on its own), scope (a full rewrite) and first-paint freeze risk.

**Gates on Phase 3.** All of these must pass on a device before direction-up ships:

1. **iOS freeze soak.** On iOS Safari and Edge (WKWebView), cold-start with direction-up stored, then a 10-minute rotation soak with guidance running. No white or frozen screen.
2. **Correct under rotation.** On iOS and Android, at 45° and while rotating, these stay correct: the blue dot and heading ring, the accuracy circle, the route line, pin drop by both long-press and right-click, double-tap zoom, pinch around the fingers, and pan direction.
3. **Tile and memory cost.** No visible tile gaps in the corners, and no memory-related reloads during a rotated ride. Offline, saved regions still fill the oversized square near their edges.

If gate 1 fails and cannot be fixed, the mechanism is rejected: try the runner-up or close Phase 3. Do not ship a direction-up mode that can freeze the app.

## What the spike showed, and what it did not

**Verified here** (no browser or device was available):

- `npm run type-check`, `npm run lint` and `npm test` pass: 25 files, 456 tests, including 12 new tests of the rotation math in `src/map-rotation.test.ts`.
- `npm run build` succeeds and `npm run size` reads 121.30 kB.
- The tests show that the covering square covers every viewport corner at every bearing in 5° steps. They also show that the screen-to-container mapping round-trips, and that a corrected drag offset moves content in the screen direction of the finger.

**Not verified:**

- Anything visual or on a device: tiles filling the corners, upright pins, popups, drag feel, and the freeze.

**Known broken in the spike,** for Phase 3 to handle:

- Tooltips are not counter-rotated, so their text is tilted.
- Popups tilt during a zoom animation, because `Popup._animateZoom` overwrites the transform.
- Keyboard arrows pan in the rotated frame.
- `getSize()` / `getBounds()` consumers see the oversized square: fit-bounds padding, popup auto-pan, the offline-download area, and the loading spinner, which is still appended to the rotated container.
- Hillshade lighting turns with the map. Its sun direction is fixed in map space, not screen space.
- The compass rose sits in the unrotated layer and keeps showing device-relative north. In direction-up from GPS course it should show the map's north, which Phase 3 decides.

**Private Leaflet internals added:** `Draggable._updatePosition`, `Marker._setPos`, `Popup._updatePosition` and `Map._controlContainer`. They fall under the same exact-pin policy as the `GridLayer` patches.

## Consequences

**Good.**

- Direction-up becomes possible with no new dependency and no licence question.
- The bundle stays well under the cap.
- The `GridLayer` work from #287 is untouched.
- Rotation math stays pure and unit-tested under the repo's vitest policy.

**Costs.**

- While rotated, the map fetches and paints about 2.6× the tile area on a portrait phone.
- Four more Leaflet private methods are patched.
- The Leaflet controls move out of `#map` into a sibling layer. That is a DOM-structure change: any CSS that scopes controls under `#map` or under the map container's state classes (`leaflet-touch`, zoom classes) has to follow them.
- Phase 3 also updates `docs/features.md`, `docs/architecture.md` and `CLAUDE.md`, which say the map never rotates. Until Phase 3 ships, those statements stay true.

## Related decisions

- [ADR-006: Routed Turn-by-Turn Guidance](ADR-006-routed-guidance.md). Its "map does not rotate" choice and its rejection of rotation mechanisms are superseded here. The heading ring it introduced stays.
- [ADR-008: Heading source follows motion state](ADR-008-heading-source-selection.md). `selectHeading()` remains the direction source; only its "the map still does not rotate" sentence is superseded.
- [ADR-005: Two-Tier Offline Tile Strategy](ADR-005-offline-tile-strategy.md). Saved regions are sized for the visible viewport; the oversized square reads past them near their edges (gate 3).
