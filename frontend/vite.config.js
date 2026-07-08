import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/atlas/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/192.png', 'icons/512.png'],
      manifest: {
        name: 'Atlas',
        short_name: 'Atlas',
        description: 'Your personal operating system',
        theme_color: '#efeae0',
        background_color: '#efeae0',
        display: 'standalone',
        start_url: '/atlas/',
        scope: '/atlas/',
        icons: [
          { src: '/atlas/icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: '/atlas/icons/512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Cache API responses briefly so the app works when briefly offline
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'atlas-api', networkTimeoutSeconds: 5 },
          },
        ],
      },
    }),
  ],
})
