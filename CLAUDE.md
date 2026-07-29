# CLAUDE.md

Project-specific guidance for webmap.dev. Global workflow preferences are in `~/.claude/CLAUDE.md`.

## What This Project Is

**webmap.dev** is a GPS mapping web app built with Leaflet and ESRI geocoding. Key features:

- Real-time GPS location tracking with three-state locate (off / active-following / passive)
- Turn-by-turn routed navigation via FOSSGIS Valhalla (driving / cycling / walking)
- Reverse geocoding (pin drop → address lookup) with clipboard copy
- Address search via ESRI Leaflet Geocoder
- Offline tile pre-download + Workbox passive caching (PWA)

## Tech Stack

- **Vite** + **TypeScript** (ES2020 target, strict mode, `noUncheckedIndexedAccess`)
- **Leaflet** 1.9 + **esri-leaflet** 3 + **esri-leaflet-geocoder** 3
- **vitest** for unit tests (pure-function tests; no DOM/Leaflet integration)

## Key Commands

```bash
npm run dev          # Dev server (http://localhost:5173)
npm run build        # Production build
npm run preview      # Preview production build
npm run type-check   # TypeScript check (tsc --noEmit)
npm run lint         # ESLint
npm test             # vitest run
npm run size         # size-limit (gzipped JS bundle; run `npm run build` first — measures dist/ as-is; cap lives in package.json, raised per feature wave)
```

## File Structure

```
src/
  ├── main.ts               # Entry point — wires all modules together
  ├── types.ts              # AppState interface + createInitialState()
  ├── map.ts                # Leaflet map + tile-layer config
  ├── layers-control.ts     # Base-map / overlay popover control
  ├── controls.ts           # Bottom-left thumb cluster (locate, version, attribution)
  ├── geocoding.ts          # Address search + reverse geocoding + Navigate-here
  ├── location.ts           # GPS locationfound handler + heading-cone wedge
  ├── guidance.ts           # Turn-by-turn navigation state machine + pill UI
  ├── routing.ts            # Valhalla client + polyline6 decoder
  ├── geo.ts                # haversineDistance, bearingDeg, pointToSegmentMeters
  ├── timer.ts              # GPS polling refcount loop
  ├── consent.ts            # First-run privacy consent modal
  ├── keepalive.ts          # Wake Lock + silent-audio loop for background GPS
  └── style.css             # App styles
docs/adr/                    # Architecture Decision Records
```

## Architecture Pattern

**Single AppState object** (`types.ts`) threaded by reference through all modules — no event bus or state management library. Modules mutate state directly. See [ADR-001](docs/adr/ADR-001-single-mutable-state.md).

**GPS polling uses a refcount** (`updateCallback: number`) so locate, guidance, and other consumers can independently request/release the watch without stepping on each other. See [ADR-002](docs/adr/ADR-002-refcount-gps-polling.md).

## Notes

- `esri-leaflet-geocoder.d.ts` is a local type stub — the package lacks complete TypeScript types
- Verify changes with `npm run type-check && npm run lint && npm test`; UI changes also require manual browser testing
