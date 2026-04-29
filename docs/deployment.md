# Deployment Guide

## GitHub Actions CI/CD Pipeline

Three workflows live in `.github/workflows/`:

- `ci.yml` — runs the test suite on every push and PR
- `claude-code-review.yml` — automated PR review when the `review-requested` label is added
- `deploy.yml` — production deploy on push to `mainline`

### CI Workflow (`ci.yml`)

Runs on every push and pull request. Validates that the test suite passes.

**Steps:**

1. `actions/checkout@v4`
2. `actions/setup-node@v4` with Node.js 22 (npm cache enabled)
3. `npm ci`
4. `npm test` — the full vitest suite

**Concurrency.** `group: ci-${{ github.ref }}` with `cancel-in-progress: true` — pushes to the same ref cancel the previous run.

**Failure cases.** Any vitest failure fails the build. Type-check, lint, and `npm run build` are **not** run in CI; they are local-only quality gates that contributors run before pushing (see `development.md`).

**PR checks.** All PRs must pass CI before merging. Merge conflicts block CI — rebase onto `mainline`, push, then re-run.

### Claude Code Review Workflow (`claude-code-review.yml`)

Runs when:

- A PR is opened with the `review-requested` label
- A PR with the `review-requested` label is force-pushed (`synchronize`) — rebased branches re-review without manual label cycling
- Manually dispatched via `workflow_dispatch`

PRs that modify the `claude-code-review.yml` file itself fail with a 401 "Workflow validation failed" — this is intentional security behavior in the upstream action. Add the `no-review` label and merge those PRs directly.

### Deploy Workflow (`deploy.yml`)

Runs on every successful push to `mainline`.

**Trigger conditions:**

- Push to `mainline` (automatic)
- Manual dispatch from the Actions tab

**Concurrency.** `group: deploy-production` with `cancel-in-progress: false` — only one deploy at a time; subsequent pushes queue rather than cancel.

**Environment.** `environment: production` — the GitHub Actions runner pulls secrets from the production environment.

**Deploy steps:**

1. Checkout
2. Setup Node.js 22 + npm cache
3. `npm ci`
4. Build the production bundle
5. Push `dist/` to the production server
6. nginx serves the new code on the next request (no reload required because all paths are `try_files` against `dist/`)

**Server.** `www.webmap.dev` — nginx reverse proxy serving from `/var/www/webmap/web/dist/`.

## Environment Variables (Production)

Production deploys need:

**Required:**

```
VITE_ESRI_API_KEY=AAPKd...     # ESRI ArcGIS API key for forward + reverse geocoding
```

These are configured on the GitHub Actions runner: **Settings → Environments → production → Secrets and variables**.

The four base maps (CyclOSM, OSM Streets, OpenTopo, Humanitarian) and the Esri hillshade overlay are served from free, public endpoints with no token required. The FOSSGIS Valhalla routing endpoint also requires no key.

## nginx Configuration Highlights

The full canonical config lives in `infrastructure/nginx/www.webmap.dev.conf`. Key patterns:

### Routing & SPA Fallback

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

Serves any URI matching a file from `dist/`; everything else falls back to `index.html` so client-side routing works.

### HSTS

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

Browsers cache for 1 year — all future visits are HTTPS-only even if the user types `http://` or follows an old HTTP link.

