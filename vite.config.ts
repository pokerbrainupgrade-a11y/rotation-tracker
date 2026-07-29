import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/rotation-tracker/',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,json}'],
        navigateFallback: '/rotation-tracker/index.html',
        cleanupOutdatedCaches: true,
      },
      manifest: {
        id: '/rotation-tracker/',
        name: 'Rotation Tracker',
        short_name: 'Rotation',
        description: 'Offline training log — rolling rotation model',
        start_url: '/rotation-tracker/',
        scope: '/rotation-tracker/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0B0B0D',
        theme_color: '#0B0B0D',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: { target: 'es2020', sourcemap: false },
});
