#!/usr/bin/env bash
# Intent: Deploy webmap.dev to production via SSH
# Context: Called from the production deploy workflow; receives tar.gz on stdin
# Pattern: Preflight → backup → extract → verify content → apply nginx conf →
#          health check → roll back content *and* nginx conf on failure
#
# The nginx config is applied from the repo (infrastructure/nginx/*.conf) so the
# host can never drift from what is checked in. The conf is scp'd to
# NGINX_CONF_SRC ahead of this script; if it is absent the nginx step is skipped
# and only content is deployed.
#
# Privileges: runs as root, or as a deploy user with a tightly scoped sudoers
# entry (see docs/deployment.md — "Applying the nginx config"). Nothing here
# requires broad sudo.
set -e

# ── Configuration ────────────────────────────────────────────────────────────
# Every path is env-overridable so scripts/test-deploy-webmap.sh can exercise
# this script end-to-end against a throwaway prefix. Production passes none of
# these and gets the real locations.
WEBMAP_ROOT="${WEBMAP_ROOT:-/var/www/webmap}"
WEB_ROOT="$WEBMAP_ROOT/web"
BACKUP_DIR="${BACKUP_DIR:-/tmp}"
NGINX_CONF_SRC="${NGINX_CONF_SRC:-/tmp/www.webmap.dev.conf}"
NGINX_CONF_NAME=www.webmap.dev.conf
NGINX_SITES_AVAILABLE="${NGINX_SITES_AVAILABLE:-/etc/nginx/sites-available}"
NGINX_SITES_ENABLED="${NGINX_SITES_ENABLED:-/etc/nginx/sites-enabled}"
NGINX_AVAILABLE="$NGINX_SITES_AVAILABLE/$NGINX_CONF_NAME"
NGINX_ENABLED="$NGINX_SITES_ENABLED/$NGINX_CONF_NAME"
NGINX_BIN="${NGINX_BIN:-/usr/sbin/nginx}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-/usr/bin/systemctl}"
HEALTH_URL="${HEALTH_URL:-http://localhost/}"

BACKUP_TS=$(date +%s)
CONTENT_BACKUP=""
# Absolute path of the pre-deploy nginx conf, or the literal "none" when no conf
# was installed before this deploy. Empty means the conf was never touched.
NGINX_CONF_BACKUP=""
NGINX_RELOADED=0

# Root needs no escalation; a deploy user gets `sudo -n` (non-interactive — a
# missing sudoers entry fails immediately rather than hanging on a prompt).
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo -n"
fi

# ── Helpers ──────────────────────────────────────────────────────────────────

