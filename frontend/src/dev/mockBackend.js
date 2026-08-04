/**
 * A backend stand-in for rendering the app with no API reachable.
 *
 * This exists for the coding agent's sandbox, which sits on `sandbox_net` with
 * no route to `api` by design. Without it every context's mount fetch rejects,
 * which does not break rendering — the contexts all initialise to empty state —
 * but does fill the browser console with failures. `render-probe` reports
 * console errors as a signal, so leaving them there would mean every run looks
 * broken and the signal gets ignored.
 *
 * Each route returns exactly the shape its context initialises to, so a page
 * renders its real empty state. Nothing here invents content: no fake habits,
 * no sample transactions. The point is to measure layout, and placeholder data
 * would make the measurements describe a page that does not exist.
 */

const EMPTY = {
  '/api/habits': [],
  '/api/todos': [],
  '/api/goals': [],
  '/api/notes': [],
  '/api/calendar': [],
  // pots/transactions/accounts destructured directly — must all be present.
  '/api/finances': { pots: [], transactions: [], accounts: [] },
  // Absent `github` and `gcal` keys read as "not connected".
  '/api/integrations': {},
  '/assistant/runs': { runs: [] },
}

export function bodyFor(pathname) {
  if (pathname in EMPTY) return EMPTY[pathname]
  // /api/todos/outcomes/2026-W32 — the context reads `.text` off this.
  if (pathname.startsWith('/api/todos/outcomes/')) return { text: '' }
  // Sub-resources of a known collection (/api/finances/pots, …).
  const parent = Object.keys(EMPTY).find(p => pathname.startsWith(p + '/'))
  if (parent) return Array.isArray(EMPTY[parent]) ? [] : {}
  return []
}

let installed = false

export function installMockBackend() {
  if (installed) return
  installed = true

  const apiOrigin = new URL(
    import.meta.env.VITE_API_URL || 'http://localhost:8000',
    window.location.origin,
  ).origin
  const realFetch = window.fetch.bind(window)

  window.fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === 'string' ? input : input.url,
      window.location.origin,
    )
    // Anything not aimed at the API — Vite's own HMR, module requests — has to
    // go through untouched or the dev server stops working.
    if (url.origin !== apiOrigin) return realFetch(input, init)

    const method = (init.method || 'GET').toUpperCase()
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

    if (method === 'GET') return json(bodyFor(url.pathname))
    if (method === 'DELETE') return json({ ok: true })

    // Writes echo back what was sent with an id attached, which is close enough
    // to the real routers for a page to re-render after an optimistic update.
    let sent = {}
    try {
      sent = init.body ? JSON.parse(init.body) : {}
    } catch {
      sent = {}
    }
    return json({ id: `mock-${Math.random().toString(36).slice(2, 10)}`, ...sent }, 201)
  }

  // eslint-disable-next-line no-console
  console.info('[mock] API responses are stubbed — VITE_MOCK_AUTH is on.')
}
