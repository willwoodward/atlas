// The browser Atlas drives: a separate Chromium profile (none of the user's
// own cookies, passwords or cards), kept off-screen while Atlas works and
// brought on-screen when it hands a page over.
//
// Every command checks the rules in policy.js first. A page that has been
// handed over is the user's: Atlas can't touch it again.

import { chromium } from 'playwright'
import { siteFor, sensitiveField, paymentAction, KEYS, SENSITIVE_SOURCE } from './policy.js'
import { readPage, describeElement } from './snapshot.js'

const SNAPSHOT_MAX = 14000
const OFFSCREEN = ['--window-position=-2400,-2400', '--window-size=1366,900']
const IDLE_CLOSE_MS = 10 * 60 * 1000

export class Refused extends Error {}

export class Browser {
  /**
   * opts: { sites, profileDir, headless, visible, executablePath, channel,
   *         allowHttpLocal (tests only), log }
   */
  constructor(opts) {
    this.opts = opts
    this.sites = opts.sites
    this.context = null
    this.page = null
    this.handedOver = new WeakSet()
    this.notices = []
    this.idleTimer = null
    this.log = opts.log || (() => {})
  }

  site(url) { return siteFor(url, this.sites, { allowHttpLocal: this.opts.allowHttpLocal }) }

  async ensure() {
    if (this.context) return
    const { headless = false, visible = false, executablePath, channel, profileDir } = this.opts
    this.context = await this.launch(profileDir, { headless, visible, executablePath, channel })
    this.context.on('close', () => { this.context = null; this.page = null })
    await this.guard()
  }

  async launch(profileDir, { headless, visible, executablePath, channel }) {
    try {
      return await this.launchWith(profileDir, { headless, visible, executablePath, channel })
    } catch (e) {
      // A browser that can't open a window dies at once with this vague error.
      // On WSL that's usually its graphics needing a restart.
      if (!headless && /has been closed/.test(e.message)) {
        this.log('The browser crashed opening its window. On WSL, run "wsl --shutdown" in Windows PowerShell, then start the helper again.')
        throw new Error("The browser on the user's laptop can't open a window right now (on WSL the fix is restarting it: wsl --shutdown). Tell the user; nothing was done.")
      }
      throw e
    }
  }

  launchWith(profileDir, { headless, visible, executablePath, channel }) {
    return chromium.launchPersistentContext(profileDir, {
      headless,
      executablePath: executablePath || undefined,
      channel: channel || undefined,
      args: headless || visible ? [] : OFFSCREEN,
      viewport: { width: 1366, height: 900 },
      acceptDownloads: false,
      locale: 'en-GB',
    })
  }

  async guard() {
    // Leaving the allowed sites: the page itself (main frame) may only go to
    // them while Atlas has it. Embedded frames (a payment provider's card
    // form) still load — Atlas can't see or use them, the user can.
    await this.context.route('**/*', (route, req) => {
      const frame = req.frame()
      const top = frame && frame === frame.page().mainFrame()
      const page = frame?.page()
      if (req.isNavigationRequest() && top && !this.handedOver.has(page) && !this.site(req.url()) && !req.url().startsWith('about:')) {
        this.notices.push(`Blocked a jump to ${new URL(req.url()).hostname}: not one of the allowed sites.`)
        return route.abort('blockedbyclient')
      }
      return route.continue()
    })
    this.context.on('page', p => this.watch(p))
    for (const p of this.context.pages()) this.watch(p)
  }

  watch(p) {
    p.on('dialog', d => { this.notices.push(`The page showed a message: "${d.message().slice(0, 200)}" (dismissed).`); d.dismiss().catch(() => {}) })
    // A pop-up (new tab) opened by the page Atlas is using becomes the page it uses.
    p.on('popup', np => { if (!this.handedOver.has(np)) this.page = np })
    p.on('close', () => { if (this.page === p) this.page = null })
  }

  touch() {
    clearTimeout(this.idleTimer)
    // Free the memory when Atlas hasn't used it for a while, unless the user
    // has a handed-over page open.
    this.idleTimer = setTimeout(async () => {
      if (!this.context) return
      if (this.context.pages().some(p => this.handedOver.has(p))) return
      this.log('Idle: closing the browser')
      await this.context.close().catch(() => {})
    }, IDLE_CLOSE_MS)
    this.idleTimer.unref?.()
  }

  current() {
    const p = this.page
    if (!p || p.isClosed()) throw new Refused('No page is open. Use browser_open first.')
    if (this.handedOver.has(p)) throw new Refused('You handed this page to the user; it is theirs now. Open a new one to keep working.')
    return p
  }

