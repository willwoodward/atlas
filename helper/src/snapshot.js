// Runs inside the web page (passed to frame.evaluate, so it must be
// self-contained). Turns the page into text Atlas can read: the visible text
// in order, and every element it can use tagged with a ref like e12, which
// the actions then find again by the data-atlas-ref attribute.
//
// Values of card, bank and password fields are never included.

export function readPage({ prefix, max, sensitive }) {
  const SENSITIVE = new RegExp(sensitive, 'i')
  const ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'tab', 'option', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'switch', 'combobox', 'textbox', 'searchbox', 'listbox', 'slider', 'spinbutton', 'treeitem', 'gridcell'])
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'svg', 'HEAD', 'META', 'LINK', 'IFRAME'])
  const CONTROLS = 'a[href],button,input,select,textarea,[role=button],[role=link],[role=option],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=gridcell],[tabindex]'
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim()
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

  for (const el of document.querySelectorAll('[data-atlas-ref]')) el.removeAttribute('data-atlas-ref')

  const shown = el => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 || r.height > 0 || s.display === 'contents'
  }

  const labelText = el => {
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const t = by.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ')
      if (clean(t)) return clean(t)
    }
    if (el.labels?.length) return clean([...el.labels].map(l => ownText(l, el)).join(' '))
    return ''
  }
  // A label's text without the control inside it (a <select>'s options, say).
  const ownText = (label, el) => {
    if (!label.contains(el)) return label.innerText
    const copy = label.cloneNode(true)
    copy.querySelectorAll('input,select,textarea,button').forEach(c => c.remove())
    return copy.textContent
  }

  const roleOf = el => {
    const r = (el.getAttribute('role') || '').toLowerCase()
    if (ROLES.has(r)) return r
    const tag = el.tagName
    if (tag === 'A' && el.hasAttribute('href')) return 'link'
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button'
    if (tag === 'SELECT') return 'select'
    if (tag === 'TEXTAREA') return 'textbox'
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase()
      if (t === 'hidden') return null
      if (t === 'checkbox' || t === 'radio') return t
      if (['submit', 'button', 'reset', 'image'].includes(t)) return 'button'
      if (t === 'range') return 'slider'
      return 'textbox'
    }
    if (el.isContentEditable && !el.parentElement?.isContentEditable) return 'textbox'
    // Things built from divs: clickable if they say so, or take focus, or
    // show a pointer that their parent doesn't (seat maps are often this).
    if (el.hasAttribute('onclick') || (el.tabIndex >= 0 && el.hasAttribute('tabindex'))) return 'clickable'
    const cur = getComputedStyle(el).cursor
    if (cur === 'pointer' && el.parentElement && getComputedStyle(el.parentElement).cursor !== 'pointer') return 'clickable'
    return null
  }

  const nameOf = (el, role) => {
    const aria = el.getAttribute('aria-label')
    if (aria && clean(aria)) return clean(aria)
    const label = labelText(el)
    if (label) return label
    if (role === 'textbox' || role === 'select' || role === 'combobox') {
      return clean(el.getAttribute('placeholder') || el.getAttribute('title') || el.name || '')
    }
    if (el.tagName === 'INPUT') return clean(el.value || el.getAttribute('alt') || el.getAttribute('title') || '')
    const img = !clean(el.innerText) && el.querySelector('img[alt]')
    return clean(el.innerText || (img && img.alt) || el.getAttribute('title') || '')
  }

  const isSensitive = el => {
    if ((el.type || '').toLowerCase() === 'password') return true
    if (/\bcc-|card|csc|password|one-time-code/i.test(el.getAttribute('autocomplete') || '')) return true
    return SENSITIVE.test([el.name, el.id, labelText(el), el.getAttribute('placeholder'), el.getAttribute('aria-label')].filter(Boolean).join(' '))
  }

  const stateOf = (el, role) => {
    const bits = []
    if (role === 'textbox') {
      const v = el.isContentEditable ? el.innerText : el.value
      if (v) bits.push(isSensitive(el) ? 'value hidden' : `value "${cut(clean(v), 60)}"`)
      if ((el.type || '') && !['text', 'textarea'].includes(el.type)) bits.push(el.type)
    }
    if (role === 'select') {
      const opts = [...el.options].map(o => clean(o.label || o.text)).filter(Boolean)
      bits.push(`selected "${cut(clean(el.selectedOptions[0]?.label || ''), 40)}"`)
      bits.push('options: ' + cut(opts.slice(0, 25).join(' | '), 400))
    }
    if (el.checked || el.getAttribute('aria-checked') === 'true') bits.push('checked')
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true') bits.push('selected')
    const exp = el.getAttribute('aria-expanded')
    if (exp) bits.push(exp === 'true' ? 'expanded' : 'collapsed')
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') bits.push('disabled')
    if (el.required || el.getAttribute('aria-required') === 'true') bits.push('required')
    if (el.getAttribute('aria-invalid') === 'true') bits.push('invalid')
    return bits.length ? ` (${bits.join(', ')})` : ''
  }

  const lines = [] // { text, keep } — keep: always shown even when the page is long
  let n = 0
  const push = (text, keep = false) => {
    const last = lines[lines.length - 1]
    if (!last || last.text !== text) lines.push({ text, keep })
  }

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = clean(child.textContent)
        if (t) push(cut(t, 300))
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE || SKIP.has(child.tagName)) continue
      const el = child
      if (el.getAttribute('aria-hidden') === 'true' || !shown(el)) continue

      let role = roleOf(el)
      // A "clickable" wrapper around real controls is just a container.
      if (role === 'clickable' && el.querySelector(CONTROLS)) role = null
      if (role) {
        const ref = `${prefix}e${++n}`
        el.setAttribute('data-atlas-ref', ref)
        push(`[${ref}] ${role} "${cut(nameOf(el, role), 120)}"${stateOf(el, role)}`, true)
        // A button's or link's text is its name. Look inside only when there
        // are more controls in there (a list of suggestions) or a lot of text.
        if (!el.querySelector(CONTROLS) && clean(el.innerText).length < 160) continue
      }
      const tag = el.tagName
      if (/^H[1-6]$/.test(tag)) { push('#'.repeat(Number(tag[1])) + ' ' + cut(clean(el.innerText), 200), true); continue }
      if (el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true' || tag === 'DIALOG') push('[dialog]', true)
      if (el.getAttribute('role') === 'alert') push('[alert] ' + cut(clean(el.innerText), 300), true)
      if (el.shadowRoot) walk(el.shadowRoot)
      walk(el)
    }
  }
  walk(document.body || document.documentElement)

  // Long page: every control and heading stays, text fills what's left.
  let total = lines.reduce((s, l) => s + l.text.length + 1, 0)
  let out = lines
  let shortened = false
  if (total > max) {
    shortened = true
    let budget = max - lines.filter(l => l.keep).reduce((s, l) => s + l.text.length + 1, 0)
    out = lines.filter(l => {
      if (l.keep) return true
      budget -= l.text.length + 1
      return budget > 0
    })
  }
  return { text: out.map(l => l.text).join('\n'), refs: n, shortened }
}