### Asset Caching (Hashed = Immutable)

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}
```

Vite appends a content hash to every asset filename. Code changes produce new filenames, so the immutable promise is safe.

### HTML Never Cached

```nginx
location ~* \.html$ {
  expires -1;
  add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

`index.html` changes on every deploy and pulls in the latest hashed assets.

### Gzip Compression

```nginx
gzip on;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;
gzip_min_length 1024;
```

~70% size reduction on JS/CSS/JSON without measurable CPU cost on modern hardware.

### TLS / SSL

```nginx
listen 443 ssl http2;
ssl_certificate /etc/letsencrypt/live/www.webmap.dev/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/www.webmap.dev/privkey.pem;
```

Let's Encrypt certs auto-renew via certbot. TLS 1.2+ negotiated; HTTP/2 enabled.

### Security Headers

```nginx
add_header X-Frame-Options SAMEORIGIN always;
add_header X-Content-Type-Options nosniff always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

### Domain Routing

```nginx
# Apex → www
server {
  server_name webmap.dev;
  return 301 https://www.webmap.dev$request_uri;
}

server {
  server_name www.webmap.dev;
  # ... app config ...
}
```

### Hidden Files Locked Down

```nginx
location ~ /\. {
  deny all;
  access_log off;
  log_not_found off;
}
```

No `.env`, no `.git`, no `.well-known` (except the certbot exemption configured separately for renewals).

## PWA Configuration

Defined in `vite.config.ts` via `vite-plugin-pwa`.

### Manifest

```typescript
manifest: {
  name: 'webmap.dev',
  short_name: 'webmap',
  description: 'GPS mapping and trail recording with offline support',
  theme_color: '#4CAF50',
  background_color: '#ffffff',
  display: 'standalone',
  scope: '/',
  start_url: '/',
  icons: [
    { src: '/logo-192.png',           sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/logo-512.png',           sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/logo-maskable-192.png',  sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/logo-maskable-512.png',  sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}
```

Maskable icons (purpose `'maskable'`) ensure Android 13+ adaptive shapes (rounded / squircle / teardrop) render the logo with proper safe-zone padding rather than corner-cropping. Regenerate with `npm run icons`.

### Service Worker & Caching

```typescript
workbox: {
  clientsClaim: true,
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: OSM_TILE_CACHE_NAME,
        expiration: {
          maxEntries: 500,
          maxAgeSeconds: 30 * 24 * 60 * 60,  // 30 days
        },
      },
    },
    {
      urlPattern: /^https:\/\/geocode\.arcgis\.com\/.*/,
      handler: 'NetworkOnly',
    },
  ],
  navigateFallback: null,
}
```

- **OSM tiles** — `StaleWhileRevalidate`. Serve cached immediately, refetch in background. 500-entry cap, 30-day expiration.
- **ESRI geocode** — `NetworkOnly`. There's no useful offline behavior for a search query; failures surface to the UI as empty result sets.
- **clientsClaim: true** — once a new SW activates after `skipWaiting()`, it claims open clients immediately so Workbox-window's `controlling` event fires and `location.reload()` happens automatically. Without it, users see a stale page until manual refresh.

The other base maps (CyclOSM, OpenTopo, Humanitarian) and the Esri hillshade overlay are **not** runtime-cached — only the OSM Streets layer benefits from passive caching plus the proactive Cache API pre-download. See [ADR-005](adr/ADR-005-offline-tile-strategy.md).

## Deployment Checklist

Before pushing to `mainline` (which auto-deploys):

- [ ] Local quality gate passes: `npm run type-check && npm run lint && npm test && npm run build`
- [ ] Bundle size within budget: `npm run size` (≤ 100 kB gzipped)
- [ ] Manual browser testing covered the changed feature
- [ ] Mobile checks (DevTools device emulation, ideally also a real phone)
- [ ] Offline behavior verified (DevTools → Network → "Offline")
- [ ] PR has at least one approval and CI is green
- [ ] If you bumped `CONSENT_VERSION`, the new third-party service is disclosed in `consent.ts`
- [ ] If you changed routing or geocoding endpoints, [ADR-006](adr/ADR-006-routed-guidance.md) and the consent text reflect it

## Monitoring Production

### Logs

Access nginx logs on the server:

- **Access:** `/var/log/nginx/www.webmap.dev.access.log`
- **Error:** `/var/log/nginx/www.webmap.dev.error.log`

Check for 5xx, slow requests, missing assets.

### Uptime

No dedicated monitoring is wired up. Manual smoke check:

1. Visit `https://www.webmap.dev`.
2. Verify the consent modal appears (after clearing localStorage).
3. Accept; verify the map loads tiles, the locate button can be enabled (allow GPS in the browser), search returns results, and "Navigate here" starts a route.

### Performance

- **nginx** — static-file serving with minimal overhead.
- **Bundle** — minified, tree-shaken; ≤ 100 kB JS gzipped (enforced by `npm run size`).
- **Tiles** — cached by Workbox SWR; subsequent views are instant.
- **API calls** — ESRI geocoding ~100–500 ms; FOSSGIS Valhalla typically 200–800 ms (no SLA).

## Rollback

If a deploy ships a critical bug:

1. Identify the bad commit: `git log mainline`.
2. Revert: `git revert <commit-hash>`.
3. Push: `git push origin mainline`.
4. The deploy workflow auto-redeploys the reverted code. No SSH needed.

## Common Deployment Issues

### Search not working

ESRI API key missing or invalid.

1. Verify `VITE_ESRI_API_KEY` is set in **Settings → Environments → production → Secrets**.
2. Trigger a redeploy (`git commit --allow-empty -m "redeploy" && git push`).
3. DevTools console will log "VITE_ESRI_API_KEY is not configured" on the live site if the key didn't reach the build.

### Tiles not loading after deploy

Tile origin returned an error or CORS-blocked.

1. DevTools → Network → filter "tile".
2. Look for 4xx / 5xx responses.
3. Check nginx error log if requests are reaching the server.
4. Possible upstream causes: OpenStreetMap rate-limit (temporary; recovers); CyclOSM, OpenTopo, or Humanitarian transient outage; Esri hillshade quota.

### Routing not working

FOSSGIS Valhalla failed.

- DevTools console shows `Routing failed: HTTP <status>`.
- The public Valhalla service has no SLA — retry usually works.
- For a hard outage, the only fix is swapping the provider in `src/routing.ts` (the URL is centralized as `VALHALLA_URL` for exactly this case).

### App stuck in offline mode

Service worker cached a broken version.

**User fix:** DevTools → Application → Service Workers → Unregister, then reload.

**Developer:** ensure `skipWaiting: true` and `clientsClaim: true` are still in `vite.config.ts`. The default registration mode is `prompt` — confirm `registerSW({ onNeedRefresh })` in `main.ts` calls `updateSW(true)` after a `requestAnimationFrame`.

## Backup & Recovery

No explicit backups. The repository on GitHub is the source of truth:

1. All code is in git — `git push origin mainline` can fully redeploy.
2. The PWA tile cache is per-device; users re-fetch tiles after cache loss.
3. No user data (consent record + install ID + collapsed-label flags only) is stored server-side; nothing to back up beyond the code.