  async settle(p) {
    await p.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
    // A blocked jump leaves Chrome's error page behind: go back to where it was.
    if (p.url().startsWith('chrome-error://')) {
      await p.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})
    }
    await p.waitForLoadState('networkidle', { timeout: 3500 }).catch(() => {})
    await p.waitForTimeout(250)
  }

  // Frames Atlas may read and use: the page, and frames from allowed sites.
  frames(p) {
    return p.frames().filter((f, i) => i === 0 || (f.url() && this.site(f.url())))
  }

  async snapshot(p = this.current()) {
    const parts = []
    let shortened = false
    const frames = this.frames(p)
    for (const [i, f] of frames.entries()) {
      const prefix = i === 0 ? '' : `f${i}`
      try {
        const r = await f.evaluate(readPage, { prefix, max: Math.floor(SNAPSHOT_MAX / (i === 0 ? 1 : 3)), sensitive: SENSITIVE_SOURCE })
        shortened ||= r.shortened
        parts.push(i === 0 ? r.text : `[frame ${f.url().slice(0, 80)}]\n${r.text}`)
      } catch { /* a frame navigating away mid-read */ }
    }
    this.lastRefs = parseRefs(parts.join('\n'))
    const notices = this.notices.splice(0)
    return {
      url: p.url(),
      site: this.site(p.url()),
      title: await p.title().catch(() => ''),
      ...(notices.length ? { notices } : {}),
      snapshot: parts.join('\n\n') + (shortened ? '\n(Long page: some text left out. Every control is listed.)' : ''),
    }
  }

  locate(ref) {
    const p = this.current()
    const m = /^(?:f(\d+))?e\d+$/.exec(String(ref || ''))
    if (!m) throw new Refused(`"${ref}" isn't a ref. Use one from the latest snapshot, like e12.`)
    const frame = this.frames(p)[m[1] ? Number(m[1]) : 0]
    if (!frame) throw new Refused(`No element ${ref}: the page changed. Take a new snapshot.`)
    return { p, el: frame.locator(`[data-atlas-ref="${ref}"]`).first() }
  }

  // An element by ref, or by what it is: { role, name, match, nth } — how
  // workflows find things again on a fresh page.
  async pick(args) {
    let ref = args.ref
    if (!ref && args.target) {
      // Things often appear a moment after the step before (a suggestions list
      // after typing), so look again for a few seconds before giving up.
      const deadline = Date.now() + Math.min(Math.max(Number(args.wait ?? 5), 0), 15) * 1000
      for (;;) {
        await this.snapshot()
        ref = findTarget(this.lastRefs, args.target)
        if (ref || Date.now() >= deadline) break
        await this.current().waitForTimeout(500)
      }
      if (!ref) {
        const t = args.target
        throw new Refused(`Not found: no ${t.role || 'element'} ${t.name ? `"${t.name}"` : ''} on the page.`.replace(/\s+/g, ' '))
      }
    }
    const { p, el } = this.locate(ref)
    return { p, el, ref, acted: this.lastRefs?.get(ref) || null }
  }

  async describe(el, ref) {
    if (!(await el.count())) throw new Refused(`No element ${ref} any more: the page changed. Take a new snapshot.`)
    return el.evaluate(describeElement)
  }

  // ── Commands (each returns what goes back to Atlas) ─────────────────────

  async open({ url }) {
    const site = this.site(url)
    if (!site) throw new Refused(`${url} isn't one of the allowed sites (${this.sites.join(', ')}). The user can add sites in the helper's config.`)
    await this.ensure()
    this.touch()
    let p = this.page
    if (!p || p.isClosed() || this.handedOver.has(p)) {
      p = this.context.pages().find(x => x.url() === 'about:blank' && !this.handedOver.has(x)) || await this.context.newPage()
      this.page = p
    }
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await this.settle(p)
    return this.snapshot(p)
  }

  async snapshotCmd() {
    this.touch()
    return this.snapshot()
  }

  async click(args) {
    this.touch()
    const { p, el, ref, acted } = await this.pick(args)
    const d = await this.describe(el, ref)
    if (paymentAction(d)) throw new Refused(`Refused: "${d.text || d.aria || d.value}" looks like it pays. Hand the page to the user with browser_handoff instead.`)
    if (d.submits && d.formFields.some(sensitiveField)) throw new Refused('Refused: that submits a form with card or login details. Hand the page to the user.')
    try {
      await el.click({ timeout: 6000 })
    } catch (e) {
      throw new Refused(clickTrouble(e))
    }
    await this.settle(this.page || p)
    return { acted, ...(await this.snapshot()) }
  }

  async type(args) {
    const { text, submit } = args
    this.touch()
    const { p, el, ref, acted } = await this.pick(args)
    const d = await this.describe(el, ref)
    const why = sensitiveField(d)
    if (why) throw new Refused(`Refused: that's ${why}. The user fills those in themselves after browser_handoff.`)
    if (submit && d.formFields.some(sensitiveField)) throw new Refused('Refused: pressing Enter there would submit card or login details.')
    try {
      await el.click({ timeout: 6000 })
    } catch (e) {
      throw new Refused(clickTrouble(e))
    }
    await el.fill('').catch(() => {})
    // Letter by letter so search-as-you-type boxes react as they would to a person.
    await el.pressSequentially(String(text ?? ''), { delay: 35 })
    if (submit) await el.press('Enter')
    await this.settle(p)
    return { acted, ...(await this.snapshot()) }
  }

  async select(args) {
    const { option } = args
    this.touch()
    const { p, el, ref, acted } = await this.pick(args)
    const d = await this.describe(el, ref)
    if (sensitiveField(d)) throw new Refused('Refused: that is a card or bank field.')
    try {
      await el.selectOption({ label: option }, { timeout: 5000 })
    } catch {
      try { await el.selectOption(option, { timeout: 5000 }) } catch {
        throw new Refused(`No option "${option}" there. The snapshot lists the options.`)
      }
    }
    await this.settle(p)
    return { acted, ...(await this.snapshot()) }
  }

  // Wait for text to appear on the page (a workflow checking it got where it
  // meant to). Case doesn't matter.
  async expect({ text, timeout = 15 }) {
    this.touch()
    const p = this.current()
    const want = String(text || '').toLowerCase()
    try {
      await p.waitForFunction(t => (document.body?.innerText || '').toLowerCase().includes(t), want, { timeout: Math.min(Number(timeout) || 15, 60) * 1000 })
    } catch {
      throw new Refused(`Not found: the page never showed "${text}".`)
    }
    return this.snapshot()
  }

  async press({ key }) {
    this.touch()
    const p = this.current()
    if (!KEYS.has(key)) throw new Refused(`Can't press "${key}". Allowed: ${[...KEYS].join(', ')}.`)
    if (key === 'Enter' || key === 'Space') {
      const focused = await p.evaluateHandle(() => document.activeElement || document.body)
      const d = await focused.asElement()?.evaluate(describeElement).catch(() => null)
      await focused.dispose()
      if (d && (paymentAction(d) || sensitiveField(d) || (key === 'Enter' && d.formFields?.some(sensitiveField)))) {
        throw new Refused('Refused: that would press a pay button or submit card or login details.')
      }
    }
    await p.keyboard.press(key === 'Space' ? ' ' : key)
    await this.settle(this.page || p)
    return this.snapshot()
  }

  async scroll({ direction = 'down', ref }) {
    this.touch()
    if (ref) {
      const { el } = this.locate(ref)
      await el.scrollIntoViewIfNeeded({ timeout: 5000 })
    } else {
      await this.current().mouse.wheel(0, direction === 'up' ? -700 : 700)
    }
    await this.current().waitForTimeout(400)
    return this.snapshot()
  }

  async back() {
    this.touch()
    const p = this.current()
    await p.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
    await this.settle(p)
    return this.snapshot()
  }

  async screenshot({ ref }) {
    this.touch()
    let buf
    if (ref) {
      const { el } = this.locate(ref)
      await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
      buf = await el.screenshot({ type: 'jpeg', quality: 70, timeout: 10000 })
    } else {
      buf = await this.current().screenshot({ type: 'jpeg', quality: 70 })
    }
    return { url: this.current().url(), screenshot: buf.toString('base64'), mime: 'image/jpeg' }
  }

  async handoff({ summary }) {
    const p = this.current()
    this.handedOver.add(p)
    if (this.page === p) this.page = null
    await p.evaluate(showBanner, String(summary || '')).catch(() => {})
    if (!this.opts.headless) await this.reveal(p)
    this.log(`Handed over: ${p.url()}`)
    return {
      ok: true,
      url: p.url(),
      message: this.opts.headless
        ? 'The helper is running without a window, so the user must open the page themselves.'
        : 'The page is open on the user\'s screen with your summary. It is theirs now.',
    }
  }

  async reveal(p) {
    try {
      const s = await this.context.newCDPSession(p)
      const { windowId } = await s.send('Browser.getWindowForTarget')
      await s.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } })
      await s.send('Browser.setWindowBounds', { windowId, bounds: { left: 80, top: 60, width: 1300, height: 900 } })
      await s.detach()
    } catch (e) { this.log(`Couldn't move the window on-screen: ${e.message}`) }
    await p.bringToFront().catch(() => {})
  }

  async close() {
    const p = this.current()
    await p.close()
    this.page = null
    return { ok: true }
  }

  status() {
    return {
      sites: this.sites,
      open: !!this.context,
      url: this.page && !this.page.isClosed() ? this.page.url() : null,
    }
  }

  async shutdown() {
    clearTimeout(this.idleTimer)
    await this.context?.close().catch(() => {})
  }

  /** Run a command by name. Refusals come back as errors Atlas can read. */
  async run(cmd, args = {}) {
    const table = {
      open: () => this.open(args),
      snapshot: () => this.snapshotCmd(),
      click: () => this.click(args),
      type: () => this.type(args),
      select: () => this.select(args),
      press: () => this.press(args),
      scroll: () => this.scroll(args),
      back: () => this.back(),
      screenshot: () => this.screenshot(args),
      handoff: () => this.handoff(args),
      expect: () => this.expect(args),
      close: () => this.close(),
      status: async () => this.status(),
    }
    const fn = table[cmd]
    if (!fn) throw new Refused(`Unknown command "${cmd}".`)
    return fn()
  }
}

