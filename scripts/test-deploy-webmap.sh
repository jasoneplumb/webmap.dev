#!/usr/bin/env bash
# End-to-end tests for scripts/deploy-webmap.sh.
#
# deploy-webmap.sh runs on a live host that serves other sites, so its failure
# paths are the part that matters most and the part nobody exercises by hand.
# This harness runs the real script against a throwaway prefix with stubbed
# privileged binaries (sudo / nginx / systemctl / install / chown / curl) and
# asserts the fail-closed behaviour: an invalid config is never activated, and
# the previous config is restored.
#
# Run: bash scripts/test-deploy-webmap.sh   (also runs as part of `npm test`)
set -uo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEPLOY_SCRIPT="$REPO_ROOT/scripts/deploy-webmap.sh"
PASS=0
FAIL=0

# ── Stub binaries ────────────────────────────────────────────────────────────
# Placed on PATH ahead of the real tools. Each records its invocations to
# $STUB_LOG so tests can assert on what the deploy actually did.
make_stubs() {
  local bin="$1"
  mkdir -p "$bin"

  # Pass-through sudo: drops the -n flag and execs the rest. Exercises the same
  # code path production takes as a non-root deploy user.
  cat >"$bin/sudo" <<'EOF'
#!/usr/bin/env bash
while [ "${1:-}" = "-n" ]; do shift; done
exec "$@"
EOF

  # `nginx -t` succeeds unless $STUB_DIR/nginx-t-fails exists.
  cat >"$bin/nginx" <<'EOF'
#!/usr/bin/env bash
echo "nginx $*" >> "$STUB_LOG"
if [ -f "$STUB_DIR/nginx-t-fails" ]; then
  echo "nginx: configuration file test failed" >&2
  exit 1
fi
exit 0
EOF

  cat >"$bin/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >> "$STUB_LOG"
exit 0
EOF

  # chown/install can't set root ownership in a test sandbox — keep the file
  # copy semantics, drop the ownership flags.
  cat >"$bin/chown" <<'EOF'
#!/usr/bin/env bash
echo "chown $*" >> "$STUB_LOG"
exit 0
EOF

  cat >"$bin/install" <<'EOF'
#!/usr/bin/env bash
echo "install $*" >> "$STUB_LOG"
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    -o|-g|-m) shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
cp "${args[0]}" "${args[1]}"
EOF

  # Health check succeeds unless $STUB_DIR/curl-fails exists.
  cat >"$bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"
