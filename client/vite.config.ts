import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  base: '/s/admin/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Metflux Admin',
        short_name: 'Metflux',
        description: 'Metflux admin panel',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/s/admin/',
        scope: '/s/admin/',
        // The dynamic endpoint carries the uploaded App Branding logo; the
        // bundled static PNGs are guaranteed-valid fallbacks so the installed /
        // home-screen icon is never blank (Android needs real PNGs).
        icons: [
          // Brand mark (square, padded) is authoritative for the installed icon;
          // the runtime app-logo stays as a lower-priority option for rebranding.
          { src: '/s/admin/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/s/admin/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/s/admin/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/api/public/app-logo', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/s/admin/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        prefer_related_applications: false,
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
      workbox: {
        // Bumped from default 2 MiB so the precache can include the main JS
        // bundle (~2.8 MB after vendoring all of Radix + Recharts + html2pdf).
        // 5 MiB gives breathing room as the app grows; if it ever overflows
        // again we should code-split via dynamic import() rather than bumping
        // this further.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Pull in our push-notification handler (login alerts) — the generated
        // Workbox SW importScripts() this at the top.
        importScripts: ['/s/admin/push-sw.js'],
        // Always go to network for /api — never cache JSON responses.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /\/uploads\/.*$/,
            handler: 'CacheFirst',
            options: { cacheName: 'uploads', expiration: { maxAgeSeconds: 7 * 24 * 60 * 60 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
