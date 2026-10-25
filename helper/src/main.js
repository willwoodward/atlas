#!/usr/bin/env node
// Atlas browser helper. Connects out to the Atlas server (no ports open on
// this machine), runs the browser commands Atlas sends, one at a time, and
// logs each one to ~/.atlas-helper/helper.log. Ctrl+C stops it.

import fs from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'
import { Browser, Refused } from './browser.js'
import { loadConfig, CONFIG_PATH, DIR } from './config.js'

const VERSION = '0.1.0'
const logFile = path.join(DIR, 'helper.log')

function log(line) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
  console.log(`${stamp}  ${line}`)
  try { fs.appendFileSync(logFile, `${stamp}  ${line}\n`) } catch { /* logging never stops the helper */ }
}

// What each command looks like in the log (typed text is left out).
function describe(cmd, a = {}) {
  if (cmd === 'open') return `open ${a.url}`
  if (cmd === 'type') return `type ${String(a.text ?? '').length} characters into ${a.ref}${a.submit ? ' + Enter' : ''}`
  if (cmd === 'handoff') return 'hand over to you'
  return [cmd, a.ref, a.key, a.option, a.direction].filter(Boolean).join(' ')
}

const { cfg, problems, created } = loadConfig()
if (created) {
  console.log(`Made ${CONFIG_PATH}.\nPut the server's BROWSER_HELPER_KEY in it (and check the allowed sites), then run this again.`)
  process.exit(1)
}
if (problems.length) {
  console.log(`Fix ${CONFIG_PATH}:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}

const browser = new Browser({
  sites: cfg.sites,
  profileDir: cfg.profileDir,
  visible: !!cfg.browser.visible,
  // No window at all (servers, tests). Handing over then can't show the page.
  headless: !!cfg.browser.headless,
  channel: cfg.browser.channel,
  executablePath: cfg.browser.executablePath,
  log,
})

const url = cfg.server.replace(/^http/, 'ws') + '/api/browser/helper'
let ws = null
let delay = 1000
let queue = Promise.resolve()

function connect() {
  ws = new WebSocket(url, { headers: { Authorization: `Bearer ${cfg.key}` }, handshakeTimeout: 15000 })
  let ping = null

  ws.on('open', () => {
    delay = 1000
    log(`Connected to ${cfg.server}. Allowed sites: ${cfg.sites.join(', ')}`)
    ws.send(JSON.stringify({ type: 'hello', version: VERSION, sites: cfg.sites }))
    ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' })) }, 25000)
  })

  ws.on('message', raw => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (!msg.id || typeof msg.cmd !== 'string') return
    const args = msg.args && typeof msg.args === 'object' ? msg.args : {}
    // One command at a time, in order.
    queue = queue.then(async () => {
      log(describe(msg.cmd, args))
      let reply
      try {
        reply = { id: msg.id, ok: true, result: await browser.run(msg.cmd, args) }
      } catch (e) {
        const refused = e instanceof Refused
        log(`  ${refused ? 'refused' : 'failed'}: ${e.message.split('\n')[0]}`)
        reply = { id: msg.id, ok: false, error: refused ? e.message : `The browser hit an error: ${e.message.split('\n')[0]}` }
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply))
    })
  })

  ws.on('close', (code) => {
    clearInterval(ping)
    if (code === 4000) log('Another helper connected to Atlas; this one is standing by.')
    const wait = code === 4000 ? 60000 : delay
    delay = Math.min(delay * 2, 30000)
    setTimeout(connect, wait)
  })

  ws.on('unexpected-response', (_req, res) => {
    log(`Atlas refused the connection (${res.statusCode}). Is the key right?`)
  })
  ws.on('error', e => log(`Connection problem: ${e.message}`))
}

process.on('SIGINT', async () => { log('Stopping'); await browser.shutdown(); process.exit(0) })
process.on('SIGTERM', async () => { await browser.shutdown(); process.exit(0) })

log(`Atlas browser helper ${VERSION}`)
connect()
