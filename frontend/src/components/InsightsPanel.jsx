import { useState } from 'react'
import { useFinances } from '../context/FinancesContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'

import { formatMoney, currencySymbol } from '../lib/fx.js'

// Insights arrive already converted into the currency they were requested in.
function useMoney() {
  const { insights, displayCurrency } = useFinances()
  const cur = insights.currency || displayCurrency
  return {
    cur,
    fmt: (n) => formatMoney(n || 0, cur, 0),
    fmt2: (n) => formatMoney(n || 0, cur, 2),
  }
}

// Pace is spend-so-far against month-elapsed. Under 1 is ahead, over 1 is behind.
const paceColor = (b) => (b.over ? '#c15f3c' : b.pace > 1.15 ? '#b8860b' : '#4f7f45')

const card = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16 }
const h2 = { margin: 0, fontFamily: "'Newsreader', serif", fontSize: 19, fontWeight: 600 }
const eyebrow = { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }
const linkBtn = { fontSize: 12, fontWeight: 600, color: '#c15f3c', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }
const inp = { padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--bd-xl)', background: 'var(--surface-2)', fontSize: 13, fontFamily: 'inherit', color: 'var(--ink)', outline: 'none', width: '100%' }

const CADENCE_LABEL = {
  weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly',
  quarterly: 'Quarterly', annual: 'Yearly',
}

// ─── Budgets ──────────────────────────────────────────────────────────────────

function BudgetRow({ b, onRemove, onEdit, isMobile }) {
  const { fmt } = useMoney()
  const covers = b.categories || [b.category]
  const named = !(covers.length === 1 && covers[0].toLowerCase() === b.category.toLowerCase())
  const width = Math.min(b.pct, 100)
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--bd-xs)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 7 }}>
        <button onClick={() => onEdit(b)} title="Edit budget"
          style={{ flex: 1, fontSize: 13.5, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left',
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)' }}>
          {b.category}
          {named && <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--muted)' }}> · {covers.join(', ')}</span>}
        </button>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 14.5, fontWeight: 600, color: paceColor(b) }}>
          {fmt(b.spent)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--muted)', flex: 'none' }}>of {fmt(b.amount)}</span>
        <button onClick={() => onRemove(b.id)} aria-label={`Remove ${b.category} budget`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 16, lineHeight: 1, padding: '0 2px', minWidth: 24 }}>×</button>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden', position: 'relative' }}>
        <div style={{ height: '100%', borderRadius: 99, background: paceColor(b), width: `${width}%`, transition: 'width .4s' }} />
      </div>
      <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--muted)' }}>
        {b.over
          ? `${fmt(Math.abs(b.remaining))} over`
          : `${fmt(b.remaining)} left`}
        {' · '}
        {b.pace > 1.15 ? 'spending fast for this point in the month'
          : b.pace > 0 ? 'on track' : 'nothing spent yet'}
      </div>
    </div>
  )
}

