# Deployment Guide

## GitHub Actions CI/CD Pipeline

The project uses two GitHub Actions workflows to automate testing and deployment.

### CI Workflow (`ci.yml`)

Runs on every push and pull request. Validates code quality before merging.

**Steps:**
1. **Type-check**: `npm run type-check` (TypeScript compiler)
2. **Lint**: `npm run lint` (ESLint)
3. **Build**: `npm run build` (Vite production bundle)
4. **Verify dist**: Check that `dist/index.html` contains `type="module"`

**Failure cases:**
- Any TypeScript type error fails the build
- ESLint violations fail the build
- Failed build step fails the build
- Missing `type="module"` in index.html fails the build

**PR checks:**
- All PRs must pass CI before merging
- Merge conflicts block CI (rebase onto mainline, then re-run checks)

### Deploy Workflow (`deploy.yml`)

Runs after every successful push to `mainline` branch. Deploys to production.

**Trigger conditions:**
- Push to `mainline` branch (automatic)
- Manual dispatch from Actions tab
- Concurrency: only one deployment at a time (queue other requests)

**Deploy steps:**
1. Build the production bundle
2. Push the `dist/` directory to the production server
3. nginx reloads with new code
4. App is live

**Deployment details:**
- **Server**: `www.webmap.dev` (nginx reverse proxy)
- **Directory**: `/var/www/webmap/web/`
- **Trigger**: Push to `mainline` branch
- **Status**: Check on GitHub Actions tab

## Environment Variables (Production)

Production deployments need these environment variables set:

**Required:**
```
VITE_ESRI_API_KEY=AAPKd...     # ESRI ArcGIS API key for address search
```

**Optional:**
```
VITE_MAPBOX_TOKEN=pk.eyJ...    # Mapbox token (falls back to OpenStreetMap if missing)
```

These are configured on the GitHub Actions runner (Settings → Secrets and variables → Actions).

## nginx Configuration Highlights

### Routing & SPA Fallback

```nginx
# Serve index.html for all non-file routes
# Allows the SPA to handle its own routing
location / {
  try_files $uri $uri/ /index.html;
}
```

### HSTS (HTTP Strict Transport Security)

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

Browsers cache this for 1 year. All future visits are HTTPS-only, even if the user types `http://` or follows an old HTTP link. This protects against man-in-the-middle attacks.

### Asset Caching (Immutable Content)

```nginx
# Hashed assets (e.g., main.a1b2c3d4.js)
# Vite appends content hash to filenames
# Safe to cache for 1 year
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}
```

**Why immutable?** Vite generates a unique filename for every code change (e.g., `main.js` → `main.a1b2c3d4.js` when code changes). The old filename is never reused. So it's safe to cache for 1 year — if code changes, the new version gets a new filename.

### HTML Never Cached

```nginx
# index.html changes on every deploy
# Browsers must always re-fetch to see updates
location ~* \.html$ {
  expires -1;
  add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

Users always get the latest `index.html` on the next visit, which pulls in the latest hashed assets.

### Gzip Compression

```nginx
gzip on;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;
gzip_min_length 1024;
```

Compresses JS, CSS, JSON payloads (~70% size reduction). Browsers automatically decompress. No manual action needed.

### TLS/SSL (HTTPS)

```nginx
listen 443 ssl http2;
ssl_certificate /etc/letsencrypt/live/www.webmap.dev/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/www.webmap.dev/privkey.pem;
```

- **Certificate**: Let's Encrypt (free, auto-renews)
- **Protocol**: TLS 1.2+ (negotiated; no legacy SSL 3.0)
- **HTTP/2**: Multiplexing for faster page loads

### Security Headers

```nginx
add_header X-Frame-Options SAMEORIGIN always;           # prevent clickjacking
add_header X-Content-Type-Options nosniff always;       # prevent MIME type sniffing
add_header X-XSS-Protection "1; mode=block" always;     # old XSS protection (legacy)
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

### Domain Routing

```nginx
# Apex domain (webmap.dev) redirects to www
server {
  server_name webmap.dev;
  location / {
    return 301 https://www.webmap.dev$request_uri;
  }
}

# www domain serves the app
server {
  server_name www.webmap.dev;
  # ... app config ...
}
```

### Hidden Files

```nginx
# Deny .env, .git, .well-known/acme-challenge (except for cert renewal)
location ~ /\. {
  deny all;
  access_log off;
  log_not_found off;
}
```

## PWA (Progressive Web App) Configuration

### Manifest

Located in `vite.config.ts`:

