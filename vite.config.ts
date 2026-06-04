import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';
import { OSM_TILE_CACHE_NAME } from './src/sw-constants';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
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
          {
            src: '/logo-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/logo-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/logo-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/logo-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // After skipWaiting activates the new SW, claim all open clients so
        // workbox-window's 'controlling' event fires and triggers location.reload().
        // Without this, onNeedRefresh sends SKIP_WAITING but the page never reloads
        // automatically — users see a blank/stale page until they manually refresh.
        clientsClaim: true,
        // Drop precache entries from older SW generations on activate, so a stale
        // index referencing chunks that no longer exist can't be served.
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: OSM_TILE_CACHE_NAME,
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
          {
            urlPattern: /^https:\/\/geocode\.arcgis\.com\/.*/,
            handler: 'NetworkOnly',
          },
        ],
        // Serve the precached app shell for navigation requests. With null, a
        // returning user after a deploy could get a shell/chunk hash mismatch
        // (old SW serving an index whose hashed JS is no longer in its precache),
        // blanking the page until a manual reload. 'index.html' guarantees the
        // navigation is answered from one consistent precache generation.
        navigateFallback: 'index.html',
      },
      devOptions: {
        // Disabled in dev: the precaching service worker served stale bundles
        // during development, masking source changes (e.g. base-map and search
        // edits appeared to "not take effect"). Production SW is unaffected.
        // Re-enable temporarily only when specifically testing PWA/offline.
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