# Restore the previous content tree. Safe to call when no backup was taken.
rollback_content() {
  if [ -z "$CONTENT_BACKUP" ] || [ ! -d "$CONTENT_BACKUP" ]; then
    echo "No content backup found for rollback"
    return 0
  fi
  echo "Restoring content from: $CONTENT_BACKUP"
  rm -rf "${WEB_ROOT:?}"/*
  cp -r "$CONTENT_BACKUP"/. "$WEB_ROOT"/
  chown -R www-data:www-data "$WEB_ROOT"
  echo "Content rollback complete"
}

# Restore the previous nginx conf and reload, but only if this deploy changed
# it. Called when a later step fails after the conf was already activated.
rollback_nginx_conf() {
  [ -n "$NGINX_CONF_BACKUP" ] || return 0

  if [ "$NGINX_CONF_BACKUP" = "none" ]; then
    echo "Removing nginx conf installed by this deploy..."
    $SUDO rm -f "$NGINX_ENABLED" "$NGINX_AVAILABLE"
  else
    echo "Restoring previous nginx conf from: $NGINX_CONF_BACKUP"
    $SUDO cp "$NGINX_CONF_BACKUP" "$NGINX_AVAILABLE"
  fi

  # Never reload a config that does not validate — that would take down every
  # vhost on this host, not just webmap.
  if ! $SUDO "$NGINX_BIN" -t </dev/null; then
    echo "ERROR: restored nginx conf failed validation — NOT reloading."
    echo "       nginx keeps serving its last-loaded config; fix by hand."
    return 1
  fi
  if [ "$NGINX_RELOADED" -eq 1 ]; then
    $SUDO "$SYSTEMCTL_BIN" reload nginx </dev/null
    echo "nginx conf rollback complete (reloaded)"
  else
    echo "nginx conf rollback complete (no reload was issued)"
  fi
}

# Roll back everything this deploy changed, then exit non-zero.
fail_and_rollback() {
  echo "ERROR: $1 — rolling back..."
  rollback_nginx_conf || true
  rollback_content
  exit 1
}

# ── Preflight ────────────────────────────────────────────────────────────────
# Validate the host's *existing* nginx config before touching anything. If it is
# already broken, this deploy must not reload nginx (the reload would activate
# someone else's breakage) and must not leave a half-applied state behind.
# stdin is the deployment tarball — every command here reads from /dev/null so
# none of them can swallow it.
if [ -f "$NGINX_CONF_SRC" ]; then
  echo "Preflight: validating existing nginx config..."
  if ! $SUDO "$NGINX_BIN" -t </dev/null; then
    echo "ERROR: the host's current nginx config is already invalid."
    echo "       Refusing to deploy — fix the host config first. Nothing was changed."
    exit 1
  fi
  echo "Preflight passed — host nginx config is valid."
fi

# ── Content ──────────────────────────────────────────────────────────────────
echo "Receiving and extracting webmap deployment..."

mkdir -p "$WEB_ROOT"

if [ -f "$WEB_ROOT/index.html" ]; then
  echo "Backing up current deployment..."
  if cp -r "$WEB_ROOT" "$BACKUP_DIR/webmap-backup-$BACKUP_TS"; then
    CONTENT_BACKUP="$BACKUP_DIR/webmap-backup-$BACKUP_TS"
  else
    echo "WARNING: content backup failed — rollback will not be available"
  fi
fi

rm -rf "${WEB_ROOT:?}"/*
tar -xzf - -C "$WEB_ROOT" || fail_and_rollback "could not extract the deployment tarball"
chown -R www-data:www-data "$WEB_ROOT" || fail_and_rollback "could not chown the web root"

echo "Extraction complete!"

echo "Verifying deployment..."
test -f "$WEB_ROOT/index.html" || fail_and_rollback "index.html not found"

# Verify Vite build output (type=module indicates a modern Vite bundle, not the old PHP file)
grep -q 'type="module"' "$WEB_ROOT/index.html" \
  || fail_and_rollback "index.html missing expected Vite build content (type=module)"

echo "Content verification passed!"

# ── nginx config ─────────────────────────────────────────────────────────────
# Applied from the repo so a change to infrastructure/nginx/*.conf takes effect
# on the next deploy with no manual step. Fail-closed: the new conf is validated
# with `nginx -t` before any reload, and restored on failure.
if [ ! -f "$NGINX_CONF_SRC" ]; then
  echo "No nginx conf at $NGINX_CONF_SRC — skipping nginx config step."
elif [ -f "$NGINX_AVAILABLE" ] \
  && cmp -s "$NGINX_CONF_SRC" "$NGINX_AVAILABLE" \
  && [ "$(readlink -f "$NGINX_ENABLED" 2>/dev/null)" = "$(readlink -f "$NGINX_AVAILABLE")" ]; then
  # Short-circuit: conf is byte-identical and already enabled. Skipping the
  # reload keeps deploys that do not touch nginx free of any live-config churn.
  echo "nginx conf unchanged and already enabled — no reload needed."
else
  echo "Applying nginx config from repo..."

  if [ -f "$NGINX_AVAILABLE" ]; then
    if $SUDO cp "$NGINX_AVAILABLE" "$BACKUP_DIR/webmap-nginx-backup-$BACKUP_TS.conf"; then
      NGINX_CONF_BACKUP="$BACKUP_DIR/webmap-nginx-backup-$BACKUP_TS.conf"
      echo "Backed up current nginx conf to $NGINX_CONF_BACKUP"
    else
      fail_and_rollback "could not back up the current nginx conf"
    fi
  else
    NGINX_CONF_BACKUP="none"
  fi

  $SUDO install -o root -g root -m 0644 "$NGINX_CONF_SRC" "$NGINX_AVAILABLE" \
    || fail_and_rollback "could not install the nginx conf (missing sudoers entry?)"

  # Idempotent enable: ln -sfn replaces a stale symlink without nesting one
  # inside a directory the way `ln -s` into an existing symlink-to-dir would.
  $SUDO ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED" \
    || fail_and_rollback "could not enable the nginx conf symlink"

  if ! $SUDO "$NGINX_BIN" -t </dev/null; then
    echo "ERROR: new nginx conf failed validation — nginx was NOT reloaded."
    fail_and_rollback "invalid nginx config"
  fi
  echo "nginx config validated."

  $SUDO "$SYSTEMCTL_BIN" reload nginx </dev/null \
    || fail_and_rollback "nginx reload failed"
  NGINX_RELOADED=1
  echo "nginx reloaded with the repo config."
fi

# ── Health check ─────────────────────────────────────────────────────────────
# Runs after the nginx reload so it validates the new content *and* the new
# config together. A conf that passes `nginx -t` but breaks serving is caught
# here and rolled back.
# Host header — multiple sites share the VPS IP, so nginx needs the Host header
# to route to the correct vhost.
if curl -sf --max-time 10 -H "Host: www.webmap.dev" "$HEALTH_URL" -o /dev/null 2>/dev/null; then
  echo "Health check passed!"
else
  fail_and_rollback "health check failed"
fi

VERSION="${DEPLOY_VERSION:-unknown}"
echo "{\"version\":\"$VERSION\",\"sha\":\"${DEPLOY_SHA:-unknown}\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$WEBMAP_ROOT/.deployed-version" || echo "WARNING: Failed to write version info"

# Keep last 5 backups of each kind
ls -td "$BACKUP_DIR"/webmap-backup-* 2>/dev/null | tail -n +6 | xargs rm -rf 2>/dev/null || true
ls -t "$BACKUP_DIR"/webmap-nginx-backup-*.conf 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true

echo "Webmap deployment complete!"