```typescript
manifest: {
  name: 'webmap.dev',
  short_name: 'webmap',
  description: 'GPS mapping and trail recording with offline support',
  display: 'standalone',        // hide browser UI
  start_url: '/',
  theme_color: '#4CAF50',
  icons: [
    { src: '/logo-color-v1.1.svg', sizes: '192x192', type: 'image/svg+xml' },
    { src: '/logo-color-v1.1.svg', sizes: '512x512', type: 'image/svg+xml' },
  ],
}
```

**Result:** When users visit on mobile, browsers show an "Add to Home Screen" prompt. Tapping it:
- Creates an app shortcut
- Opens without address bar (standalone mode)
- Uses the specified theme color
- Can be used offline

### Service Worker & Caching

Workbox manages offline caching (defined in `vite.config.ts`):

**Map tiles (SWR: Stale-While-Revalidate):**
- Serve cached tile immediately
- Fetch fresh tile in background
- On next visit, fresh tile appears
- Cached for 30 days

**App code (pre-cached by build):**
- JS, CSS, HTML bundled by Vite
- Cached on first visit
- Updated on every deployment

**ESRI Geocoding (NetworkOnly):**
- No caching; always requires internet
- Falls back to empty results if offline

## Deployment Checklist

Before pushing to `mainline` (which auto-deploys):

- [ ] **Quality gate passes**: `npm run type-check && npm run lint && npm run build`
- [ ] **Environment variables set**: ESRI API key and optional Mapbox token
- [ ] **Manual testing**: Verify features work in dev (`npm run dev`)
- [ ] **Offline testing**: Simulate offline mode in DevTools → Network
- [ ] **Mobile testing**: Test on an actual phone or DevTools device emulation
- [ ] **PR reviewed**: At least one approval before merging to mainline
- [ ] **CI passes**: GitHub Actions workflow succeeds

## Monitoring Production

### Logs

Access nginx logs on the production server:
- **Access log**: `/var/log/nginx/www.webmap.dev.access.log`
- **Error log**: `/var/log/nginx/www.webmap.dev.error.log`

Check for 500 errors, slow requests, or missing assets.

### Uptime

No dedicated monitoring tool is configured. Manual checks:
- Visit `https://www.webmap.dev` and verify it loads
- Test each feature (GPS, search, recording, offline)
- Check DevTools Network tab for errors

### Performance

- **nginx**: Serves static files with minimal overhead
- **Vite bundle**: Minified and tree-shaken; ~100 KB JS (gzipped)
- **Map tiles**: Cached by Workbox; subsequent views are instant
- **API calls**: ESRI geocoding (~100-500ms latency depending on query)

## Rollback

If a deployment has a critical bug:

1. **Identify the broken commit** (`git log mainline`)
2. **Revert on mainline**: `git revert <commit-hash>`
3. **Push**: `git push origin mainline`
4. **Automatic deploy**: GitHub Actions redeploys with the reverted code

No manual ssh into the server needed.

## Common Deployment Issues

### "index.html doesn't contain type=module"

**Cause:** Build step failed or produced incomplete bundle.

**Fix:**
```bash
npm run build
# Check dist/index.html — should have:
# <script type="module" src="/main.abc123.js"></script>
```

If the script tag is missing, the build failed. Check error logs.

### Tiles not loading after deploy

**Cause:** Tile URL misconfigured or CORS error.

**Check:**
1. DevTools → Network tab → filter by "tile"
2. Look for failed requests (red X)
3. Check nginx error log: `/var/log/nginx/www.webmap.dev.error.log`

**Common causes:**
- Mapbox token expired or wrong
- OpenStreetMap rate-limited (temporary; will recover)
- nginx gzip corrupting image files (unlikely; Workbox handles it)

### Search not working

**Cause:** ESRI API key missing or invalid.

**Check:**
1. Verify `VITE_ESRI_API_KEY` is set on the GitHub Actions runner (Settings → Secrets)
2. Rebuild and redeploy
3. Check DevTools Console for "VITE_ESRI_API_KEY is not configured" warning

### App stuck in offline mode

**Cause:** Service worker cached a broken version.

**User fix:**
1. Open DevTools → Application → Service Workers
2. Click "Unregister"
3. Reload the page
4. Service worker re-registers with fresh code

**Developer fix:** Ensure PWA config in `vite.config.ts` has `skipWaiting: true` (forces immediate activation of new version).

## Backup & Recovery

No explicit backup is configured. To recover from data loss:

1. **Repository is the source of truth**: All code is in git on GitHub
2. **Redeploy**: `git push origin mainline` triggers a full redeploy from source
3. **Service worker cache**: Users' cached tiles are lost but re-fetched on next use

No user data (trails, saved locations) is stored server-side, so there's nothing to back up beyond the code itself.
