import { useMemo, useState } from 'react'
import { ImportModal } from '../../desktop/FinancesPage.jsx'
import { useFinances } from '../../context/FinancesContext.jsx'
import { Button, Select, eyebrow } from '../ui.jsx'
import { AtlasNote, Block, Meter, Observations, StepHeading } from './shared.jsx'

// Money is where the week's numbers come from, so it starts with the import:
// bring the statements up to date, and the figures below follow. Skipping is
// fine, the screen then reads from whatever is already there.

const fmtDay = (iso) => iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''

const DEFAULT_CATEGORIES = ['Groceries', 'Eating out', 'Coffee', 'Transport', 'Travel', 'Rent', 'Bills', 'Subscriptions', 'Shopping',
  'Health', 'Entertainment', 'Personal care', 'Gifts', 'Giving', 'Education', 'Fees', 'Cash', 'Transfer', 'Salary', 'Refund', 'Other income']

function ImportPanel({ recap, onOpen }) {
  const m = recap.money
  const behind = m.stale
  const gap = m.last_transaction ? Math.round((Date.now() - new Date(`${m.last_transaction.slice(0, 10)}T12:00:00`)) / 86400000) : 0
  return (
    <div className="wr-rise" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '16px 18px', marginBottom: 26, borderRadius: 'var(--radius-lg)',
                                      background: behind ? 'var(--accent-soft)' : 'var(--surface)', border: `1px solid ${behind ? 'var(--accent-line)' : 'var(--bd)'}` }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{behind ? 'Bring your statements up to date' : 'Your statements look current'}</div>
        <div style={{ marginTop: 3, fontSize: 13.5, lineHeight: 1.5, color: 'var(--mid)' }}>
          {m.last_transaction
            ? <>Latest transaction: {fmtDay(m.last_transaction)}{gap >= 14 ? ` (${Math.floor(gap / 7)} weeks ago)` : ''}. {behind ? 'Download a CSV from your bank and import it to see the whole week.' : 'Import another account if you have one.'}</>
            : 'Download a CSV from your bank and import it to see how the week went.'}
        </div>
      </div>
      <Button variant={behind ? 'primary' : 'secondary'} size="lg" raised={behind} onClick={onOpen}>Import a statement</Button>
    </div>
  )
}

function Uncategorised({ items, total }) {
  const { transactions, setTransactionCategory, fmt } = useFinances()
  const categories = useMemo(() => {
    const seen = new Map()
    for (const c of [...transactions.map(t => (t.category || '').trim()), ...DEFAULT_CATEGORIES]) if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c)
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [transactions])
  // Sorted ones leave the list straight away rather than waiting for the next fetch.
  const [sorted, setSorted] = useState({})
  const left = items.filter(t => !sorted[t.id])
  if (total === 0 || left.length === 0) return null
  return (
    <Block title="Needs a category" aside={`${total - Object.keys(sorted).length} left`}>
      {left.map(t => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--bd-xs)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDay(t.date)}</div>
          </div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600, color: t.type === 'income' ? 'var(--sage)' : 'var(--ink)' }}>
            {t.type === 'income' ? '+' : ''}{fmt(t.amount, 0)}
          </div>
          <Select aria-label={`Category for ${t.merchant}`} value="" style={{ width: 140 }}
            onChange={e => { if (e.target.value) { setTransactionCategory(t.id, e.target.value); setSorted(s => ({ ...s, [t.id]: true })) } }}>
            <option value="">Choose…</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
      ))}
    </Block>
  )
}

