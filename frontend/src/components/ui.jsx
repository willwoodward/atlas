// Atlas's shared building blocks.
//
// The app is styled inline, so these are mostly style objects to spread —
// `style={{ ...card, padding: 0 }}` — plus a few components for the pieces
// with behaviour (buttons, switches, fields). Colours, fonts and radii come
// from the tokens in index.css, so both themes follow automatically.
//
// Reach for these before writing a new one-off style; if a page needs
// something slightly different, override a property rather than copying the
// whole object.

import { forwardRef } from 'react'

// ── Text ─────────────────────────────────────────────────────────────────────

/** Small uppercase label above a section or figure ("GOAL TIME · THIS WEEK"). */
export const eyebrow = {
  fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)',
}

/** Serif page title (h1). */
export const pageTitle = (isMobile) => ({
  margin: 0, fontFamily: 'var(--font-serif)', fontSize: isMobile ? 26 : 34, fontWeight: 500, color: 'var(--ink)',
})

/** Serif section heading (h2) — "Today's schedule", "Accounts". */
export const sectionTitle = {
  margin: 0, fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: 'var(--ink)',
}

/** Muted serif group heading on settings-style lists ("Calendar", "Notes"). */
export const groupTitle = {
  margin: '16px 0 6px', fontFamily: 'var(--font-serif)', fontSize: 17, fontWeight: 600, color: 'var(--muted)',
}

/** Big serif figure (stat tiles, totals). */
export const figure = { fontFamily: 'var(--font-serif)', fontWeight: 500, color: 'var(--ink)' }

// ── Surfaces ─────────────────────────────────────────────────────────────────

/** A card: the white panel most content sits in. */
export const card = {
  background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 'var(--radius-lg)', padding: '20px 24px',
}

/** A recessed well inside a card (insets, code blocks, previews). */
export const well = {
  background: 'var(--surface-2)', border: '1px solid var(--bd-sm)', borderRadius: 10,
}

/** The text-input look: every input, textarea and select. */
export const field = {
  background: 'var(--surface-2)', border: '1px solid var(--bd-xl)', borderRadius: 9, color: 'var(--ink)',
  fontFamily: 'inherit', fontSize: 13.5, padding: '8px 11px', outline: 'none',
}

/** A keyboard key ("Ctrl+K"). */
export const kbd = {
  fontFamily: 'inherit', fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 5,
  background: 'var(--surface-3)', color: 'var(--muted)', border: 'none',
}

// ── Buttons ──────────────────────────────────────────────────────────────────

const SIZES = {
  sm: { padding: '5px 10px', fontSize: 12, borderRadius: 'var(--radius-sm)' },
  md: { padding: '7px 14px', fontSize: 13, borderRadius: 9 },
  lg: { padding: '10px 20px', fontSize: 14, borderRadius: 10 },
}

const VARIANTS = {
  // The one main action on a screen.
  primary:   { background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600 },
  // Everything else that's a button.
  secondary: { background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--bd)' },
  // Quiet: toolbars, "Cancel", "Discard".
  ghost:     { background: 'transparent', color: 'var(--mid)', border: '1px solid var(--bd)' },
  // Destructive or "careful": sign out everywhere, delete.
  danger:    { background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent-line)' },
  // Text only: inline links like "+ Add", "Reset".
  link:      { background: 'none', color: 'var(--accent)', border: 'none', padding: 0, fontWeight: 600 },
}

/** Style for a button, for the rare element that can't be a <Button>. */
export function buttonStyle({ variant = 'secondary', size = 'md', disabled, raised } = {}) {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    fontFamily: 'inherit', lineHeight: 1.2, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
    ...SIZES[size], ...VARIANTS[variant],
    ...(variant === 'link' && { padding: 0 }),
    ...(raised && variant === 'primary' && { boxShadow: 'var(--shadow-accent)' }),
    ...(disabled && { opacity: 0.5 }),
  }
}

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', raised = false, style, type = 'button', ...props }, ref,
) {
  return <button ref={ref} type={type} {...props} style={{ ...buttonStyle({ variant, size, disabled: props.disabled, raised }), ...style }} />
})

