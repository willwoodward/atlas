// Drives a real (headless) Chromium against small fake booking pages.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Browser, Refused } from '../src/browser.js'

let server, base, frameBase, browser

const page = (body, title = 'Test') => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`

const PAGES = {
  '/search': page(`
    <h1>Find trains</h1>
    <label for="from">From</label><input id="from" name="from">
    <ul id="sugg" role="listbox"></ul>
    <label>Time <select name="when"><option>Now</option><option>All day</option></select></label>
    <button onclick="location.href='/results?from='+encodeURIComponent(document.getElementById('from').value)">Search</button>
    <script>
      from.addEventListener('input', () => {
        sugg.innerHTML = from.value.length > 2 ? '<li role="option" onclick="from.value=this.textContent;sugg.innerHTML=\\'\\'">Dublin Heuston</li>' : ''
      })
    </script>`, 'Search'),
  '/results': page(`
    <h2>Dublin Heuston to Galway</h2>
    <div>09:25 → 11:50 · Direct</div>
    <button onclick="location.href='/checkout'">Select €14.99</button>
    <a href="https://evil.example/steal">Special offer</a>
    <div class="seat" style="cursor:pointer;width:30px;height:30px" aria-label="Seat 12A, facing forward" onclick="this.dataset.picked=1"></div>`, 'Results'),
  '/checkout': page(`
    <form onsubmit="event.preventDefault()">
      <label>First name <input name="first-name"></label>
      <label>Email address <input type="email" name="email"></label>
      <label>Card number <input name="cardnumber" autocomplete="cc-number" value="4111111111111111"></label>
      <label>Password <input type="password" name="pw"></label>
      <button type="button">Next step</button>
      <button type="submit">Pay now</button>
    </form>
    <iframe src="FRAME/card" width="300" height="80"></iframe>`, 'Checkout'),
  '/card': page('<label>Card number <input name="pan" value="SECRET-IN-FRAME"></label>'),
}

before(async () => {
  server = http.createServer((req, res) => {
    const html = PAGES[req.url.split('?')[0]]
    if (!html) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html.replace('FRAME', frameBase))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  base = `http://127.0.0.1:${port}`
  frameBase = `http://localhost:${port}` // another host: not an allowed site
  browser = new Browser({
    sites: ['127.0.0.1'],
    allowHttpLocal: true,
    headless: true,
    profileDir: fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-helper-test-')),
    executablePath: process.env.CHROMIUM_PATH || undefined,
  })
})

after(async () => {
  await browser?.shutdown()
  server?.close()
})

const ref = (snap, pattern) => {
  const line = snap.snapshot.split('\n').find(l => pattern.test(l))
  assert.ok(line, `no line matching ${pattern} in:\n${snap.snapshot}`)
  return /\[(\w+)\]/.exec(line)[1]
}

test('a booking flow: search, suggestion, select, results', async () => {
  let s = await browser.run('open', { url: `${base}/search` })
  assert.equal(s.site, '127.0.0.1')
  assert.match(s.snapshot, /# Find trains/)
  assert.match(s.snapshot, /select "Time".*options: Now \| All day/)

  s = await browser.run('type', { ref: ref(s, /textbox "From"/), text: 'Dub' })
  s = await browser.run('click', { ref: ref(s, /option "Dublin Heuston"/) })
  assert.match(s.snapshot, /textbox "From" \(value "Dublin Heuston"\)/)
  s = await browser.run('select', { ref: ref(s, /select "Time"/), option: 'All day' })
  assert.match(s.snapshot, /selected "All day"/)

  s = await browser.run('click', { ref: ref(s, /button "Search"/) })
  assert.match(s.url, /\/results\?from=Dublin%20Heuston/)
  assert.match(s.snapshot, /09:25 → 11:50/)
  // A div seat with only a pointer cursor is still something Atlas can click.
  assert.match(s.snapshot, /clickable "Seat 12A, facing forward"/)
})

test('leaving the allowed sites is blocked', async () => {
  let s = await browser.run('open', { url: `${base}/results` })
  s = await browser.run('click', { ref: ref(s, /link "Special offer"/) })
  assert.match(s.url, /\/results$/)
  assert.match(s.notices.join(' '), /Blocked a jump to evil\.example/)
  await assert.rejects(browser.run('open', { url: 'https://evil.example/' }), Refused)
})

test('checkout: details yes, card / password / pay no, payment frame unseen', async () => {
  let s = await browser.run('open', { url: `${base}/checkout` })
  assert.doesNotMatch(s.snapshot, /4111/)
  assert.match(s.snapshot, /textbox "Card number" \(value hidden/)
  assert.doesNotMatch(s.snapshot, /SECRET-IN-FRAME/)

  s = await browser.run('type', { ref: ref(s, /textbox "First name"/), text: 'Will' })
  assert.match(s.snapshot, /value "Will"/)

  await assert.rejects(browser.run('type', { ref: ref(s, /textbox "Card number"/), text: '1' }), /card/)
  await assert.rejects(browser.run('type', { ref: ref(s, /textbox "Password"/), text: 'x' }), /password/)
  await assert.rejects(browser.run('click', { ref: ref(s, /button "Pay now"/) }), /pays/)
  await assert.rejects(browser.run('type', { ref: ref(s, /textbox "Email address"/), text: 'a@b.c', submit: true }), /submit/)
  await browser.run('click', { ref: ref(s, /button "Next step"/) })
})

test('screenshots, and a handed-over page is off limits', async () => {
  let s = await browser.run('open', { url: `${base}/checkout` })
  const shot = await browser.run('screenshot', {})
  assert.equal(shot.mime, 'image/jpeg')
  assert.ok(Buffer.from(shot.screenshot, 'base64').length > 1000)

  const h = await browser.run('handoff', { summary: '09:25 Heuston → Galway, €14.99' })
  assert.equal(h.ok, true)
  await assert.rejects(browser.run('snapshot'), /No page is open/)
  // Atlas can start afresh in a new tab; the handed-over one stays the user's.
  s = await browser.run('open', { url: `${base}/search` })
  assert.match(s.url, /\/search$/)
})

test('stale refs and unknown commands are explained', async () => {
  await browser.run('open', { url: `${base}/search` })
  await assert.rejects(browser.run('click', { ref: 'e999' }), /changed/)
  await assert.rejects(browser.run('click', { ref: 'body' }), /isn't a ref/)
  await assert.rejects(browser.run('press', { key: 'Control+A' }), /Can't press/)
  await assert.rejects(browser.run('evaluate', {}), /Unknown command/)
})
