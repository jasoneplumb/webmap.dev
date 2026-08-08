import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    // HTTPS for `npm run dev` only. A phone on the LAN reaches the dev server by
    // IP, and a plain-http origin is not a secure context — which silently
    // disables geolocation (Safari reports PERMISSION_DENIED without ever asking
    // iOS), crypto.randomUUID (used by the consent gate), and service workers.
    // The cert is self-signed, so iOS shows a one-time warning to accept.
    // apply:'serve' is explicit: the plugin only sets server.https, which `build`
    // ignores, but the production output must never depend on this being here.
    { ...basicSsl(), apply: 'serve' },
    VitePWA({
      // injectManifest: we ship a hand-written service worker (src/sw.ts) so the
      // navigation handler can guarantee a non-blank document and capture its own
      // failures. generateSW gave no control over either — see src/sw.ts and the
      // Edge-on-iPhone (WKWebView) blank-on-cold-start saga (#216).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectManifest: {
        // The app bundle is ~350 KB gzipped-source; keep a generous precache cap.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
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
