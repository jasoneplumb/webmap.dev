# Deployment Guide

## GitHub Actions CI/CD Pipeline

Three workflows live in `.github/workflows/`:

- `ci.yml` — runs the test suite on every push and PR
- `claude-code-review.yml` — automated PR review when the `review-requested` label is added
- `deploy.yml` — production deploy on a version-tag (`v*`) push or manual release dispatch

### CI Workflow (`ci.yml`)

Runs on every push and pull request. Validates that the test suite passes.

**Steps:**

1. `actions/checkout@v4`
2. `actions/setup-node@v4` with Node.js 22 (npm cache enabled)
3. `npm ci`
4. `npm test` — the full vitest suite plus `scripts/test-deploy-webmap.sh` (deploy-script end-to-end tests)

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

Runs **only for releases** — never on plain pushes to `mainline`.

**Trigger conditions:**

- A version-tag (`v*`) push (automatic — deploys exactly that tag)
- Manual dispatch from the Actions tab or the `/deploy` skill (deploys the latest version tag)

**Concurrency.** `group: deploy-production` with `cancel-in-progress: false` — only one deploy at a time; subsequent triggers queue rather than cancel.

**Environment.** `environment: production` — the GitHub Actions runner pulls secrets from the production environment.

**Deploy steps:**

1. Checkout (full history + tags), then resolve and check out the release tag; the tag must match `package.json`'s version
2. Setup Node.js 22 + npm cache
3. `npm ci`
4. Full CI quality gate against the release tag's code: `npm test`, type-check, lint, build, build-output verification, bundle-size check — deploy proceeds only if every gate passes
5. Push `dist/` **and `infrastructure/nginx/www.webmap.dev.conf`** to the production server over SSH with **strict host-key checking** — the server's identity is verified against the pinned `DEPLOY_KNOWN_HOSTS` secret (no `ssh-keyscan` / trust-on-first-use at deploy time)
6. `scripts/deploy-webmap.sh` extracts the content, then applies the nginx config (see [Applying the nginx config](#applying-the-nginx-config)) and reloads nginx only if the config actually changed and passes `nginx -t`
7. A health check against the live vhost validates the new content *and* the new config together; failure rolls back both

**Server.** `www.webmap.dev` — nginx reverse proxy serving from `/var/www/webmap/web/dist/`.

## Applying the nginx config

The nginx config is **applied by the deploy**, not by hand. `infrastructure/nginx/www.webmap.dev.conf` is the single source of truth: a change to it takes effect on the next production deploy with no manual step.

This closes the drift that caused and prolonged the blank-page outage (#209 / #210) — the `/sw.js` immutable-cache bug could not be fixed by a repo change alone, because the host's nginx config had been edited by hand and no longer matched the repo.

### What the deploy does

`scripts/deploy-webmap.sh` runs on the host and, for the nginx step:

1. **Preflight** — runs `nginx -t` *before touching anything*. If the host's existing config is already invalid, the deploy aborts immediately and changes nothing. Reloading in that state would activate someone else's breakage.
2. **Short-circuit** — if the repo conf is byte-identical to `/etc/nginx/sites-available/www.webmap.dev.conf` and the `sites-enabled` symlink already points at it, nothing happens and **no reload is issued**. Deploys that don't touch nginx cause zero live-config churn.
3. **Backup** — copies the current conf to `/var/www/webmap/.backups/webmap-nginx-backup-<ts>.conf` (mode 0700, last 5 retained).
4. **Install** — `install -m 0644` into `sites-available`, then `ln -sfn` the `sites-enabled` symlink (idempotent).
5. **Validate** — `nginx -t`. **On failure the previous conf is restored and nginx is never reloaded**, so the running config is untouched.
6. **Reload** — `systemctl reload nginx` (reload, not restart — no dropped connections).
7. **Health check** — if the post-reload health check fails, both the conf *and* the content are rolled back and nginx is reloaded again with the previous conf.

If `NGINX_CONF_SRC` is unset the nginx step is skipped entirely and only content is deployed. If it is *set* but the file is missing, the deploy **fails** — that means the scp did not land, and silently skipping would be the drift this change exists to prevent.

### Blast radius

The VPS serves other sites from the same nginx instance, so `systemctl reload nginx` affects all of them. Two properties bound the risk:

- **A config that fails `nginx -t` is never activated.** Validation happens against the on-disk config *before* any reload, and the previous conf is restored on failure. nginx keeps serving its last-loaded config.
- **The reload is skipped entirely when the conf is unchanged**, so the common case (an app-only release) never touches the running nginx.

The residual risk is a config that passes `nginx -t` but is semantically wrong. That is caught by the health check, which rolls the conf back and reloads. A config that breaks a *different* vhost while leaving webmap healthy would not be caught — review `infrastructure/nginx/*.conf` changes with that in mind.

### Required host privileges

The deploy runs the privileged steps as root directly if the SSH user is root; otherwise it uses `sudo -n` (non-interactive, so a missing rule fails fast instead of hanging on a password prompt). For a non-root deploy user, grant a **tightly scoped** sudoers entry — never broad sudo:

```sudoers
# /etc/sudoers.d/webmap-deploy  (mode 0440, validate with `visudo -c -f <file>`)
Cmnd_Alias WEBMAP_NGINX = /usr/sbin/nginx -t, \
                          /usr/bin/systemctl reload nginx, \
                          /usr/bin/install -o root -g root -m 0644 /tmp/webmap-deploy-*/www.webmap.dev.conf /etc/nginx/sites-available/www.webmap.dev.conf, \
                          /usr/bin/install -o root -g root -m 0644 /var/www/webmap/.backups/webmap-nginx-backup-*.conf /etc/nginx/sites-available/www.webmap.dev.conf, \
                          /usr/bin/ln -sfn /etc/nginx/sites-available/www.webmap.dev.conf /etc/nginx/sites-enabled/www.webmap.dev.conf, \
                          /usr/bin/rm -f /etc/nginx/sites-enabled/www.webmap.dev.conf /etc/nginx/sites-available/www.webmap.dev.conf

Cmnd_Alias WEBMAP_CONTENT = /usr/bin/chown -R www-data\:www-data /var/www/webmap/web

deploy ALL=(root) NOPASSWD: WEBMAP_NGINX, WEBMAP_CONTENT
```

`chown` is in the list because the deploy hands the extracted tree to `www-data`, and changing ownership to a *different* user requires root — an unprivileged account cannot do it even for files it owns. Without this rule every deploy fails at that step, before nginx is reached.

Every rule pins its exact arguments, so the grant is "manage *this* vhost's conf and reload nginx" — not arbitrary file writes. Backing up the current conf needs no rule: it is mode 0644 in a world-traversable directory, so the deploy user reads it directly.

Adjust binary paths to the host (`command -v nginx systemctl install ln chown rm`). `NGINX_BIN` and `SYSTEMCTL_BIN` can be overridden via the environment if they live elsewhere.

Each rule pins an exact argument shape, so the sudoers file and `deploy-webmap.sh` must stay in step: changing an `install` flag, the backup filename pattern, or the staging path prefix makes sudo deny with a generic "not permitted" that points nowhere near this file. Every privileged call site in the script carries a comment saying so.

The deploy checks `sudo -n true` up front, so a missing or misconfigured sudoers file aborts **before any content is touched** with a pointer to this section — rather than failing half-way and rolling back.

### Staging and source integrity

The deploy script and the nginx conf are staged into a per-deploy directory created with `mkdir -m 700 /tmp/webmap-deploy-<32 hex chars>`, not a fixed `/tmp` path. `mkdir` without `-p` fails if the path already exists, so another local account cannot pre-create the directory, and the name is unguessable. The staging directory is removed after every deploy, success or failure.

The staging step deliberately does **not** use `ssh_retry`. That helper reruns the *identical* command, and a non-idempotent `mkdir` would then fail deterministically whenever the SSH connection blipped after the remote `mkdir` had already succeeded — aborting a healthy release. Instead each of the three attempts generates a fresh random suffix, so a retry always targets a new path. A blip can leave one empty `0700` directory behind; that is harmless, and it is not removed because the runner cannot know the `mkdir` landed.

The generated path is shape-checked against `^/tmp/webmap-deploy-[0-9a-f]{32}$` before use. `set -e` does not trip on a failed command substitution inside an assignment, so a missing or broken `openssl` would otherwise yield the predictable `/tmp/webmap-deploy-` and silently void the whole defense.

Before anything is installed as root-owned nginx config — the staged conf on the way in, and a backup conf on the rollback path — `assert_safe_source()` requires it to be a regular file (never a symlink) owned by the deploy user or root. This is the check that actually holds: a planted file never reaches `install`, and so never reaches an nginx instance shared with other vhosts.

Content and conf backups live in `/var/www/webmap/.backups` (mode 0700), not `/tmp`, for the same reason: a rollback reads from there and installs the result as root-owned config.

### One-time migration check

Before the first deploy that carries this change, confirm the live config matches the repo — the host was hand-edited during the #209 fix, and this deploy will **overwrite** the live conf with the repo's version:

```bash
ssh <deploy-user>@<host> 'cat /etc/nginx/sites-available/www.webmap.dev.conf' \
  | diff - infrastructure/nginx/www.webmap.dev.conf
```

Any hand-applied change not reflected in the repo must be committed to `infrastructure/nginx/www.webmap.dev.conf` first, or it will be lost.

### Testing the deploy script

`scripts/test-deploy-webmap.sh` runs the real `deploy-webmap.sh` against a throwaway prefix with stubbed privileged binaries, asserting the fail-closed behaviour (invalid config never activated, previous config restored, no reload when unchanged). It runs as part of `npm test`, or standalone. Note this makes `npm test` require `bash`; that is a given on the CI runner, macOS, and Linux, but Windows contributors need WSL or Git Bash. Run `npx vitest run` alone to skip it:

```bash
npm run test:deploy-script
```

## Environment Variables (Production)

Production deploys need:

**Required:**

```
VITE_ESRI_API_KEY=AAPKd...     # ESRI ArcGIS API key for forward + reverse geocoding
```

These are configured on the GitHub Actions runner: **Settings → Environments → production → Secrets and variables**.

The SSH deploy steps additionally use these repository Actions secrets (**Settings → Secrets and variables → Actions**):

```
DEPLOY_HOST         # server hostname or IP
DEPLOY_USER         # SSH user
DEPLOY_KEY          # SSH private key for the deploy user
DEPLOY_KNOWN_HOSTS  # verified known_hosts entry pinning the server's host key
```

`DEPLOY_KNOWN_HOSTS` must contain a `known_hosts` line for `DEPLOY_HOST`, verified **out-of-band** against the server's real key (e.g., compare `ssh-keyscan` output against `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` run on the server console, or against the entry your own `~/.ssh/known_hosts` recorded when you first verified the host). The deploy fails on host-key mismatch or when this secret is unset — no key is ever fetched at deploy time. If the server's host key is ever rotated, update this secret with a freshly verified entry.

The four base maps (CyclOSM, OSM Streets, OpenTopo, Humanitarian) and the Esri hillshade overlay are served from free, public endpoints with no token required. The FOSSGIS Valhalla routing endpoint also requires no key.

## nginx Configuration Highlights

The full canonical config lives in `infrastructure/nginx/www.webmap.dev.conf` and is applied automatically by the deploy — see [Applying the nginx config](#applying-the-nginx-config). Key patterns:

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

Before releasing (`/release` tags a version, and the tag push deploys):

- [ ] Local quality gate passes: `npm run type-check && npm run lint && npm test && npm run build`
- [ ] Bundle size within budget: `npm run size` (150 kB gzipped ceiling on the main JS chunk)
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
- **Bundle** — minified, tree-shaken; main JS chunk measured 126.39 kB gzipped at v0.50.0 (`439caf4`, 2026-09-13) against the 150 kB budget enforced by `npm run size`. CSS adds 19.10 kB gzipped; the two are not included in one another.
- **Tiles** — cached by Workbox SWR; subsequent views are instant.
- **API calls** — ESRI geocoding ~100–500 ms; FOSSGIS Valhalla typically 200–800 ms (no SLA).

## Rollback

If a deploy ships a critical bug:

1. Identify the bad commit: `git log mainline`.
2. Revert: `git revert <commit-hash>`.
3. Push: `git push origin mainline`.
4. Cut a new release (`/release`) — the new version tag triggers the deploy of the reverted code. No SSH needed.

## Common Deployment Issues

### Search not working

ESRI API key missing or invalid.

1. Verify `VITE_ESRI_API_KEY` is set in **Settings → Environments → production → Secrets**.
2. Trigger a redeploy of the latest release: run `/deploy` (or manually dispatch the deploy workflow from the Actions tab).
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
