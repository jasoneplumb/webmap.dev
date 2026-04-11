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
        ],
      },
      workbox: {
        // After skipWaiting activates the new SW, claim all open clients so
        // workbox-window's 'controlling' event fires and triggers location.reload().
        // Without this, onNeedRefresh sends SKIP_WAITING but the page never reloads
        // automatically — users see a blank/stale page until they manually refresh.
        clientsClaim: true,
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
        navigateFallback: null,
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
