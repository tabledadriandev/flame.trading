import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Flame is a static single-page app plus a few Vercel functions in /api.
// The service worker caches only the app shell; market data is never cached.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Flame',
        short_name: 'Flame',
        description: 'A paper-trading terminal. Real markets, play money.',
        start_url: '/',
        display: 'standalone',
        background_color: '#131210',
        theme_color: '#131210',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: true },
  // The data proxies in /api run on Vercel. In local development, borrow the deployed ones.
  server: { proxy: { '/api': { target: 'https://flame.trading', changeOrigin: true } } },
});
