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
    // The wake word's recogniser runs in a worker loaded from its own file
    // (voskWorkerFile below), not from a blob:.
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

// The wake word's recogniser (vosk-browser) ships its worker as base64 and
// starts it from a blob: URL. A blob: worker runs under this page's CSP, which
// (rightly) has no 'unsafe-eval', and the worker's WebAssembly glue needs it.
// So for the build, the worker is written out as a file of its own and started
// from there: a worker loaded from a file gets its policy from that file's
// response, and the page keeps its strict one. The worker only ever sees audio
// samples and the model; it can't touch the page.
function voskWorkerFile() {
  return {
    name: 'atlas-vosk-worker-file',
    apply: 'build',
    transform(code, id) {
      if (!/vosk-browser[\\/]dist[\\/]vosk\.js$/.test(id)) return null
      const m = /createBase64WorkerFactory\('([A-Za-z0-9+/=]+)', null, false\)/.exec(code)
      if (!m) this.error('vosk-browser changed: its worker factory call was not found')
      const source = Buffer.from(m[1], 'base64').toString('utf8')
      const body = source.substring(source.indexOf('\n', 10) + 1)   // as createURL does
      const ref = this.emitFile({ type: 'asset', name: 'vosk-worker.js', source: body })
      return {
        code: code.replace(m[0], `(function () { return function WorkerFactory(options) { return new Worker(import.meta.ROLLUP_FILE_URL_${ref}, options) } })()`),
        map: null,
      }
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: '/atlas/',
  plugins: [
    voskWorkerFile(),
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
        // The wake word's recogniser (vosk-browser, ~6 MB) is only fetched by
        // devices that switch "Hey Atlas" on, then kept (the rule below).
        globIgnores: ['**/vosk-*.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/vosk-[\w-]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'atlas-wake-engine', expiration: { maxEntries: 4 } },
          },
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