export default function MoneyStep({ recap, narrative, reload }) {
  const { fmt } = useFinances()
  const [importing, setImporting] = useState(false)
  const m = recap.money
  const money = (n) => fmt(n, 0)
  const noData = m.count === 0
  const maxCat = Math.max(...m.categories.map(c => Math.max(c.amount, c.usual || 0)), 1)
  const diff = m.usual_spent != null ? m.spent - m.usual_spent : null

  return (
    <div>
      <StepHeading kicker="Money" title="Where did the money go?">
        Import this week's statements first; the numbers below read from them.
      </StepHeading>

      <ImportPanel recap={recap} onOpen={() => setImporting(true)} />
      {importing && <ImportModal onClose={() => { setImporting(false); reload() }} />}

      {noData ? (
        <p style={{ fontSize: 14.5, color: 'var(--mid)', lineHeight: 1.6 }}>
          Nothing was spent or received in this week's transactions yet. If that's right, carry on; otherwise import a statement above.
        </p>
      ) : (
        <>
          <AtlasNote loading={narrative === null} text={narrative && narrative.money} />

          <div className="wr-rise" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 26 }}>
            {[
              ['Spent', money(m.spent), diff == null ? null : `${diff > 0 ? '▲' : '▼'} ${money(Math.abs(diff))} ${diff > 0 ? 'above' : 'below'} usual`, diff == null ? 'var(--muted)' : diff > 0 ? 'var(--accent)' : 'var(--sage)'],
              ['Came in', money(m.income), null],
              ...(m.net_worth ? [['Net worth', `${m.net_worth.change >= 0 ? '+' : '−'}${money(Math.abs(m.net_worth.change))}`, `now ${money(m.net_worth.now)}`, 'var(--muted)']] : []),
            ].map(([label, value, sub, tone]) => (
              <div key={label} style={{ padding: '14px 16px', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', border: '1px solid var(--bd)' }}>
                <div style={{ ...eyebrow }}>{label}</div>
                <div style={{ marginTop: 6, fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 500, color: 'var(--ink)' }}>{value}</div>
                {sub && <div style={{ marginTop: 3, fontSize: 12, color: tone }}>{sub}</div>}
              </div>
            ))}
          </div>

          <Observations items={m.insights} skip={i => i.ref?.type === 'import' || i.ref?.type === 'categorise'} />

          {m.categories.length > 0 && (
            <Block title="By category" aside="the line marks your usual">
              {m.categories.map(c => (
                <div key={c.category} style={{ padding: '10px 0', borderBottom: '1px solid var(--bd-xs)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7, fontSize: 14 }}>
                    <span style={{ color: 'var(--ink)' }}>{c.category}</span>
                    <span style={{ color: 'var(--mid)' }}>{money(c.amount)}{c.usual ? <span style={{ color: 'var(--faint)' }}> · usually {money(c.usual)}</span> : ''}</span>
                  </div>
                  <Meter value={c.amount} max={maxCat} mark={c.usual || null}
                    color={c.usual && c.amount > c.usual * 1.5 ? 'var(--accent)' : 'var(--blue)'} />
                </div>
              ))}
            </Block>
          )}

          {m.budgets.length > 0 && (
            <Block title="Budgets">
              {m.budgets.map(b => (
                <div key={`${b.month}-${b.name}`} style={{ padding: '10px 0', borderBottom: '1px solid var(--bd-xs)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7, fontSize: 14 }}>
                    <span style={{ color: 'var(--ink)' }}>{b.name}</span>
                    <span style={{ color: b.over ? 'var(--accent)' : 'var(--mid)' }}>{money(b.spent)} of {money(b.limit)}</span>
                  </div>
                  <Meter value={b.spent} max={b.limit} color={b.over ? 'var(--accent)' : b.pace > 1.15 ? 'var(--gold)' : 'var(--sage)'} />
                </div>
              ))}
            </Block>
          )}

          <Uncategorised items={m.uncategorised} total={m.uncategorised_count} />

          {m.biggest.length > 0 && (
            <Block title="Biggest purchases">
              {m.biggest.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--bd-xs)', fontSize: 14 }}>
                  <span style={{ color: 'var(--ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant}<span style={{ color: 'var(--muted)' }}> · {fmtDay(t.date)}{t.category ? ` · ${t.category}` : ''}</span></span>
                  <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, color: 'var(--ink)' }}>{money(t.amount)}</span>
                </div>
              ))}
            </Block>
          )}
        </>
      )}
    </div>
  )
}