/** A square icon-only button. Give it an aria-label. */
export const IconButton = forwardRef(function IconButton({ size = 32, active = false, style, ...props }, ref) {
  return (
    <button ref={ref} type="button" {...props}
      style={{ width: size, height: size, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
               borderRadius: size >= 34 ? 'var(--radius)' : 'var(--radius-sm)', border: 'none', padding: 0, cursor: 'pointer',
               background: active ? 'var(--surface-3)' : 'none', color: active ? 'var(--ink)' : 'var(--muted)', ...style }} />
  )
})

// ── Form controls ────────────────────────────────────────────────────────────

export const Input = forwardRef(function Input({ style, ...props }, ref) {
  return <input ref={ref} {...props} style={{ ...field, ...style }} />
})

export const Textarea = forwardRef(function Textarea({ style, ...props }, ref) {
  return <textarea ref={ref} {...props} style={{ ...field, resize: 'vertical', lineHeight: 1.5, ...style }} />
})

export const Select = forwardRef(function Select({ style, ...props }, ref) {
  return <select ref={ref} {...props} style={{ ...field, padding: '7px 9px', cursor: 'pointer', ...style }} />
})

/** An on/off switch. */
export function Switch({ checked, onChange, label, disabled, title }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} disabled={disabled}
      title={title}
      style={{ width: 40, height: 23, borderRadius: 99, border: 'none', padding: 2, cursor: disabled ? 'default' : 'pointer',
               opacity: disabled ? 0.55 : 1, background: checked ? 'var(--accent)' : 'var(--surface-3)', transition: 'background .15s', display: 'flex', flex: 'none' }}>
      <span style={{ width: 19, height: 19, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)',
                     transform: checked ? 'translateX(17px)' : 'none', transition: 'transform .15s' }} />
    </button>
  )
}

/** Uppercase label + the thing it labels. */
export function Eyebrow({ as: Tag = 'div', style, ...props }) {
  return <Tag {...props} style={{ ...eyebrow, ...style }} />
}

// ── Page structure ───────────────────────────────────────────────────────────

/**
 * The title block at the top of a page: serif title, a line under it, and the
 * page's actions (children) on the right — stacked under the title on a phone
 * when `stackOnMobile`.
 */
export function PageHeader({ title, subtitle, isMobile, stackOnMobile = false, children, style }) {
  const stacked = isMobile && stackOnMobile
  return (
    <div style={{ display: 'flex', alignItems: stacked ? 'flex-start' : 'flex-end', flexDirection: stacked ? 'column' : 'row',
                  justifyContent: 'space-between', gap: stacked ? 12 : isMobile ? 0 : 20, marginBottom: 24, ...style }}>
      <div>
        <h1 style={pageTitle(isMobile)}>{title}</h1>
        {subtitle != null && <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--mid)' }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

// ── Delete ───────────────────────────────────────────────────────────────────

/**
 * A bin button: the lid lifts as you hover (styles in index.css, .bin-button).
 * Give it an aria-label saying what it deletes. `size` is the button; the
 * icon scales with it.
 */
export const BinButton = forwardRef(function BinButton({ size = 32, title = 'Delete', className = '', style, ...props }, ref) {
  const icon = Math.round(size * 0.47)
  return (
    <IconButton ref={ref} size={size} title={title} {...props} className={`bin-button ${className}`.trim()} style={style}>
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <g className="bin-lid">
          <path d="M4 6.5h16" />
          <path d="M9.5 6.5V4.5h5v2" />
        </g>
        <path d="M6 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4l1-13" />
        <path d="M10 10.5v6.5M14 10.5v6.5" />
      </svg>
    </IconButton>
  )
})
