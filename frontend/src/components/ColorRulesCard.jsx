import { useEffect, useState } from 'react'
import { useIntegrations } from '../context/IntegrationsContext.jsx'
import { Button, IconButton, BinButton, Input, Select, card } from './ui.jsx'
import { GCAL_COLORS, gcalColorNameFor, isValidPattern } from '../lib/calendarColors.js'

const CHOICES = [...GCAL_COLORS.map(c => c.name), 'default']
const swatch = name => GCAL_COLORS.find(c => c.name === name)?.hex
const label = name => name === 'default' ? 'Calendar default' : name[0].toUpperCase() + name.slice(1)

function Dot({ name }) {
  const hex = swatch(name)
  return <span style={{ width: 12, height: 12, borderRadius: '50%', flex: 'none', background: hex || 'transparent', border: hex ? 'none' : '1.5px dashed var(--faint)' }} />
}

function ColorSelect({ value, onChange, ariaLabel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <Dot name={value} />
      <Select value={value} onChange={e => onChange(e.target.value)} aria-label={ariaLabel} style={{ width: 150 }}>
        {CHOICES.map(c => <option key={c} value={c}>{label(c)}</option>)}
      </Select>
    </div>
  )
}

const arrow = (d) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points={d} /></svg>
)

/**
 * The rules that give events Atlas adds their Google Calendar colour, from the
 * title. Tried top to bottom; the first match wins.
 */
export default function ColorRulesCard() {
  const { colorRules, saveColorRules } = useIntegrations()
  const [draft, setDraft] = useState(null)
  const [trial, setTrial] = useState('')
  const [status, setStatus] = useState(null) // 'saving' | 'saved' | error text

  useEffect(() => { if (colorRules && !draft) setDraft({ rules: colorRules.rules, fallback: colorRules.fallback }) }, [colorRules, draft])
  if (!draft) return <div style={{ ...card, fontSize: 13, color: 'var(--muted)' }}>Loading colour rules…</div>

  const dirty = JSON.stringify(draft) !== JSON.stringify({ rules: colorRules.rules, fallback: colorRules.fallback })
  const invalid = draft.rules.some(r => !isValidPattern(r.pattern))
  const update = (i, patch) => { setStatus(null); setDraft(d => ({ ...d, rules: d.rules.map((r, j) => j === i ? { ...r, ...patch } : r) })) }
  const remove = (i) => { setStatus(null); setDraft(d => ({ ...d, rules: d.rules.filter((_, j) => j !== i) })) }
  const swap = (i, j) => {
    if (j < 0 || j >= draft.rules.length) return
    setStatus(null)
    setDraft(d => { const rules = [...d.rules]; [rules[i], rules[j]] = [rules[j], rules[i]]; return { ...d, rules } })
  }
  const add = () => { setStatus(null); setDraft(d => ({ ...d, rules: [...d.rules, { label: '', pattern: '', color: 'lavender' }] })) }
  const save = async () => {
    setStatus('saving')
    try { await saveColorRules(draft); setStatus('saved') } catch (e) { setStatus(e.message) }
  }

  const trialColor = trial.trim() ? gcalColorNameFor(trial, draft) : null
  const trialRule = trial.trim() ? draft.rules.find(r => isValidPattern(r.pattern) && new RegExp(r.pattern, 'i').test(trial)) : null

  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Google Calendar colours</div>
      <div style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.45, marginBottom: 14 }}>
        Events Atlas adds get their Google Calendar colour from their title. Rules are checked top to bottom and the
        first match wins. Patterns are regular expressions and ignore case — <code>|</code> means “or”, <code>\b</code> marks a word edge.
        This doesn’t change how events look in Atlas.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {draft.rules.map((r, i) => {
          const bad = !isValidPattern(r.pattern)
          return (
            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <Input value={r.label ?? ''} onChange={e => update(i, { label: e.target.value })} placeholder="Name" aria-label="Rule name" style={{ width: 120 }} />
              <Input value={r.pattern} onChange={e => update(i, { pattern: e.target.value })} placeholder="e.g. gym|run|swim" aria-label="Pattern" aria-invalid={bad}
                style={{ flex: '1 1 180px', minWidth: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, borderColor: bad ? 'var(--accent)' : undefined }} />
              <ColorSelect value={r.color} onChange={color => update(i, { color })} ariaLabel="Colour" />
              <div style={{ display: 'flex', gap: 2 }}>
                <IconButton size={28} aria-label="Move up" title="Move up" disabled={i === 0} onClick={() => swap(i, i - 1)}>{arrow('18 15 12 9 6 15')}</IconButton>
                <IconButton size={28} aria-label="Move down" title="Move down" disabled={i === draft.rules.length - 1} onClick={() => swap(i, i + 1)}>{arrow('6 9 12 15 18 9')}</IconButton>
                <BinButton size={28} title="Remove rule" onClick={() => remove(i)} />
              </div>
            </div>
          )
        })}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingTop: 6, borderTop: '1px solid var(--bd-xs)' }}>
          <span style={{ width: 120, fontSize: 13, fontWeight: 600, color: 'var(--mid)' }}>Everything else</span>
          <span style={{ flex: '1 1 180px' }} />
          <ColorSelect value={draft.fallback} onChange={fallback => { setStatus(null); setDraft(d => ({ ...d, fallback })) }} ariaLabel="Colour for everything else" />
          <span style={{ width: 90 }} />
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <Button size="sm" variant="secondary" onClick={add}>Add rule</Button>
        <Button size="sm" variant="primary" onClick={save} disabled={!dirty || invalid || status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save'}
        </Button>
        {status === 'saved' && !dirty && <span style={{ fontSize: 12.5, color: 'var(--sage)' }}>Saved</span>}
        {invalid && <span style={{ fontSize: 12.5, color: 'var(--accent)' }}>Fix the highlighted pattern to save.</span>}
        {status && !['saving', 'saved'].includes(status) && <span style={{ fontSize: 12.5, color: 'var(--accent)' }}>{status}</span>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <Input value={trial} onChange={e => setTrial(e.target.value)} placeholder="Try a title, e.g. Lunch with Sam" aria-label="Try a title" style={{ flex: '1 1 220px' }} />
        {trialColor && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink)' }}>
            <Dot name={trialColor} /> {label(trialColor)}
            <span style={{ color: 'var(--muted)' }}>· {trialRule ? (trialRule.label || 'rule ' + (draft.rules.indexOf(trialRule) + 1)) : 'everything else'}</span>
          </span>
        )}
      </div>
    </div>
  )
}
