// The rules the helper enforces whatever Atlas asks. They live here, on the
// laptop, so they hold even if the server or the model is compromised, and
// even if a web page talks the model into something.
//
// - Only the sites the user listed in the helper's config open, plus any
//   Atlas asks for that the user approves in a window on this laptop.
// - Card, bank and password fields are never typed into (logins and paying
//   are the user's).
// - Pay / place-order buttons are never pressed.

/** The allowed site a URL belongs to ("irishrail.ie" for booking.cf.irishrail.ie), or null. */
export function siteFor(url, sites, { allowHttpLocal = false } = {}) {
  let u
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  const local = host === 'localhost' || host === '127.0.0.1'
  if (u.protocol !== 'https:' && !(allowHttpLocal && local && u.protocol === 'http:')) return null
  for (const raw of sites) {
    const site = String(raw).toLowerCase().trim().replace(/^\*\./, '').replace(/^www\./, '')
    if (site && (host === site || host.endsWith('.' + site))) return site
  }
  return null
}

// Endings that cover a whole country's worth of unrelated sites. Allowing
// "co.uk" would allow every .co.uk website, so a request for one is refused.
const SHARED_ENDINGS = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.in', 'co.za', 'com.br', 'com.cn', 'com.hk', 'com.sg', 'com.mx',
])

/**
 * Turn what Atlas asked for ("https://www.ryanair.com/ie/en", "ryanair.com")
 * into the site to allow, or say why not. Only plain registered names are
 * accepted: no addresses, no bare endings like "com", no look-alike
 * international characters (a safe-looking name made of other alphabets).
 */
export function requestedSite(input) {
  const raw = String(input ?? '').trim().toLowerCase()
  if (!raw || raw.length > 253) return { error: 'Name the website, like ryanair.com.' }
  let host
  try { host = new URL(/^[a-z]+:\/\//.test(raw) ? raw : `https://${raw}`).hostname } catch { return { error: `"${raw.slice(0, 60)}" isn't a website name.` } }
  host = host.replace(/\.$/, '').replace(/^www\./, '')
  if (/^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost') return { error: 'Only website names are accepted, not addresses.' }
  if (host.split('.').some(l => l.startsWith('xn--')) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) {
    return { error: 'That name has unusual characters, so it can only be added by the user in the helper\'s config.' }
  }
  if (SHARED_ENDINGS.has(host)) return { error: `"${host}" is a whole group of unrelated sites. Name the specific one.` }
  return { site: host }
}

// Words in a field's name, label or hints that mean card, bank or login details.
const SENSITIVE_TEXT = /card.?(number|no\b|num)|cc.?(num|number|csc|exp)|\bcvv|\bcvc|\bcsc\b|security.?code|expir|exp.?(date|month|year)|name.?on.?card|card.?holder|\biban\b|\bbic\b|swift|sort.?code|account.?(number|no\b)|\bpin\b|password|passcode/i

/**
 * Is this a field Atlas must not type into? `field` describes the element:
 * { tag, type, autocomplete, name, id, label, placeholder, aria }.
 */
export function sensitiveField(field) {
  if (!field) return null
  const type = String(field.type || '').toLowerCase()
  if (type === 'password') return 'a password field'
  const ac = String(field.autocomplete || '').toLowerCase()
  if (/\bcc-|\bcard|csc|current-password|new-password|one-time-code/.test(ac)) return 'a card or login field'
  const words = [field.name, field.id, field.label, field.placeholder, field.aria].filter(Boolean).join(' ')
  if (SENSITIVE_TEXT.test(words)) return 'a card, bank or login field'
  return null
}

// Button wording that completes a purchase. Deliberately broad: a false
// "no" just means handing over a step early.
const PAYMENT_TEXT = /\bpay\b|\bpay now\b|\bpayment\b|place (my |your |the )?order|\bpurchase\b|\bbuy now\b|complete (my |your |the )?(booking|purchase|order|payment)|confirm (and|&) pay|confirm (booking and |and )?payment|submit (order|payment)|\bcheckout and pay\b/i

/** Is this a button that pays? `el` = { text, aria, value, title }. */
export function paymentAction(el) {
  if (!el) return false
  const words = [el.text, el.aria, el.value, el.title].filter(Boolean).join(' ').replace(/\s+/g, ' ')
  return PAYMENT_TEXT.test(words)
}

export const KEYS = new Set(['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Space', 'Backspace'])

export const SENSITIVE_SOURCE = SENSITIVE_TEXT.source
