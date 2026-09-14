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
BACKUP_DIR="${BACKUP_DIR:-$WEBMAP_ROOT/.backups}"
NGINX_CONF_SRC="${NGINX_CONF_SRC:-}"
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

# Refuse to install a file as root-owned nginx config unless it is a plain file
# owned by us or by root. The staging path is unpredictable (the workflow makes
# it with 128 bits of randomness and mode 0700), but this is the check that
# actually holds: a file planted by another local account never reaches
# `install`, and so never reaches an nginx instance shared with other vhosts.
assert_safe_source() {
  local f="$1" owner
  if [ -L "$f" ]; then
    echo "ERROR: $f is a symlink — refusing to install it as nginx config"
    return 1
  fi
  if [ ! -f "$f" ]; then
    echo "ERROR: $f is not a regular file — refusing to install it as nginx config"
    return 1
  fi
  owner=$(stat -c '%u' "$f" 2>/dev/null || stat -f '%u' "$f" 2>/dev/null || echo "")
  if [ -z "$owner" ]; then
    echo "ERROR: could not determine the owner of $f — refusing"
    return 1
  fi
  if [ "$owner" != "$(id -u)" ] && [ "$owner" != "0" ]; then
    echo "ERROR: $f is owned by uid $owner (expected $(id -u) or 0) — refusing"
    return 1
  fi
}

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
  $SUDO chown -R www-data:www-data "$WEB_ROOT"
  echo "Content rollback complete"
}

# Restore the previous nginx conf and reload, but only if this deploy changed
# it. Called when a later step fails after the conf was already activated.
rollback_nginx_conf() {
  [ -n "$NGINX_CONF_BACKUP" ] || return 0

  if [ "$NGINX_CONF_BACKUP" = "none" ]; then
    echo "Removing nginx conf installed by this deploy..."
    # Argument shape must match the sudoers example in docs/deployment.md.
    if ! $SUDO rm -f "$NGINX_ENABLED" "$NGINX_AVAILABLE"; then
      echo "ERROR: could not remove the conf this deploy installed (sudoers mismatch?)."
      echo "       The bad conf is still on disk; nginx will NOT be reloaded."
      return 1
    fi
  else
    echo "Restoring previous nginx conf from: $NGINX_CONF_BACKUP"
    assert_safe_source "$NGINX_CONF_BACKUP" || return 1
    # Argument shape must match the sudoers example in docs/deployment.md.
    if ! $SUDO install -o root -g root -m 0644 "$NGINX_CONF_BACKUP" "$NGINX_AVAILABLE"; then
      echo "ERROR: could not restore the previous nginx conf (sudoers mismatch?)."
      echo "       The bad conf is still on disk; nginx will NOT be reloaded."
      return 1
    fi
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
  # `|| true` is load-bearing, not decorative: it keeps a failed conf rollback
  # from aborting under `set -e` before the content rollback below has run. We
  # always want both attempted, and rollback_nginx_conf reports its own failure.
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

# A non-root deploy user needs passwordless sudo for the privileged steps. Check
# it up front so a missing sudoers entry fails before any content is touched,
# rather than half-way through with a rollback.
if [ -n "$SUDO" ]; then
  if ! sudo -n true </dev/null 2>/dev/null; then
    echo "ERROR: running as $(id -un) with no passwordless sudo."
    echo "       Install /etc/sudoers.d/webmap-deploy (see docs/deployment.md)."
    echo "       Nothing was changed."
    exit 1
  fi
fi

if [ -n "$NGINX_CONF_SRC" ]; then
  assert_safe_source "$NGINX_CONF_SRC" || exit 1
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
# 0700 so no other local account can plant a file that a later rollback would
# install as nginx config.
mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR" \
  || { echo "ERROR: could not create backup dir $BACKUP_DIR"; exit 1; }

# Fail closed, like every other precondition here: without a backup the
# `rm -rf` below is irreversible, so a later failure would leave the web root
# empty with nothing to restore. Abort while the site is still intact instead.
# (A first deploy has nothing to back up — that case is not an error.)
if [ -f "$WEB_ROOT/index.html" ]; then
  echo "Backing up current deployment..."
  if ! cp -r "$WEB_ROOT" "$BACKUP_DIR/webmap-backup-$BACKUP_TS"; then
    echo "ERROR: could not back up the current deployment to $BACKUP_DIR."
    echo "       Refusing to replace the live site with no way back (disk full?)."
    echo "       Nothing was changed."
    exit 1
  fi
  CONTENT_BACKUP="$BACKUP_DIR/webmap-backup-$BACKUP_TS"
else
  echo "No existing deployment to back up (first deploy)."
fi

rm -rf "${WEB_ROOT:?}"/*
tar -xzf - -C "$WEB_ROOT" || fail_and_rollback "could not extract the deployment tarball"
# Argument shape must match the sudoers example in docs/deployment.md.
$SUDO chown -R www-data:www-data "$WEB_ROOT" \
  || fail_and_rollback "could not chown the web root (missing sudoers entry?)"

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
if [ -z "$NGINX_CONF_SRC" ]; then
  echo "No nginx conf staged (NGINX_CONF_SRC unset) — skipping nginx config step."
elif [ -f "$NGINX_AVAILABLE" ] \
  && cmp -s "$NGINX_CONF_SRC" "$NGINX_AVAILABLE" \
  && [ "$(readlink -f "$NGINX_ENABLED" 2>/dev/null)" = "$(readlink -f "$NGINX_AVAILABLE")" ]; then
  # Short-circuit: conf is byte-identical and already enabled. Skipping the
  # reload keeps deploys that do not touch nginx free of any live-config churn.
  echo "nginx conf unchanged and already enabled — no reload needed."
else
  echo "Applying nginx config from repo..."

  if [ -f "$NGINX_AVAILABLE" ]; then
    # No sudo: the conf is 0644 in a world-traversable dir, so the deploy user
    # can read it. Keeps the sudoers surface to writes and the reload.
    if cp "$NGINX_AVAILABLE" "$BACKUP_DIR/webmap-nginx-backup-$BACKUP_TS.conf"; then
      NGINX_CONF_BACKUP="$BACKUP_DIR/webmap-nginx-backup-$BACKUP_TS.conf"
      echo "Backed up current nginx conf to $NGINX_CONF_BACKUP"
    else
      fail_and_rollback "could not back up the current nginx conf"
    fi
  else
    NGINX_CONF_BACKUP="none"
  fi

  assert_safe_source "$NGINX_CONF_SRC" || fail_and_rollback "unsafe nginx conf source"
  # Argument shape must match the sudoers example in docs/deployment.md.
  $SUDO install -o root -g root -m 0644 "$NGINX_CONF_SRC" "$NGINX_AVAILABLE" \
    || fail_and_rollback "could not install the nginx conf (missing sudoers entry?)"

  # Argument shape must match the sudoers example in docs/deployment.md.
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
