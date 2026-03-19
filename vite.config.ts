import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
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
            src: '/logo-color-v1.1.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: '/logo-color-v1.1.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.mapbox\.com\/styles\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'mapbox-tiles',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'osm-tiles',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.google\.com\/vt\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-imagery',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
            },
          },
          {
            urlPattern: /^https:\/\/geocode\.arcgis\.com\/.*/,
            handler: 'NetworkOnly',
            options: {
              cacheName: 'geocode-api',
            },
          },
        ],
        navigateFallback: null,
        skipWaiting: true,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
