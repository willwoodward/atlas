#!/usr/bin/env node
/**
 * Measure a rendered page, so layout can be checked instead of guessed.
 *
 * A build passing and a file parsing say nothing about whether an element
 * landed where it was meant to. This renders a page in a real browser at a real
 * viewport and reports geometry as JSON — numbers a text-only agent can assert
 * against, rather than a picture it has to have an opinion about.
 *
 * Usage:
 *   render-probe --file harness.html --width 390 --measure "header,.avatar,#label"
 *   render-probe --url http://localhost:5199/harness.html --measure "header"
 *
 * Every measured element also gets checked for overlap with the others and for
 * spilling outside the viewport, because those are the failures that look fine
 * in a diff.
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// Imported dynamically so a sandbox built without the browser fails with an
// explanation instead of a module-resolution stack trace.
let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.error(
    'render-probe: no browser in this sandbox. It was built with ' +
    'INSTALL_BROWSER=0. Rebuild the sandbox image with INSTALL_BROWSER=1 to ' +
    'enable layout checking, or verify this change another way.'
  )
  process.exit(3)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (!args.file && !args.url) {
  console.error('render-probe: need --file <path.html> or --url <http://...>')
  console.error('optional: --width 390 --height 844 --measure "sel1,sel2" --wait 300')
  process.exit(2)
}

const width = Number(args.width) || 390
const height = Number(args.height) || 844
const waitMs = Number(args.wait) || 300
const selectors = String(args.measure || 'body')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const target = args.url || pathToFileURL(resolve(String(args.file))).href

// --no-sandbox: there are no user namespaces inside this container, and the
// container is itself the isolation boundary, so Chromium's own sandbox is both
// unavailable and redundant here.
const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
})

let exitCode = 0
try {
  const page = await browser.newPage({ viewport: { width, height } })
  const consoleErrors = []
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', err => consoleErrors.push(String(err).slice(0, 300)))

  const response = await page.goto(target, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(waitMs)

  const result = await page.evaluate(sels => {
    const round = n => Math.round(n * 10) / 10
    const nodes = new Map()
    const measured = sels.map(selector => {
      const el = document.querySelector(selector)
      if (!el) return { selector, found: false }
      nodes.set(selector, el)
      const r = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return {
        selector,
        found: true,
        x: round(r.x), y: round(r.y),
        width: round(r.width), height: round(r.height),
        right: round(r.right), bottom: round(r.bottom),
        centerX: round(r.x + r.width / 2), centerY: round(r.y + r.height / 2),
        // An element can be laid out perfectly and still be invisible.
        visible: style.visibility !== 'hidden' && style.display !== 'none' &&
                 Number(style.opacity) > 0 && r.width > 0 && r.height > 0,
        text: (el.textContent || '').trim().slice(0, 80),
      }
    })

    // Overlap is the failure mode geometry alone hides: two elements can both
    // be "in the right place" and still sit on top of each other.
    const overlaps = []
    const present = measured.filter(m => m.found && m.visible)
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const a = present[i], b = present[j]
        // A container always encloses its children. Reporting that as an
        // overlap buries the real collisions in noise, and a section that is
        // mostly noise gets ignored.
        const ea = nodes.get(a.selector), eb = nodes.get(b.selector)
        if (ea.contains(eb) || eb.contains(ea)) continue
        const w = Math.min(a.right, b.right) - Math.max(a.x, b.x)
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)
        if (w > 0.5 && h > 0.5) {
          overlaps.push({ a: a.selector, b: b.selector, width: round(w), height: round(h) })
        }
      }
    }

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      elements: measured,
      overlaps,
    }
  }, selectors)

  result.url = target
  result.status = response ? response.status() : null
  result.consoleErrors = consoleErrors

  const missing = result.elements.filter(e => !e.found).map(e => e.selector)
  if (missing.length) {
    result.warning = `Not found in the page: ${missing.join(', ')}`
    exitCode = 1
  }

  console.log(JSON.stringify(result, null, 2))
} catch (err) {
  console.log(JSON.stringify({ error: String(err).slice(0, 500), url: target }, null, 2))
  exitCode = 1
} finally {
  await browser.close()
}

process.exit(exitCode)
