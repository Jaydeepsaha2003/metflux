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
        // Point at the dynamic endpoint so the uploaded App Branding logo is
        // used for the installed / home-screen icon (new installs). The bundled
        // SVG stays as a guaranteed-valid fallback for installability.
        icons: [
          { src: '/api/public/app-logo', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/api/public/app-logo', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/s/admin/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
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