[ -f "$STUB_DIR/curl-fails" ] && exit 22
exit 0
EOF

  chmod +x "$bin"/*
}

# ── Fixture ──────────────────────────────────────────────────────────────────
# Builds a sandbox prefix. Sets the globals $ROOT / $STUB_DIR / $STUB_LOG —
# called directly (never through $(...)), so the assignments survive.
setup() {
  local root
  root=$(mktemp -d)
  ROOT="$root"
  mkdir -p "$root/bin" "$root/var/www/webmap/web" "$root/etc/nginx/sites-available" \
           "$root/etc/nginx/sites-enabled" "$root/backups" "$root/stub"
  STUB_DIR="$root/stub"
  STUB_LOG="$root/stub/log"
  : >"$STUB_LOG"
  make_stubs "$root/bin"

  # A previously deployed tree, so backup/rollback paths are reachable.
  echo '<html><script type="module" src="/old.js"></script></html>' \
    >"$root/var/www/webmap/web/index.html"

  # The tarball the deploy receives on stdin.
  mkdir -p "$root/dist"
  echo '<html><script type="module" src="/new.js"></script></html>' \
    >"$root/dist/index.html"
  tar -czf "$root/payload.tar.gz" -C "$root/dist" .
}

# Runs deploy-webmap.sh against the sandbox. Echoes combined output; returns the
# script's exit status.
run_deploy() {
  local root="$1"
  PATH="$root/bin:$PATH" \
  STUB_DIR="$STUB_DIR" \
  STUB_LOG="$STUB_LOG" \
  WEBMAP_ROOT="$root/var/www/webmap" \
  BACKUP_DIR="$root/backups" \
  NGINX_CONF_SRC="$root/incoming.conf" \
  NGINX_SITES_AVAILABLE="$root/etc/nginx/sites-available" \
  NGINX_SITES_ENABLED="$root/etc/nginx/sites-enabled" \
  NGINX_BIN="nginx" \
  SYSTEMCTL_BIN="systemctl" \
  HEALTH_URL="http://localhost/" \
    bash "$DEPLOY_SCRIPT" <"$root/payload.tar.gz" 2>&1
}

# ── Assertions ───────────────────────────────────────────────────────────────
ok()   { PASS=$((PASS + 1)); echo "  ok   — $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL — $1"; }
check() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (expected '$2', got '$1')"; fi; }
check_contains() {
  case "$1" in *"$2"*) ok "$3" ;; *) bad "$3 (missing '$2')" ;; esac
}
check_not_contains() {
  case "$1" in *"$2"*) bad "$3 (unexpectedly found '$2')" ;; *) ok "$3" ;; esac
}

# ── Tests ────────────────────────────────────────────────────────────────────

test_first_deploy_installs_conf() {
  echo "first deploy installs and enables the conf"
  setup; local root="$ROOT"
  printf 'server { listen 80; }\n' >"$root/incoming.conf"

  local out; out=$(run_deploy "$root"); local rc=$?

  check "$rc" 0 "deploy succeeds"
  check "$(cat "$root/etc/nginx/sites-available/www.webmap.dev.conf" 2>/dev/null)" \
        "server { listen 80; }" "conf installed into sites-available"
  if [ -L "$root/etc/nginx/sites-enabled/www.webmap.dev.conf" ]; then
    ok "sites-enabled symlink created"
  else
    bad "sites-enabled symlink created"
  fi
  check_contains "$(cat "$STUB_LOG")" "nginx -t" "nginx -t ran"
  check_contains "$(cat "$STUB_LOG")" "systemctl reload nginx" "nginx was reloaded"
  check "$(cat "$root/var/www/webmap/web/index.html")" \
        '<html><script type="module" src="/new.js"></script></html>' "new content is live"
  rm -rf "$root"
}

test_unchanged_conf_skips_reload() {
  echo "unchanged conf short-circuits the reload"
  setup; local root="$ROOT"
  printf 'server { listen 80; }\n' >"$root/incoming.conf"
  cp "$root/incoming.conf" "$root/etc/nginx/sites-available/www.webmap.dev.conf"
  ln -sfn "$root/etc/nginx/sites-available/www.webmap.dev.conf" \
          "$root/etc/nginx/sites-enabled/www.webmap.dev.conf"

  local out; out=$(run_deploy "$root"); local rc=$?

  check "$rc" 0 "deploy succeeds"
  check_contains "$out" "unchanged and already enabled" "short-circuit reported"
  check_not_contains "$(cat "$STUB_LOG")" "systemctl reload" "no reload issued"
  rm -rf "$root"
}

test_invalid_conf_is_never_activated() {
  echo "a conf failing nginx -t is never activated and is rolled back"
  setup; local root="$ROOT"
  printf 'server { listen 80; } # OLD GOOD\n' >"$root/etc/nginx/sites-available/www.webmap.dev.conf"
  ln -sfn "$root/etc/nginx/sites-available/www.webmap.dev.conf" \
          "$root/etc/nginx/sites-enabled/www.webmap.dev.conf"
  printf 'this is not valid nginx # NEW BAD\n' >"$root/incoming.conf"

  # Preflight must pass (host is healthy); the post-install `nginx -t` must fail.
  # The stub flips to failing the moment the new conf lands on disk.
  cat >"$root/bin/nginx" <<EOF
#!/usr/bin/env bash
echo "nginx \$*" >> "\$STUB_LOG"
grep -q 'NEW BAD' "$root/etc/nginx/sites-available/www.webmap.dev.conf" && exit 1
exit 0
EOF
  chmod +x "$root/bin/nginx"

  local out; out=$(run_deploy "$root"); local rc=$?

  check "$rc" 1 "deploy fails"
  check_contains "$out" "was NOT reloaded" "refusal to reload is reported"
  check_not_contains "$(cat "$STUB_LOG")" "systemctl reload" "nginx was never reloaded"
  check_contains "$(cat "$root/etc/nginx/sites-available/www.webmap.dev.conf")" \
        "OLD GOOD" "previous conf restored on disk"
  check "$(cat "$root/var/www/webmap/web/index.html")" \
        '<html><script type="module" src="/old.js"></script></html>' "content rolled back"
  rm -rf "$root"
}

test_preflight_blocks_on_already_broken_host() {
  echo "an already-invalid host config aborts before anything is touched"
  setup; local root="$ROOT"
  printf 'server { listen 80; }\n' >"$root/incoming.conf"
  touch "$STUB_DIR/nginx-t-fails"

  local out; out=$(run_deploy "$root"); local rc=$?

  check "$rc" 1 "deploy fails"
  check_contains "$out" "already invalid" "pre-existing breakage is reported"
  check_not_contains "$(cat "$STUB_LOG")" "systemctl reload" "nginx was never reloaded"
  check "$(cat "$root/var/www/webmap/web/index.html")" \
        '<html><script type="module" src="/old.js"></script></html>' "content left untouched"
  if [ ! -e "$root/etc/nginx/sites-available/www.webmap.dev.conf" ]; then
    ok "no conf was installed"
  else
    bad "no conf was installed"
  fi
  rm -rf "$root"
}

test_health_check_failure_rolls_back_conf_and_content() {
  echo "a failing health check rolls back both the conf and the content"
  setup; local root="$ROOT"
  printf 'server { listen 80; } # OLD GOOD\n' >"$root/etc/nginx/sites-available/www.webmap.dev.conf"
  ln -sfn "$root/etc/nginx/sites-available/www.webmap.dev.conf" \
          "$root/etc/nginx/sites-enabled/www.webmap.dev.conf"
  printf 'server { listen 80; } # NEW\n' >"$root/incoming.conf"
  touch "$STUB_DIR/curl-fails"

  local out; out=$(run_deploy "$root"); local rc=$?

  check "$rc" 1 "deploy fails"
  check_contains "$(cat "$root/etc/nginx/sites-available/www.webmap.dev.conf")" \
        "OLD GOOD" "previous conf restored"
  check "$(cat "$root/var/www/webmap/web/index.html")" \
        '<html><script type="module" src="/old.js"></script></html>' "content rolled back"
  # Two reloads: one activating the new conf, one restoring the old one.
  check "$(grep -c 'systemctl reload nginx' "$STUB_LOG")" 2 "old conf was reloaded back in"
  rm -rf "$root"
}

test_missing_conf_source_deploys_content_only() {
  echo "a missing conf source deploys content and leaves nginx alone"
  setup; local root="$ROOT"   # note: no $root/incoming.conf created

  local out; out=$(run_deploy "$root"); local rc=$?

  check "$rc" 0 "deploy succeeds"
  check_contains "$out" "skipping nginx config step" "nginx step skipped"
  check_not_contains "$(cat "$STUB_LOG")" "systemctl reload" "no reload issued"
  check "$(cat "$root/var/www/webmap/web/index.html")" \
        '<html><script type="module" src="/new.js"></script></html>' "new content is live"
  rm -rf "$root"
}

test_install_failure_rolls_back_content() {
  echo "a failed conf install (e.g. missing sudoers rule) rolls back the content"
  setup; local root="$ROOT"
  printf 'server { listen 80; }\n' >"$root/incoming.conf"
  # Simulate `sudo -n install` being denied by sudoers.
  cat >"$root/bin/install" <<'EOF'
#!/usr/bin/env bash
echo "install $*" >> "$STUB_LOG"
echo "sudo: a password is required" >&2
exit 1
EOF
  chmod +x "$root/bin/install"

  local out; out=$(run_deploy "$root"); local rc=$?

  check "$rc" 1 "deploy fails"
  check_contains "$out" "missing sudoers entry" "cause is reported"
  check_not_contains "$(cat "$STUB_LOG")" "systemctl reload" "nginx was never reloaded"
  check "$(cat "$root/var/www/webmap/web/index.html")" \
        '<html><script type="module" src="/old.js"></script></html>' "content rolled back"
  rm -rf "$root"
}

test_repo_conf_is_the_one_that_ships() {
  echo "the conf shipped is the repo's canonical conf"
  local conf="$REPO_ROOT/infrastructure/nginx/www.webmap.dev.conf"
  if [ -f "$conf" ]; then ok "infrastructure/nginx/www.webmap.dev.conf exists"; else
    bad "infrastructure/nginx/www.webmap.dev.conf exists"; return; fi
  check_contains "$(cat "$REPO_ROOT/.github/workflows/deploy.yml")" \
        "infrastructure/nginx/www.webmap.dev.conf" "deploy workflow ships the repo conf"
}

# ── Runner ───────────────────────────────────────────────────────────────────
echo "deploy-webmap.sh tests"
test_first_deploy_installs_conf
test_unchanged_conf_skips_reload
test_invalid_conf_is_never_activated
test_preflight_blocks_on_already_broken_host
test_health_check_failure_rolls_back_conf_and_content
test_missing_conf_source_deploys_content_only
test_install_failure_rolls_back_content
test_repo_conf_is_the_one_that_ships

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
