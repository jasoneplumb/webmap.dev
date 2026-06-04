# Security Policy

## Supported Versions

| Version | Status | Support Ends |
|---------|--------|--------------|
| 0.20.x-beta | ✅ Supported | Current |
| < 0.20.x | ❌ Unsupported | N/A |

## Data Architecture

webmap.dev stores sensitive location and navigation data entirely on the client. **No server-side storage exists.**

### Where Data Lives

| Data | Storage | Scope | Lifetime |
|------|---------|-------|----------|
| GPS position, accuracy, altitude | Memory (AppState) | Current session | Cleared on page reload |
| Trail points (recording) | Memory (AppState) + localStorage backup | Current session | Restored from backup on crash; cleared on export or manual delete |
| Search results, reverse geocode results | Memory (DOM) | Current session | Cleared on page reload |
| Map tiles | Cache API (service worker) | Offline support | Expires per workbox rules (~7 days) |
| Consent state | localStorage | Persistent | User can manually clear via browser settings |
| Map layer preference | localStorage | Persistent | User can manually clear via browser settings |

### Browser APIs Used

- **Geolocation API**: GPS access (requires explicit user permission)
- **Cache API**: Offline tile caching via service worker
- **localStorage**: Consent state, layer preferences, trail backup on crash
- **Battery Status API**: Battery drain estimation (optional, graceful fallback if unavailable)

## Threat Model

### 1. GPS Data Exposure

**Threat**: Unauthorized access to precise location history recorded in a trail.

**Mitigations**:
- Trail data only exists in-memory during the current session
- localStorage backup only created during an active recording (not while idle)
- No automatic cloud sync or server transmission
- User explicitly exports/downloads trail data as GPX; no automatic upload
- Backup deleted from localStorage after restore or manual trail delete

**Residual Risk**: User device compromise or stolen browser storage affects only the most recent recording (from the current session or last backup).

### 2. Cross-Site Scripting (XSS)

**Threat**: Malicious script injected into search results, reverse geocode results, or address labels, executing in the app context.

**Mitigations**:
- User input from ESRI APIs is escaped before DOM insertion (see `escapeHtml()` in `geocoding.ts`)
- Numbered markers use `textContent` (not `innerHTML`) for numeric labels
- Changelog markdown is manually parsed with HTML entity escaping (see `renderChangelog()` in `main.ts`)
- Content Security Policy (CSP) not yet in place (see recommendations)
- TypeScript strict mode enabled

**Residual Risk**: ESRI API response compromise could inject escaped HTML entities; manual markdown parsing could accept unsafe patterns. No sandbox isolation for third-party map tiles.

### 3. Third-Party Leakage

**Threat**: User location or search queries leaked to third-party services.

**Mitigations**:
- ESRI geocoding API calls require an explicit `VITE_ESRI_API_KEY` (from arcgis.com)
- API key source (`.env`) is not committed to git
- **Note**: Vite embeds all `VITE_*` variables in the client bundle at build time — the API key is visible in compiled JS output and browser DevTools. Restrict key usage via ESRI's API key scope and domain allowlist settings.
- Map tiles from OpenStreetMap (no key) and Thunderforest (Cycle/Outdoors bases, optional `VITE_THUNDERFOREST_TOKEN`)
- No analytics, telemetry, or tracking enabled by default
- Reverse geocoding and search are opt-in user actions (not automatic)

**Residual Risk**: ESRI API key is embedded in the client bundle and visible to anyone inspecting the compiled JS. Mitigate by restricting the key to specific domains and API scopes in the ESRI dashboard. API logs on ESRI's side contain user search queries.

### 4. localStorage Tampering

**Threat**: Attacker modifies trail backup, consent state, or layer preferences in localStorage.

**Mitigations**:
- Trail backup JSON is validated before deserialization (type checking)
- Consent state is a simple boolean (minimal surface area)
- Layer preferences are validated against a whitelist of known layer IDs
- No cryptographic signing of localStorage data

**Residual Risk**: Attacker with device access can modify localStorage directly. Trail data could be corrupted or reconstructed. No integrity verification in place.

### 5. Service Worker Cache Poisoning

**Threat**: Attacker poisons the cache with malicious tile data, breaking offline maps.

**Mitigations**:
- Cache entries are versioned (workbox cache name includes version)
- Tile URLs are from trusted sources (OpenStreetMap, Thunderforest, Esri)
- Cache URLs use HTTPS
- User must explicitly trigger offline pre-download

**Residual Risk**: Attacker on the same network could intercept HTTP tiles if not over HTTPS. Cache strategy cannot distinguish genuine vs. poisoned tiles.

## Vulnerability Reporting

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, use [GitHub's private vulnerability reporting](https://github.com/jasoneplumb/webmap.dev/security/advisories/new) to submit a detailed report.

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if applicable)

Expected response time: 48 hours

## Scope

This policy covers vulnerabilities in:
- **webmap.dev client code** (src/, build config)
- **Dependencies** (reported to us; coordinate with upstream)
- **Infrastructure** (nginx config, CSP headers, HSTS)

Out of scope:
- ESRI ArcGIS API security (report to ESRI directly)
- Leaflet/esri-leaflet security (report to respective projects)
- Browser Geolocation API security (report to browser vendor)
- User device security (endpoint protection, OS updates)

## Recommendations for Users

### Securing Your Installation

1. **Keep Node.js updated**: Run `node --version` regularly and upgrade
2. **Use `.env.local` for secrets**: Never commit `VITE_ESRI_API_KEY` or `VITE_THUNDERFOREST_TOKEN`
3. **Enable HTTPS**: Deploy webmap.dev behind TLS; do not serve over HTTP
4. **Clear browser data**: Periodically clear localStorage and service worker cache
5. **Review GPS permissions**: On mobile, review app location permissions in OS settings

### Deploying Safely

- Set HSTS header: `Strict-Transport-Security: max-age=31536000`
- Enable CSP: `Content-Security-Policy: default-src 'self'` (see TODO in recommendations)
- Serve with cache-busting: Use asset hashing (Vite default) to invalidate old service workers
- Monitor ESRI API usage for abnormal activity

## Known Limitations

- **No offline reverse geocoding**: Reverse geocode silently fails without internet (no local fallback)
- **No end-to-end encryption**: Trail data in localStorage is plaintext
- **No user authentication**: No way to encrypt data per-user or restrict trail access
- **No integrity verification**: localStorage data cannot be cryptographically verified
- **No rate limiting**: ESRI API calls not rate-limited client-side (server-side quota applies)
- **No Content Security Policy yet**: See recommendations below

## Future Security Improvements

1. **Content Security Policy (CSP)**: Add CSP headers to prevent inline script injection
2. **Subresource Integrity (SRI)**: Hash Leaflet/esri-leaflet CDN links (if switching to CDN)
3. **localStorage Encryption**: Encrypt trail backup with a user-derived key (requires password/PIN)
4. **Service Worker Signatures**: Cryptographically sign service worker updates
5. **Audit Logging**: Log API calls and trail exports to detect misuse
6. **Geofencing**: Warn user if GPS drift exceeds expected bounds (e.g., teleportation)

## Version History

- **0.20.8-beta** (current): Initial security policy