// Describes one element for the safety checks (also runs in the page).
export function describeElement(el) {
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim()
  const label = el.labels?.length ? clean([...el.labels].map(l => l.innerText).join(' ')) : ''
  const form = el.form || el.closest('form')
  const formFields = form ? [...form.querySelectorAll('input,select,textarea')].map(f => ({
    type: f.type, autocomplete: f.getAttribute('autocomplete'), name: f.name, id: f.id,
    label: f.labels?.length ? clean([...f.labels].map(l => l.innerText).join(' ')) : '',
    placeholder: f.getAttribute('placeholder'), aria: f.getAttribute('aria-label'),
  })) : []
  return {
    tag: el.tagName.toLowerCase(), type: el.type || '', autocomplete: el.getAttribute('autocomplete') || '',
    name: el.name || '', id: el.id || '', label, placeholder: el.getAttribute('placeholder') || '',
    aria: el.getAttribute('aria-label') || '', title: el.getAttribute('title') || '',
    text: clean(el.innerText).slice(0, 200), value: el.tagName === 'INPUT' ? String(el.value || '').slice(0, 80) : '',
    submits: el.tagName === 'BUTTON' ? (el.type || 'submit') === 'submit' : el.tagName === 'INPUT' && ['submit', 'image'].includes(el.type),
    formFields,
  }
}
