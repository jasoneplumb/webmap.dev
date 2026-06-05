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
            // Cold-start navigations: fetch a fresh index.html from the network when
            // online so the served shell always pairs with current chunk hashes; fall
            // back to the last cached navigation only on a genuine network failure
            // (offline). Replaces the cache-first `navigateFallback` precache route,
            // which intermittently returned a blank document in third-party iOS browsers
            // (WKWebView), whose Cache Storage / service-worker support is flakier than
            // Safari's. Safari rendered fine; only Edge-on-iPhone blanked on cold start.
            //
            // No networkTimeoutSeconds: a timeout makes NetworkFirst fall back to the
            // (WKWebView-flaky) runtime cache while the network is merely slow — which
            // intermittently served an empty navigation → blank document with no
            // index.html rendered (so even the in-page watchdog couldn't recover). Wait
            // for the network instead; a slow shell beats a blank one. Only a real fetch
            // rejection (offline) falls back to cache.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-navigations',
              expiration: { maxEntries: 1 },
            },
          },
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
        // Disable vite-plugin-pwa's default `navigateFallback: 'index.html'`. That
        // default registers a cache-first NavigationRoute *before* our runtimeCaching
        // rules, so without this `null` it would win for every navigation and the
        // NetworkFirst rule above would never fire. Navigation is handled NetworkFirst
        // instead: an online cold start always fetches a fresh index.html that pairs
        // with current chunk hashes (also retiring the shell/chunk hash-mismatch that
        // navigateFallback was patching), while fixing the WKWebView blank-page bug the
        // cache-first precache route caused.
        navigateFallback: null,
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
