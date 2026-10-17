import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Content-Security-Policy for the production page. GitHub Pages can't send
// headers, so it goes in a <meta> tag, first thing in <head>. It's the second
// line of defence behind sanitising (src/lib/markdown.js): if hostile HTML
// ever got through, no inline script or event handler runs, and the page can
// only talk to the API and the Google / GitHub APIs it actually uses.
// Build-only: Vite's dev server relies on inline scripts for hot reload.
function contentSecurityPolicy(apiUrl) {
  const apiOrigin = new URL(apiUrl || 'http://localhost:8000').origin
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // React sets inline styles via the DOM (allowed regardless); this covers
    // style attributes in the HTML and Google Fonts' stylesheet.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // Images in notes may be hosted anywhere; an image can't run code.
    "img-src 'self' data: blob: https:",
    // Spoken replies play from blob: URLs; data: is the silent clip that
    // unlocks audio on iOS (src/lib/speech.js).
    "media-src 'self' blob: data:",
    `connect-src 'self' ${apiOrigin} https://www.googleapis.com https://api.github.com`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'atlas-csp',
    apply: 'build',
    transformIndexHtml: () => [{
      tag: 'meta', injectTo: 'head-prepend',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
    }],
  }
}

export default defineConfig(({ mode }) => ({
  base: '/atlas/',
  plugins: [
    contentSecurityPolicy(loadEnv(mode, process.cwd(), '').VITE_API_URL || process.env.VITE_API_URL),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/192.png', 'icons/512.png'],
      manifest: {
        name: 'Atlas',
        short_name: 'Atlas',
        description: 'Your personal operating system',
        theme_color: '#f6f2ea',
        background_color: '#efeae0',
        display: 'standalone',
        start_url: '/atlas/',
        scope: '/atlas/',
        icons: [
          { src: '/atlas/icons/192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable any' },
          { src: '/atlas/icons/512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable any' },
        ],
      },
      workbox: {
        // Shows inbox notifications and opens the item when one is tapped.
        importScripts: ['push-sw.js'],
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
}))