function BudgetsCard({ isMobile }) {
  const { fmt2, cur } = useMoney()
  const { insights, setBudget, removeBudget, transactions } = useFinances()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)     // budget being edited
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [picked, setPicked] = useState([])

  // Categories you've used, most common first, to pick from.
  const counts = {}
  for (const t of transactions) { const c = (t.category || '').trim(); if (c && t.type !== 'income') counts[c] = (counts[c] || 0) + 1 }
  const choices = [...new Set([...Object.keys(counts).sort((a, b) => counts[b] - counts[a]), ...picked])]

  const open = (b = null) => {
    setEditing(b)
    setName(b?.category || '')
    // The amount as shown (display currency), since saving stores it in that currency.
    setAmount(b ? String(Math.round(b.amount)) : '')
    const covers = b?.categories || []
    setPicked(covers.length === 1 && covers[0].toLowerCase() === (b?.category || '').toLowerCase() ? [] : covers)
    setAdding(true)
  }
  const close = () => { setAdding(false); setEditing(null); setName(''); setAmount(''); setPicked([]) }
  const toggle = (c) => setPicked(p => p.includes(c) ? p.filter(x => x !== c) : [...p, c])

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !amount) return
    // Budgets are keyed by name, so a rename is a new budget replacing the old.
    if (editing && editing.category !== name.trim()) await removeBudget(editing.id)
    await setBudget(name.trim(), amount, picked)
    close()
  }

  const { budgets = [], unbudgeted = [] } = insights

  return (
    <div style={{ ...card, padding: isMobile ? '18px 16px' : '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={h2}>Budgets</h2>
        <button onClick={() => adding ? close() : open()} style={linkBtn}>{adding ? 'Cancel' : '+ Add'}</button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 6, lineHeight: 1.5 }}>
        Monthly. A budget can cover several categories (e.g. Bills). Progress is coloured by pace — {currencySymbol(cur)}90 of {currencySymbol(cur)}100
        reads differently on the 3rd than on the 28th.
      </div>

      {budgets.length === 0 && !adding && (
        <div style={{ fontSize: 13, color: 'var(--faint)', padding: '14px 0' }}>
          No budgets yet. Categories come from your import rules.
        </div>
      )}

      {budgets.map(b => <BudgetRow key={b.id} b={b} onRemove={removeBudget} onEdit={open} isMobile={isMobile} />)}

      {adding && (
        <form onSubmit={submit} style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bd-sm)' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input autoFocus value={name} onChange={e => setName(e.target.value)}
              placeholder="Name, e.g. Bills" aria-label="Budget name" style={{ ...inp, flex: '1 1 130px' }} />
            <input type="number" min="0" step="1" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder={`${currencySymbol(cur)} / month`} aria-label="Monthly amount" style={{ ...inp, flex: '0 1 110px' }} />
          </div>
          <div style={{ ...eyebrow, margin: '12px 0 6px' }}>Categories it covers</div>
          {choices.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--faint)' }}>Categorise some transactions first.</div>
            : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {choices.map(c => {
                  const on = picked.includes(c)
                  return (
                    <button key={c} type="button" onClick={() => toggle(c)} aria-pressed={on}
                      style={{ padding: '4px 10px', borderRadius: 99, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--bd-xl)'}`, background: on ? 'rgba(193,95,60,.1)' : 'transparent', color: on ? 'var(--accent)' : 'var(--mid)' }}>
                      {on ? '✓ ' : ''}{c}
                    </button>
                  )
                })}
              </div>
            )}
          <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
            {picked.length ? `Counts spending in ${picked.join(', ')}.` : name.trim() ? `None picked: counts spending in "${name.trim()}".` : 'None picked: counts the category with the same name.'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, marginTop: 10 }}>
            {editing && <button type="button" onClick={() => { removeBudget(editing.id); close() }} style={{ ...linkBtn, color: 'var(--muted)', marginRight: 'auto' }}>Delete</button>}
            <button type="submit" style={linkBtn}>{editing ? 'Save changes' : 'Save'}</button>
          </div>
        </form>
      )}

      {unbudgeted.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--bd-sm)' }}>
          <div style={{ ...eyebrow, marginBottom: 8 }}>Spending with no budget</div>
          {unbudgeted.slice(0, 6).map(u => (
            <div key={u.category} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '4px 0' }}>
              <span style={{ color: 'var(--mid)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.category}</span>
              <span style={{ flex: 'none' }}>{fmt2(u.spent)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Recurring ────────────────────────────────────────────────────────────────

function RecurringCard({ isMobile }) {
  const { fmt, fmt2 } = useMoney()
  const { insights } = useFinances()
  const [showAll, setShowAll] = useState(false)
  const recurring = insights.recurring || []
  const shown = showAll ? recurring : recurring.slice(0, 6)
  const annualTotal = recurring.reduce((s, r) => s + r.annualised, 0)

  return (
    <div style={{ ...card, padding: isMobile ? '18px 16px' : '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={h2}>Recurring</h2>
        {annualTotal > 0 && (
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{fmt(annualTotal)}/yr</span>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 6, lineHeight: 1.5 }}>
        Detected from at least three payments on a regular cadence — irregular
        spending is habit, not a subscription, and isn't listed here.
      </div>

      {recurring.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--faint)', padding: '14px 0' }}>
          Nothing detected yet — import a few months of statements.
        </div>
      )}

      {shown.map(r => (
        <div key={r.merchant} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--bd-xs)' }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flex: 'none',
            background: r.overdue ? 'var(--faint)' : '#2b72a8',
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.label}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              {CADENCE_LABEL[r.cadence] || r.cadence}
              {r.varies && ' · varies'}
              {r.overdue ? ' · not seen since ' + r.last_seen : ' · next ' + r.next_due}
            </div>
          </div>
          <div style={{ textAlign: 'right', flex: 'none' }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 14.5, fontWeight: 600 }}>
              {r.varies ? '~' : ''}{fmt2(r.amount)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmt(r.annualised)}/yr</div>
          </div>
        </div>
      ))}

      {recurring.length > 6 && (
        <button onClick={() => setShowAll(s => !s)} style={{ ...linkBtn, marginTop: 10 }}>
          {showAll ? 'Show less' : `Show all ${recurring.length}`}
        </button>
      )}
    </div>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function InsightsPanel() {
  const isMobile = useIsMobile()
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(300px, 1fr))',
      gap: 16, alignItems: 'start',
    }}>
      <BudgetsCard isMobile={isMobile} />
      <RecurringCard isMobile={isMobile} />
    </div>
  )
}
