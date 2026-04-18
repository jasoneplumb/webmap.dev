# ADR-002: Refcount-based GPS Polling

**Status:** Accepted

## Context

Two independent features request GPS location updates:
1. **Locate button** — User taps to center the map on their current location
2. **Recording** — User records a trail and needs continuous GPS updates for statistics (distance, ascent, speed)

Both features call `map.locate({ watch: true })` to start polling the device's GPS. A naive approach would have each feature independently start and stop the watch, creating a race condition:
- Locate starts → Recording starts (both watching)
- Recording stops → Watch stops entirely → Locate breaks

## Decision

Use an **integer refcount** (`updateCallback: number` in `AppState`) to coordinate GPS polling:
- `0` = watch is stopped
- `1` = only one consumer (e.g., locate or recording)
- `2` = both consumers are active

Each feature increments the refcount when it starts needing location updates and decrements when it stops. Only when the refcount transitions 0↔1 does the map actually start or stop the watch.

### Implementation

```typescript
// timer.ts
export function startWatching(map: L.Map): void {
  map.locate({ watch: true, setView: false, enableHighAccuracy: true });
}

export function stopWatching(map: L.Map): void {
  map.stopLocate();
}

// main.ts — refcount logic
if (state.updateCallback === 0) {
  startWatching(map); // transition 0→1: start the watch
}
state.updateCallback++;

// Later, when a consumer stops:
state.updateCallback--;
if (state.updateCallback === 0) {
  stopWatching(map); // transition 1→0: stop the watch
}
```

## Alternatives Considered

1. **Pub/Sub Event Bus**
   - Each feature publishes `RequestGPSUpdates` and `ReleaseGPSUpdates` events
   - A GPS manager listens and refcounts internally
   - Pros: Decoupled; clear separation of concerns
   - Cons: Adds a middle layer; indirection for a simple counter operation

2. **Boolean Flags (Multiple States)**
   - Store `isLocatingActive` and `isRecordingActive` separately
   - Start watch if either is true, stop if both are false
   - Pros: Simple to understand
   - Cons: Requires if-statement logic every time either flag changes; brittle if a third feature needs GPS later

3. **Single Boolean, One Owner**
   - Only one feature (e.g., recording) is allowed to control the watch
   - Other features rely on that owner (locate would wait for recording, or fail if recording is off)
   - Pros: Simple logic
   - Cons: Inflexible; violates feature independence

## Consequences

### Advantages
- **Feature independence:** Locate and recording can start/stop GPS independently without knowing about each other
- **Efficiency:** GPS watch runs only when needed; no redundant polling if both features are active
- **Simplicity:** Refcount logic is a few lines of code; no middleware or event listeners needed
- **Resilience:** Works for any number of consumers; adding a third feature that needs GPS requires only a new increment/decrement pair

### Disadvantages
- **Silent failures:** If any consumer forgets to decrement (e.g., due to an error path), the refcount stays > 0 and the watch never stops, draining battery indefinitely
- **Refcount fragility:** Easy to introduce off-by-one bugs; requires careful testing and synchronization
- **No visibility:** No built-in logging of who requested GPS and when; debugging refcount leaks requires tracing through code

### Mitigation
- Wrap increment/decrement in utility functions with clear names (`requestGPSWatch()`, `releaseGPSWatch()`) to reduce typos
- Add TypeScript compile-time checks to ensure increment is paired with a corresponding decrement in try/finally blocks
- Consider adding a debug mode that logs refcount changes and stack traces to identify leaks during development

## Related Decisions
- [ADR-001: Single Mutable State](ADR-001-single-mutable-state.md) — Refcount is stored in the mutable AppState object
