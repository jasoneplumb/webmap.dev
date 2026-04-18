# ADR-004: Local-Only Data

**Status:** Accepted

## Context

webmap.dev is a GPS tracking and mapping application. Users create trails, record statistics, and manage offline tile caches. Several options exist for persisting user data:

1. **Local browser storage only** — All data stays in the device's browser cache, IndexedDB, or localStorage
2. **Server-backed storage** — Trails, statistics, and user preferences sync to a backend server
3. **Hybrid** — Local-first with optional cloud sync for backups or cross-device access

A backend introduces significant complexity:
- Authentication and authorization
- Data encryption in transit and at rest
- Server scaling and cost
- GDPR/privacy regulations (data retention, deletion, export)
- Cross-device account management

## Decision

**All data stays in the browser.** webmap.dev does not have a backend server or user accounts. Trails, statistics, offline tiles, and preferences are stored exclusively in the browser using:
- `AppState` object (in-memory during the session)
- `localStorage` or `IndexedDB` (persistent across sessions)
- Service Worker cache via the Cache API (offline tile storage)

Users are responsible for their own data backup and sharing.

## Alternatives Considered

1. **Cloud-Backed Storage (Firestore, Supabase, or custom API)**
   - Users log in and trails sync to a server database
   - Pros: Automatic backup, cross-device sync, undo/history, optional sharing
   - Cons: Requires authentication, backend infrastructure, privacy policy, data retention policy, user account management; increases attack surface; incompatible with offline-first design

2. **Optional Cloud Sync (Local-first with opt-in upload)**
   - Data stored locally by default; users can choose to export or upload trails
   - Pros: Empowers privacy-conscious users; no mandatory backend
   - Cons: Partial feature set; manual export workflow is cumbersome; cross-device access impossible

3. **Hybrid with local analytics**
   - Store raw trail data locally; send anonymized statistics to a backend for app insights
   - Pros: No user data exposed; helps improve the app with usage metrics
   - Cons: Still requires backend infrastructure; privacy concerns even with anonymization

## Consequences

### Advantages
- **Privacy by default:** No data leaves the device; no terms of service or privacy policy needed for data handling
- **Offline-first:** App is fully functional without a network connection; no dependency on server uptime
- **Simplicity:** No authentication, authorization, or account management to build or maintain
- **User autonomy:** Users own their data; no risk of account lockout or service termination
- **Low cost:** No server infrastructure to host, scale, or monitor
- **Compliance:** No GDPR data retention or deletion obligations

### Disadvantages
- **No backup:** If the user clears browser data or reinstalls the app, all trails are lost
- **No cross-device sync:** Trails recorded on one device don't appear on another
- **No sharing:** Users cannot easily share trails with others without manual export
- **Limited social features:** No leaderboards, group activities, or community features possible
- **No analytics:** App developers have no insight into how users interact with the app

### Mitigation
- Provide clear UI guidance on exporting trails as JSON or GPX files
- Implement periodic local backup reminders (e.g., "Export your trails monthly")
- Use browser APIs (Service Workers, PWA manifest) to make data as persistent as possible (request persistent storage permission)
- Document the local-only design prominently so users understand their data is their responsibility

## Future Considerations

If webmap.dev grows to require cross-device sync or user accounts, this decision can be revisited. A migration path could involve:
1. Keeping local data as the source of truth
2. Adding optional cloud sync as an opt-in feature
3. Using a privacy-respecting backend (e.g., user-owned server, encrypted cloud storage)

## Related Decisions
- [ADR-005: Two-Tier Offline Tile Strategy](ADR-005-offline-tile-strategy.md) — Offline data uses browser Cache API and Service Worker, consistent with local-only design