// The refs in a snapshot and what each one is: `[e12] button "Book Tickets" (…)`.
export function parseRefs(text) {
  const refs = new Map()
  for (const line of String(text).split('\n')) {
    const m = /^\[(\w+)\] (\S+) "(.*?)"(?: \((?:[^()]|\([^)]*\))*\))?$/.exec(line.trim())
    if (m) refs.set(m[1], { role: m[2], name: m[3] })
  }
  return refs
}

const ROLE_ALIASES = { select: ['select', 'combobox', 'listbox'], combobox: ['select', 'combobox'], textbox: ['textbox', 'searchbox'] }

/**
 * The ref of the element a workflow step means. Name matching: exact (case
 * aside) beats "contains"; match "regex" for a pattern. nth picks among
 * several matches (0 = first).
 */
export function findTarget(refs, target) {
  if (!refs) return null
  const roles = target.role ? (ROLE_ALIASES[target.role] || [target.role]) : null
  const want = String(target.name ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  const all = [...refs.entries()].filter(([, r]) => !roles || roles.includes(r.role))
  let hits
  if (target.match === 'regex') {
    let re
    try { re = new RegExp(target.name, 'i') } catch { return null }
    hits = all.filter(([, r]) => re.test(r.name))
  } else {
    const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim()
    const exact = all.filter(([, r]) => norm(r.name) === want)
    hits = exact.length || target.match === 'exact' ? exact : all.filter(([, r]) => norm(r.name).includes(want))
  }
  const hit = hits[Number(target.nth) || 0]
  return hit ? hit[0] : null
}

// Why a click didn't happen, in words Atlas can act on (Playwright's log
// says what was in the way; "timeout" alone just makes it retry blindly).
export function clickTrouble(e) {
  const log = String(e?.message || '')
  const line = log.split('\n').find(l => /intercepts pointer events/.test(l)) || ''
  const what = line ? (/class="([^"]{1,60})"/.exec(line)?.[1] || /<([a-z0-9-]+)/i.exec(line)?.[1] || 'another element') : null
  if (what || /intercepts pointer events/.test(log)) {
    return `Couldn't click it: something is covering it (${what || 'another element'}), probably a pop-up, banner or message. ` +
      'Take a snapshot: look for a [dialog] or a message and close or deal with it first.'
  }
  if (/not visible/.test(log)) return "Couldn't click it: it isn't visible. Scroll to it (browser_scroll with its ref) or open the section it's in."
  if (/not enabled|disabled/.test(log)) return "Couldn't click it: it's disabled. Something on the form probably still needs filling in or choosing."
  if (/not stable/.test(log)) return "Couldn't click it: it kept moving (still animating). Try again, or take a snapshot."
  return `Couldn't click it within 6 seconds (${log.split('\n')[0].slice(0, 120)}). Take a snapshot to see what the page is showing.`
}

// Shown at the top of a handed-over page (runs in the page).
function showBanner(summary) {
  const bar = document.createElement('div')
  bar.setAttribute('style', 'position:fixed;z-index:2147483647;left:12px;right:12px;bottom:12px;padding:14px 16px;border-radius:12px;'
    + 'background:#2b2820;color:#fffdf9;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);white-space:pre-wrap')
  const head = document.createElement('div')
  head.setAttribute('style', 'font-weight:600;margin-bottom:4px')
  head.textContent = 'Atlas filled this in. Check everything, then pay yourself. Atlas no longer controls this tab.'
  const body = document.createElement('div')
  body.textContent = summary
  const x = document.createElement('button')
  x.textContent = 'Dismiss'
  x.setAttribute('style', 'margin-top:8px;background:#c15f3c;color:#fff;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit')
  x.onclick = () => bar.remove()
  bar.append(head, body, x)
  document.body.appendChild(bar)
}
