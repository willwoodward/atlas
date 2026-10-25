// Settings live in ~/.atlas-helper/config.json (made on first run). The
// browser profile Atlas uses sits next to it, in profile/.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DIR = process.env.ATLAS_HELPER_DIR || path.join(os.homedir(), '.atlas-helper')
export const CONFIG_PATH = path.join(DIR, 'config.json')

const TEMPLATE = {
  server: 'https://willwoodward-clan-manager.duckdns.org',
  key: 'paste BROWSER_HELPER_KEY from the server .env.production here',
  // The only sites Atlas can open. Subdomains are included
  // (irishrail.ie covers booking.cf.irishrail.ie).
  sites: ['irishrail.ie', 'thetrainline.com', 'lner.co.uk'],
  browser: {
    // Leave both empty to use Playwright's own Chromium (npx playwright install chromium).
    channel: '',
    executablePath: '',
    // true shows the browser while Atlas works (handy to watch it the first few times).
    visible: false,
  },
}

export function loadConfig() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 })
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(TEMPLATE, null, 2) + '\n', { mode: 0o600 })
    return { created: true }
  }
  const file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const env = process.env
  const cfg = {
    server: (env.ATLAS_URL || file.server || '').replace(/\/+$/, ''),
    key: env.ATLAS_HELPER_KEY || file.key || '',
    sites: (env.ATLAS_HELPER_SITES ? env.ATLAS_HELPER_SITES.split(',') : file.sites || []).map(s => s.trim()).filter(Boolean),
    browser: { ...TEMPLATE.browser, ...(file.browser || {}) },
    profileDir: path.join(DIR, 'profile'),
  }
  const problems = []
  if (!/^https:\/\//.test(cfg.server) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cfg.server)) problems.push('"server" must be an https:// address')
  if (!cfg.key || cfg.key.startsWith('paste ')) problems.push('"key" is not set')
  if (!cfg.sites.length) problems.push('"sites" is empty, so Atlas could open nothing')
  return { cfg, problems }
}
