import { useState } from 'react'
import { useFinances } from '../context/FinancesContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'

const fmt = (n) => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
}).format(n || 0)
const fmt2 = (n) => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: 2,
}).format(n || 0)

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

function BudgetRow({ b, onRemove, isMobile }) {
  const width = Math.min(b.pct, 100)
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--bd-xs)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 7 }}>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {b.category}
        </span>
        <span style={{ fontFamily: "'Newsreader', serif", fontSize: 14.5, fontWeight: 600, color: paceColor(b) }}>
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
  const { insights, setBudget, removeBudget } = useFinances()
  const [adding, setAdding] = useState(false)
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')

  const submit = (e) => {
    e.preventDefault()
    if (!category.trim() || !amount) return
    setBudget(category.trim(), amount)
    setCategory(''); setAmount(''); setAdding(false)
  }

  const { budgets = [], unbudgeted = [] } = insights

  return (
    <div style={{ ...card, padding: isMobile ? '18px 16px' : '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={h2}>Budgets</h2>
        <button onClick={() => setAdding(a => !a)} style={linkBtn}>{adding ? 'Cancel' : '+ Add'}</button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 6, lineHeight: 1.5 }}>
        Monthly, per category. Progress is coloured by pace — £90 of £100 reads
        differently on the 3rd than on the 28th.
      </div>

      {budgets.length === 0 && !adding && (
        <div style={{ fontSize: 13, color: 'var(--faint)', padding: '14px 0' }}>
          No budgets yet. Categories come from your import rules.
        </div>
      )}

      {budgets.map(b => <BudgetRow key={b.id} b={b} onRemove={removeBudget} isMobile={isMobile} />)}

      {adding && (
        <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <input autoFocus value={category} onChange={e => setCategory(e.target.value)}
            placeholder="Category" style={{ ...inp, flex: '1 1 130px' }} />
          <input type="number" min="0" step="1" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="£ / month" style={{ ...inp, flex: '0 1 110px' }} />
          <button type="submit" style={{ ...linkBtn, padding: '0 4px' }}>Save</button>
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
            <div style={{ fontFamily: "'Newsreader', serif", fontSize: 14.5, fontWeight: 600 }}>
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

// ─── Surplus ──────────────────────────────────────────────────────────────────

function SurplusCard({ isMobile }) {
  const { insights, allocateSurplus } = useFinances()
  const [amounts, setAmounts] = useState({})
  const [busy, setBusy] = useState(false)
  const { surplus = {}, allocation = [] } = insights

  const value = (a) => (amounts[a.pot_id] ?? a.suggested)
  const total = allocation.reduce((s, a) => s + (Number(value(a)) || 0), 0)

  const submit = async () => {
    const items = allocation
      .map(a => ({ pot_id: a.pot_id, amount: Number(value(a)) || 0 }))
      .filter(a => a.amount > 0)
    if (!items.length) return
    setBusy(true)
    try { await allocateSurplus(items, `${surplus.month} surplus`) }
    finally { setBusy(false); setAmounts({}) }
  }

  const positive = (surplus.surplus || 0) > 0

  return (
    <div style={{ ...card, padding: isMobile ? '18px 16px' : '20px 24px' }}>
      <h2 style={{ ...h2, marginBottom: 12 }}>This month</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        {[['In', surplus.income, '#4f7f45'], ['Out', surplus.spending, '#c15f3c'],
          ['Left', surplus.surplus, positive ? '#4f7f45' : '#c15f3c']].map(([label, v, color]) => (
          <div key={label}>
            <div style={eyebrow}>{label}</div>
            <div style={{ marginTop: 3, fontFamily: "'Newsreader', serif", fontSize: isMobile ? 18 : 21, fontWeight: 500, color }}>
              {v ? fmt(v) : '—'}
            </div>
          </div>
        ))}
      </div>

      {!positive && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
          {surplus.income ? 'Nothing spare to move into pots this month.' : 'No income recorded this month yet.'}
        </div>
      )}

      {positive && allocation.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
          {fmt(surplus.surplus)} spare, but every pot has hit its target.
        </div>
      )}

      {positive && allocation.length > 0 && (
        <>
          <div style={{ ...eyebrow, marginBottom: 8 }}>Suggested split</div>
          <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 10, lineHeight: 1.5 }}>
            Proportional to what each pot still needs. Nothing is saved until you
            confirm — edit any figure first.
          </div>
          {allocation.map(a => (
            <div key={a.pot_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--bd-xs)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{fmt(a.shortfall)} to go</div>
              </div>
              <input type="number" min="0" step="1" value={value(a)}
                onChange={e => setAmounts(m => ({ ...m, [a.pot_id]: e.target.value }))}
                aria-label={`Amount for ${a.name}`}
                style={{ ...inp, width: 92, flex: 'none' }} />
            </div>
          ))}
          <button onClick={submit} disabled={busy || total <= 0}
            style={{
              marginTop: 14, width: '100%', padding: '11px', borderRadius: 10, border: 'none',
              background: '#c15f3c', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
              opacity: busy || total <= 0 ? .5 : 1,
            }}>
            {busy ? 'Saving…' : `Move ${fmt(total)} into pots`}
          </button>
        </>
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
      <SurplusCard isMobile={isMobile} />
    </div>
  )
}
