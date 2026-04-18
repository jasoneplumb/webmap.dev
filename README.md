# webmap.dev

[![CI](https://github.com/jasoneplumb/webmap.dev/actions/workflows/ci.yml/badge.svg)](https://github.com/jasoneplumb/webmap.dev/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![TypeScript](https://img.shields.io/badge/TypeScript-ES2020-blue)

> A mobile-first Progressive Web App for GPS trail recording and map exploration.

## Features

- **Live GPS Tracking** — Blue dot with accuracy circle; three-state locate button (off/active/passive) with consistent outline icon shape
- **Trail Recording** — Record your journey with real-time distance, elapsed time, speed, and battery estimate
- **GPX Export** — Save tracks as GPX files compatible with all mapping software
- **Address Search** — Find places using ESRI ArcGIS geocoding with autocomplete and numbered result markers
- **Reverse Geocoding** — Double-click or long-press to drop a pin and look up the address
- **Layer Switching** — Custom layers popover for base maps (OSM, Mapbox, Google) and overlays (hillshade)
- **Offline Support** — Tiles cached via service worker; proactive region pre-download for offline use
- **Trail Backup** — Automatic crash recovery via localStorage backup of in-progress recordings
- **Consent Dialog** — First-run privacy policy and terms with sticky header/footer layout
- **Changelog** — Tap the version badge (upper right) to view the full release history inline
- **Adaptive Controls** — Locate, Layers, and Download buttons collapse to icon-only after first use

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Build** | Vite 5 + TypeScript ES2020 |
| **Map** | Leaflet 1.9 + esri-leaflet 3 + esri-leaflet-geocoder 3 |
| **Tiles** | Mapbox (primary), OpenStreetMap (fallback), Google Imagery |
| **Geocoding** | ESRI ArcGIS API |
| **Offline** | Workbox 7 (service worker + caching) |
| **PWA** | vite-plugin-pwa (manifest, install prompts) |
| **Server** | nginx (HSTS, SPA fallback, asset caching) |
| **CI/CD** | GitHub Actions (type-check → lint → build → deploy) |

## Getting Started

### Prerequisites

- **Node.js** 18 or later
- **Mapbox token** (optional — falls back to OpenStreetMap tiles)
- **ESRI API key** (required for address search feature)

### Installation

```bash
git clone https://github.com/jasoneplumb/webmap.dev.git
cd webmap.dev
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```
VITE_MAPBOX_TOKEN=pk.eyJ...    # Optional: get from mapbox.com/account/tokens
VITE_ESRI_API_KEY=AAPKd...     # Required: get from arcgis.com/sharing/rest
```

### Development

```bash
npm run dev          # Dev server at http://localhost:5173
npm run build        # Production build → dist/
npm run preview      # Preview production build
npm run type-check   # TypeScript validation
npm run lint         # ESLint
npm test             # Run unit tests
```

## Architecture

webmap.dev uses a **single shared AppState object** threaded through all modules. No event bus, no Redux, no complex state management — just a mutable state object passed by reference. This keeps the codebase small and eliminates indirection while still being Type-Safe via TypeScript's strict mode.

See **[docs/architecture.md](docs/architecture.md)** for a deep-dive on:

1. Single Shared State (types.ts)
2. GPS Polling Refcount (timer.ts + main.ts)
3. Three-State Locate Button
4. Haversine Jitter Filter
5. Recording State Machine
6. Bottom Sheet / Side Panel (iOS Safari compatible)
7. Consent Modal (sticky header/footer)
8. Layers Control (custom popover)
9. Offline Tile Download (region pre-caching)
10. Adaptive Control Labels
11. PWA / Offline Strategy
12. nginx Infrastructure

## Project Structure

```
src/
  main.ts              # Entry point — wires modules, implements polling refcount
  types.ts             # AppState interface, shared mutable state
  map.ts               # Leaflet initialization, tile layers, zoom controls
  controls.ts          # Toggle button factory, locate/tracking controls, label collapse
  geocoding.ts         # Address search + reverse geocode (ESRI)
  location.ts          # GPS handlers, haversine filter, blue dot
  timer.ts             # GPS polling loop (500 ms intervals)
  recording.ts         # Trail state machine, GPX export, stats bar
  bottom-sheet.ts      # Mobile sheet (drag, snap points) + desktop side panel
  layers-control.ts    # Custom layers popover (base maps + overlays)
  offline-download.ts  # Region pre-download for offline tile caching
  consent.ts           # First-run consent modal (privacy + terms)
  battery.ts           # Battery drain estimation during recording
  trail-backup.ts      # Crash recovery backup for in-progress trails
  sw-constants.ts      # Service worker cache name constants
  style.css            # App styles (responsive, animations, PWA UI)

infrastructure/
  nginx/
    www.webmap.dev.conf  # Reverse proxy, HSTS, SPA fallback, asset caching

vite.config.ts      # Build config, PWA manifest, offline caching rules
package.json        # Dependencies, scripts, version
CLAUDE.md           # Project conventions (code patterns, architecture notes)
```

## Contributing

1. **Fork the repo** and create a feature branch
2. **Code changes**: Update relevant files in `src/`
3. **Quality gate**:
   ```bash
   npm run type-check && npm run lint && npm test
   ```
4. **Commit & push** to your fork
5. **Create a PR** with a clear description of your changes

## License

See `LICENSE` file in the repository.
