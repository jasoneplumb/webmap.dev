#!/usr/bin/env bash
# Intent: Deploy webmap.dev to production via SSH
# Context: Called from .github/workflows/deploy.yml; receives tar.gz on stdin
# Pattern: Backup → extract → verify content → health check → rollback on failure
set -e

echo "Receiving and extracting webmap deployment..."

mkdir -p /var/www/webmap/web

BACKUP_TS=$(date +%s)
if [ -f /var/www/webmap/web/index.html ]; then
  echo "Backing up current deployment..."
  cp -r /var/www/webmap/web /tmp/webmap-backup-$BACKUP_TS || true
fi

rm -rf /var/www/webmap/web/*
tar -xzf - -C /var/www/webmap/web
chown -R www-data:www-data /var/www/webmap/web

echo "Extraction complete!"

echo "Verifying deployment..."
test -f /var/www/webmap/web/index.html || { echo "ERROR: index.html not found"; exit 1; }

# Verify Vite build output (type=module indicates a modern Vite bundle, not the old PHP file)
if ! grep -q 'type="module"' /var/www/webmap/web/index.html; then
  echo "ERROR: index.html missing expected Vite build content (type=module)"
  BACKUP=$(ls -td /tmp/webmap-backup-* 2>/dev/null | head -1)
  if [ -n "$BACKUP" ]; then
    echo "Rolling back to previous version..."
    rm -rf /var/www/webmap/web/*
    cp -r "$BACKUP"/. /var/www/webmap/web/
    chown -R www-data:www-data /var/www/webmap/web
    echo "Rollback complete"
  fi
  exit 1
fi

echo "Content verification passed!"

# Health check with Host header — multiple sites share the VPS IP, so nginx needs
# the Host header to route to the correct vhost
if curl -sf --max-time 10 -H "Host: www.webmap.dev" http://localhost/ -o /dev/null 2>/dev/null; then
  echo "Health check passed!"
else
  echo "ERROR: Health check failed — rolling back..."
  BACKUP=$(ls -td /tmp/webmap-backup-* 2>/dev/null | head -1)
  if [ -n "$BACKUP" ]; then
    echo "Restoring from: $BACKUP"
    rm -rf /var/www/webmap/web/*
    cp -r "$BACKUP"/. /var/www/webmap/web/
    chown -R www-data:www-data /var/www/webmap/web
    echo "Rollback complete"
  else
    echo "No backup found for rollback"
  fi
  exit 1
fi

VERSION="${DEPLOY_VERSION:-unknown}"
echo "{\"version\":\"$VERSION\",\"sha\":\"${DEPLOY_SHA:-unknown}\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /var/www/webmap/.deployed-version || echo "WARNING: Failed to write version info"

# Keep last 5 backups
ls -td /tmp/webmap-backup-* 2>/dev/null | tail -n +6 | xargs rm -rf 2>/dev/null || true

echo "Webmap deployment complete!"
