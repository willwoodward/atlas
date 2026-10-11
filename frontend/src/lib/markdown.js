import { marked } from 'marked'
import DOMPurify from 'dompurify'

// The one way Markdown becomes HTML in Atlas. Everything rendered with
// dangerouslySetInnerHTML must come through here.
//
// marked passes raw HTML straight through, and the text it renders isn't all
// ours: assistant replies can carry content from web pages it researched
// (prompt injection), and notes can be written by the assistant or synced
// from GitHub. Unsanitised, an `<img onerror=…>` in any of them runs in the
// page and can read the login token. DOMPurify removes scripts, event
// handlers, javascript: URLs and the like, keeping ordinary formatting.

marked.use({ gfm: true, breaks: true })

// Links open in a new tab and can't reach back into this one.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const CONFIG = {
  USE_PROFILES: { html: true },          // no SVG/MathML: unneeded, and a common bypass surface
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['style'],
  ADD_ATTR: ['target'],
}

export function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text || ''), CONFIG)
}
