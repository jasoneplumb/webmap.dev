# CLAUDE.md

Project-specific guidance for webmap.dev. Global workflow preferences are in `~/.claude/CLAUDE.md`.

## What This Project Is

**webmap.dev** is a GPS mapping web app built with Leaflet and ESRI geocoding. Key features:

- Real-time GPS location tracking with centering and breadcrumb trail recording
- Reverse geocoding (pin drop → address lookup) with clipboard copy
- Address search via ESRI Leaflet Geocoder

## Tech Stack

- **Vite** + **TypeScript** (ES2020 target, strict mode, `noUncheckedIndexedAccess`)
- **Leaflet** 1.9 + **esri-leaflet** 3 + **esri-leaflet-geocoder** 3
- No test framework (no `test` script in package.json)

## Key Commands

```bash
npm run dev          # Dev server (http://localhost:5173)
npm run build        # Production build
npm run preview      # Preview production build
npm run type-check   # TypeScript check (tsc --noEmit)
npm run lint         # ESLint
```

## File Structure

```
src/
  ├── main.ts               # Entry point — wires all modules together
  ├── types.ts              # AppState interface + createInitialState()
  ├── map.ts                # Leaflet map initialization
  ├── controls.ts           # UI controls (clipboard, centering, tracking toggles)
  ├── geocoding.ts          # Address search + reverse geocoding
  ├── location.ts           # GPS locationfound event handler
  ├── timer.ts              # GPS polling loop (scheduleUpdateCallback)
  └── style.css             # App styles
```

## Architecture Pattern

**Single AppState object** (`types.ts`) threaded by reference through all modules — no event bus or state management library. Modules mutate state directly.

**GPS polling uses a refcount** (`updateCallback: number`) so centering and tracking can independently request/release the polling loop without stepping on each other (0 = stopped, 1 = centering only, 2 = centering + tracking).

## Notes

- `esri-leaflet-geocoder.d.ts` is a local type stub — the package lacks complete TypeScript types
- No automated tests — verify changes with `npm run type-check && npm run lint` and manual browser testing
