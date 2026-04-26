# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for webmap.dev, documenting major design choices and their rationale.

## What is an ADR?

An ADR is a lightweight document that captures an important architectural decision made by a team, including the context of the decision, its consequences, and alternatives that were considered. ADRs serve as a historical record and aid onboarding by explaining *why* the system is designed the way it is.

## Format

Each ADR follows a consistent template:
- **Status** — Proposed, Accepted, Rejected, Deprecated, or Superseded
- **Context** — The issue or problem that motivated the decision
- **Decision** — The choice made
- **Alternatives Considered** — Other options evaluated
- **Consequences** — Trade-offs and impacts of the decision

## Index

1. [ADR-001: Single Mutable State](ADR-001-single-mutable-state.md) — Why AppState is a single mutable object instead of Redux or event-bus patterns
2. [ADR-002: Refcount-based GPS Polling](ADR-002-refcount-gps-polling.md) — Why GPS polling uses an integer refcount instead of pub/sub
3. [ADR-003: offsetHeight for iOS Safari Snap-Points](ADR-003-offsetheight-ios-safari.md) — Why bottom sheet snap-point math uses offsetHeight instead of CSS vh units
4. [ADR-004: Local-Only Data](ADR-004-local-only-data.md) — Why all data stays in the browser with no server-side storage
5. [ADR-005: Two-Tier Offline Tile Strategy](ADR-005-offline-tile-strategy.md) — Why offline uses Workbox passive caching plus Cache API pre-download
6. [ADR-006: Routed Turn-by-Turn Guidance](ADR-006-routed-guidance.md) — Why recording was replaced with Valhalla-powered guidance and a heading-cone wedge instead of map rotation

## References

- [Michael Nygard's ADR Template](https://github.com/adr/madr)
- [webmap.dev GitHub Repository](https://github.com/jasoneplumb/webmap.dev)
