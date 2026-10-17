import { useMemo, useState } from 'react'
import { useFinances } from '../context/FinancesContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { PERIODS, periodRange, categoryTotals, colorMap, slices, UNCATEGORISED, OTHER } from '../lib/categories.js'

const card = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16 }
const eyebrow = { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }

const SIZE = 150, R = 56, STROKE = 20, CIRC = 2 * Math.PI * R

function Donut({ data, total, hovered, setHovered, onSelect, fmt }) {
  let offset = 0
  const gap = data.length > 1 ? 2 : 0
  const focus = hovered != null ? data[hovered] : null
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img"
      aria-label={data.map(d => `${d.category} ${Math.round(d.total / total * 100)}%`).join(', ')}
      style={{ flex: 'none', overflow: 'visible' }}>
      <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--surface-3)" strokeWidth={STROKE} />
      <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
        {data.map((d, i) => {
          const len = Math.max(d.total / total * CIRC - gap, 0.6)
          const el = (
            <circle key={d.category} cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
              stroke={d.color} strokeWidth={hovered === i ? STROKE + 5 : STROKE}
              strokeDasharray={`${len} ${CIRC - len}`} strokeDashoffset={-offset}
              style={{ cursor: 'pointer', transition: 'stroke-width .12s', opacity: hovered != null && hovered !== i ? 0.55 : 1 }}
              onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
              onClick={() => onSelect(d)} />
          )
          offset += d.total / total * CIRC
          return el
        })}
      </g>
      <text x="50%" y={SIZE / 2 - 4} textAnchor="middle" pointerEvents="none" style={{ fontFamily: 'var(--font-serif)', fontSize: 17, fontWeight: 600, fill: 'var(--ink)' }}>
        {fmt(focus ? focus.total : total, 0)}
      </text>
      <text x="50%" y={SIZE / 2 + 14} textAnchor="middle" pointerEvents="none" style={{ fontSize: 10.5, fill: 'var(--muted)' }}>
        {focus ? `${Math.round(focus.total / total * 100)}% · ${focus.category.length > 14 ? focus.category.slice(0, 13) + '…' : focus.category}` : 'total'}
      </text>
    </svg>
  )
}

// Sends every uncategorised transaction to the model (server-side).
function AutoCategoriseButton() {
  const { classifier, autoCategorise } = useFinances()
  const [state, setState] = useState(null) // null | 'busy' | { n } | { error }
  if (!classifier.configured) return null
  const run = async () => {
    setState('busy')
    try { setState({ n: await autoCategorise() }) } catch (e) { setState({ error: e.message }) }
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <button onClick={run} disabled={state === 'busy'}
        style={{ fontSize: 12, fontWeight: 600, color: 'var(--gold)', background: 'none', border: 'none', padding: 0, cursor: state === 'busy' ? 'default' : 'pointer', fontFamily: 'inherit' }}>
        {state === 'busy' ? 'Categorising…' : '✦ Auto-categorise'}
      </button>
      {state?.n != null && <span style={{ color: 'var(--muted)' }}>{state.n} done</span>}
      {state?.error && <span style={{ color: 'var(--accent)' }}>{state.error}</span>}
    </span>
  )
}

function Breakdown({ title, type, transactions, range, selected, onSelect }) {
  const { txnValue, fmt } = useFinances()
  const isMobile = useIsMobile()
  const [hovered, setHovered] = useState(null)
  // Colours come from all-time totals so a category keeps its colour across periods.
  const colors = useMemo(() => colorMap(transactions, type, txnValue), [transactions, type, txnValue])
  const data = slices(categoryTotals(transactions, type, txnValue, range), colors)
  const total = data.reduce((s, d) => s + d.total, 0)
  const uncategorised = data.find(d => d.category === UNCATEGORISED)

  const select = (d) => onSelect({
    type, label: d.category,
    categories: d.category === OTHER ? d.members : [d.category],
  })

  return (
    <div style={{ flex: '1 1 300px', minWidth: 0 }}>
      <div style={{ ...eyebrow, marginBottom: 12, textAlign: isMobile ? 'center' : 'left' }}>{title}</div>
      {total <= 0 ? (
        <div style={{ fontSize: 13, color: 'var(--faint)', padding: '20px 0', textAlign: isMobile ? 'center' : 'left' }}>Nothing in this period.</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', justifyContent: isMobile ? 'center' : 'flex-start' }}>
          <Donut data={data} total={total} hovered={hovered} setHovered={setHovered} onSelect={select} fmt={fmt} />
          <div style={{ flex: isMobile ? '1 1 100%' : '1 1 160px', minWidth: 0 }}>
            {data.map((d, i) => {
              const isSel = selected?.type === type && selected?.label === d.category
              return (
                <button key={d.category} onClick={() => select(d)}
                  onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
                  title={d.members ? d.members.join(', ') : 'Show these transactions'}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 6px', margin: '0 -6px', border: 'none', borderRadius: 7,
                    background: isSel || hovered === i ? 'var(--surface-2)' : 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: d.color, flex: 'none' }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)', fontStyle: d.category === UNCATEGORISED ? 'italic' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.category}{d.members ? ` (${d.members.length})` : ''}
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--mid)', flex: 'none' }}>{fmt(d.total, 0)}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', width: 34, textAlign: 'right', flex: 'none' }}>{Math.round(d.total / total * 100)}%</span>
                </button>
              )
            })}
            {uncategorised && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center' }}>
                <button onClick={() => select(uncategorised)}
                  style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Categorise the {fmt(uncategorised.total, 0)} uncategorised →
                </button>
                <AutoCategoriseButton />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Spending and income by category. Picking a category filters the transaction
// list (handled by the page via onSelect).
export default function CategoryCharts({ selected, onSelect }) {
  const isMobile = useIsMobile()
  const { transactions } = useFinances()
  const [period, setPeriod] = useState('30d')
  const range = periodRange(period)

  return (
    <div style={{ ...card, padding: isMobile ? '18px 16px' : '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600 }}>By category</h2>
        {/* Six periods don't fit across a phone: a dropdown there, tabs elsewhere. */}
        {isMobile ? (
          <select value={period} onChange={e => setPeriod(e.target.value)} aria-label="Period"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', background: 'var(--surface-2)', border: '1px solid var(--bd)', borderRadius: 10, padding: '6px 10px', fontFamily: 'inherit', cursor: 'pointer' }}>
            {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        ) : (
        <div role="tablist" aria-label="Period" style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--surface-2)', border: '1px solid var(--bd)', borderRadius: 10, overflowX: 'auto', maxWidth: '100%' }}>
          {PERIODS.map(p => (
            <button key={p.key} role="tab" aria-selected={period === p.key} onClick={() => setPeriod(p.key)}
              style={{ padding: '5px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                background: period === p.key ? 'var(--surface)' : 'transparent', color: period === p.key ? 'var(--ink)' : 'var(--muted)',
                boxShadow: period === p.key ? '0 1px 3px var(--bd)' : 'none' }}>
              {p.label}
            </button>
          ))}
        </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 28 : 40, flexWrap: 'wrap' }}>
        <Breakdown title="Spending" type="expense" transactions={transactions} range={range} selected={selected} onSelect={s => onSelect({ ...s, range })} />
        <Breakdown title="Income" type="income" transactions={transactions} range={range} selected={selected} onSelect={s => onSelect({ ...s, range })} />
      </div>
    </div>
  )
}
