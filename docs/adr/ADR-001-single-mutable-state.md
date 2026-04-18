# ADR-001: Single Mutable State

**Status:** Accepted

## Context

webmap.dev is a single-page GPS tracking application with multiple independent features:
- Real-time location tracking with three-state button (off → active → passive)
- Recording trails with pause/resume and statistics
- Offline tile caching and management
- Battery and network optimizations

Managing state across these features requires a pattern that allows modules to coordinate without tight coupling. Two common approaches are:
1. **Event-bus or pub/sub** — modules publish state changes, others subscribe to updates
2. **Redux or centralized store** — all state flows through a single reducer with dispatched actions

## Decision

Use a **single mutable `AppState` object** that is created once in `main.ts` and passed by reference to all modules. Modules mutate the state object directly.

### Implementation

```typescript
// types.ts
export interface AppState {
  youAreHereLocation: L.LatLng | null;
  locateState: LocateState;
  updateCallback: number; // refcount for GPS polling
  recordingState: RecordingState;
  // ... 40+ properties tracking GPS, trails, battery, offline progress
}

// main.ts
const state = createInitialState();
initMap(state, map);
addLocateControl(state, map);
addRecordingControl(state, map);
// all modules receive state by reference and mutate directly
```

## Alternatives Considered

1. **Event-bus / Pub-Sub Pattern**
   - Modules would dispatch events (e.g., `userStartedRecording`) and listen for state updates
   - Pros: Decoupled modules, clear event flow
   - Cons: Adds indirection and listener management; GPS updates fire every 1–2 seconds and would flood the event bus

2. **Redux with Centralized Reducer**
   - All state changes go through a single `reducer(state, action)` function
   - Pros: Auditable action history, time-travel debugging, typed action dispatching
   - Cons: Boilerplate (action types, action creators), overkill for a single-page app with synchronous mutations, unnecessary TypeScript ceremony

3. **Component-Local State (React-style)**
   - Each module manages its own state and passes callbacks up
   - Pros: Encapsulation per feature
   - Cons: GPS position is needed by *all* modules; leads to prop-drilling or a global fallback anyway

## Consequences

### Advantages
- **Simplicity:** Direct mutation is straightforward; no middleware, reducers, or async complexity needed
- **Performance:** Synchronous updates; no event-loop delays
- **Transparency:** Reading code shows exactly what state changes happen and when
- **Single source of truth:** All modules read from and write to one object; no sync bugs between state copies

### Disadvantages
- **Scalability risk:** As the app grows, the single state object becomes a monolith; difficult to split responsibilities
- **Mutation safety:** No guard against accidental mutations in unexpected places; relies on developer discipline
- **Debugging:** Without an audit trail of mutations, understanding *how* state reached its current value requires tracing through many modules
- **Refactor brittleness:** Moving or renaming a state property requires grep-and-replace across all modules

### Mitigation
- Keep the state object focused on the features the app currently supports (GPS tracking, recording, offline)
- Document each state property's ownership module in comments
- Use TypeScript strict mode and `noUncheckedIndexedAccess` to catch typos and undefined accesses
- Future refactor: If the app grows substantially (e.g., user accounts, cloud sync), consider migrating to Redux or a store library at that time

## Related Decisions
- [ADR-002: Refcount-based GPS Polling](ADR-002-refcount-gps-polling.md) — GPS watch refcount leverages the mutable AppState pattern
