import { useState } from 'react'
import { useEmployment } from '../context/EmploymentContext.jsx'
import { useIsMobile } from '../hooks/useIsMobile.js'

// Validated with the dataviz palette checker against both the light (#fffdf9)
// and dark (#22201a) chart surfaces: lightness band, chroma floor, CVD
// separation and contrast all pass in one set, so the two themes share it.
// Green↔gold sit in the 6–8 CVD band, which is why the legend and the table
// view below are not optional — identity is never carried by colour alone.
const KINDS = [
  { key: 'base',   label: 'Base',    color: '#c15f3c' },
  { key: 'oncall', label: 'On-call', color: '#2b72a8' },
  { key: 'bonus',  label: 'Bonus',   color: '#b8860b' },
  { key: 'equity', label: 'Equity',  color: '#4f7f45' },
]

const fmt = (n) => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
}).format(n || 0)

const monthLabel = (m) => {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-GB', { month: 'short' })
}

const inp = { padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--bd-xl)', background: 'var(--surface-2)', fontSize: 13, fontFamily: 'inherit', color: 'var(--ink)', outline: 'none', width: '100%' }
const sel = { ...inp, cursor: 'pointer' }
const card = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 16, padding: '20px 24px' }
const cardTight = { ...card, padding: '18px 16px' }
const h2 = { margin: 0, fontFamily: "'Newsreader', serif", fontSize: 19, fontWeight: 600 }
const eyebrow = { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }
const linkBtn = { fontSize: 12, fontWeight: 600, color: '#c15f3c', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }

// ─── Projection chart ─────────────────────────────────────────────────────────

function ProjectionChart({ rows }) {
  const isMobile = useIsMobile()
  const [hover, setHover] = useState(null)
  const [asTable, setAsTable] = useState(false)
  const max = Math.max(...rows.map(r => r.gross), 1)
  const active = rows.find(r => r.month === hover)

  if (asTable) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button onClick={() => setAsTable(false)} style={linkBtn}>Chart view</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px 6px 0', color: 'var(--muted)', fontWeight: 600 }}>Month</th>
                {KINDS.map(k => <th key={k.key} style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--muted)', fontWeight: 600 }}>{k.label}</th>)}
                <th style={{ textAlign: 'right', padding: '6px 0 6px 8px', color: 'var(--muted)', fontWeight: 600 }}>Gross</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.month} style={{ borderTop: '1px solid var(--bd-xs)' }}>
                  <td style={{ padding: '6px 8px 6px 0' }}>{r.month}</td>
                  {KINDS.map(k => <td key={k.key} style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--mid)' }}>{r[k.key] ? fmt(r[k.key]) : '—'}</td>)}
                  <td style={{ textAlign: 'right', padding: '6px 0 6px 8px', fontWeight: 600 }}>{fmt(r.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {KINDS.map(k => (
            <span key={k.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mid)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2.5, background: k.color }} />
              {k.label}
            </span>
          ))}
        </div>
        <button onClick={() => setAsTable(true)} style={linkBtn}>Table view</button>
      </div>

      {/* Twelve bars do not fit a phone. Rather than dropping months or letting
          the labels collide, the plot scrolls inside its own container and the
          page never scrolls sideways. */}
      <div style={{ overflowX: 'auto', overflowY: 'hidden', margin: '0 -2px', padding: '0 2px' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 4, height: 170, position: 'relative',
        minWidth: isMobile ? 520 : 'auto',
      }}>
        {rows.map(r => (
          <div key={r.month} style={{ flex: 1, minWidth: 26, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
            onMouseEnter={() => setHover(r.month)} onMouseLeave={() => !isMobile && setHover(null)}
            onClick={() => setHover(m => (m === r.month ? null : r.month))}>
            <div style={{
              width: '100%', height: 140, display: 'flex', flexDirection: 'column-reverse',
              justifyContent: 'flex-start', cursor: 'default',
              opacity: hover && hover !== r.month ? .45 : 1, transition: 'opacity .12s',
            }}>
              {/* The 2px separator lives inside each segment's own height rather
                  than in a flex gap: with explicit heights in a fixed-height
                  column, a gap makes the tallest bar overflow and flex-shrink
                  every segment, quietly distorting the proportions. */}
              {KINDS.map(k => r[k.key] > 0 && (
                <div key={k.key} title={`${k.label}: ${fmt(r[k.key])}`} style={{
                  background: k.color,
                  height: `${(r[k.key] / max) * 140}px`,
                  minHeight: 3,
                  flexShrink: 0,
                  boxSizing: 'border-box',
                  borderTop: '2px solid var(--surface)',
                  borderRadius: '4px 4px 0 0',
                }} />
              ))}
            </div>
            <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>{monthLabel(r.month)}</span>
          </div>
        ))}

        {/* On touch there is no hover, so the breakdown moves below the plot;
            an absolutely-positioned tooltip would sit under the finger. */}
        {active && !isMobile && (() => {
          const r = active
          return (
            <div style={{
              position: 'absolute', top: -4, right: 0, background: 'var(--ink)', color: 'var(--surface-2)',
              borderRadius: 10, padding: '10px 12px', fontSize: 12, minWidth: 150, pointerEvents: 'none',
              boxShadow: '0 8px 24px rgba(43,40,32,.24)', zIndex: 2,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{r.month}</div>
              {KINDS.filter(k => r[k.key] > 0).map(k => (
                <div key={k.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
                  <span style={{ opacity: .75 }}>{k.label}</span><span>{fmt(r[k.key])}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginTop: 5, paddingTop: 5, borderTop: '1px solid rgba(255,255,255,.18)', fontWeight: 600 }}>
                <span>Gross</span><span>{fmt(r.gross)}</span>
              </div>
            </div>
          )
        })()}
      </div>
      </div>

      {active && isMobile && (
        <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 10, fontSize: 12.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{active.month}</div>
          {KINDS.filter(k => active[k.key] > 0).map(k => (
            <div key={k.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '2px 0' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--mid)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: k.color }} />{k.label}
              </span>
              <span>{fmt(active[k.key])}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--bd-sm)', fontWeight: 600 }}>
            <span>Gross</span><span>{fmt(active.gross)}</span>
          </div>
        </div>
      )}

      {isMobile && !active && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--faint)' }}>Tap a bar for the breakdown.</div>
      )}
    </div>
  )
}

// ─── Forms ────────────────────────────────────────────────────────────────────

function AddComponentForm({ empId, currency, onDone }) {
  const { addComponent } = useEmployment()
  const [f, setF] = useState({ kind: 'base', label: '', amount: '', cadence: 'annual', start_date: '', end_date: '' })
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    if (!f.label.trim() || !f.amount) return
    addComponent(empId, { ...f, label: f.label.trim(), amount: Number(f.amount), currency })
    onDone()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={f.kind} onChange={set('kind')} style={{ ...sel, flex: '0 0 110px' }}>
          <option value="base">Base</option>
          <option value="oncall">On-call</option>
          <option value="bonus">Bonus</option>
          <option value="other">Other</option>
        </select>
        <input value={f.label} onChange={set('label')} placeholder="Label" style={inp} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="number" step="0.01" value={f.amount} onChange={set('amount')} placeholder={`Amount (${currency})`} style={{ ...inp, flex: '1 1 130px' }} />
        <select value={f.cadence} onChange={set('cadence')} style={{ ...sel, flex: '0 0 120px' }}>
          <option value="annual">Per year</option>
          <option value="monthly">Per month</option>
          <option value="one_off">One-off</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={f.start_date} onChange={set('start_date')} style={{ ...inp, flex: '1 1 140px' }}
          title={f.cadence === 'one_off' ? 'Payment date' : 'Starts (optional)'} />
        {f.cadence !== 'one_off' && (
          <input type="date" value={f.end_date} onChange={set('end_date')} style={inp} title="Ends (optional)" />
        )}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>
        {f.cadence === 'one_off' ? 'Lands once, in the month of the date above.'
          : 'Leave dates blank for open-ended. Annual amounts are spread evenly across the year.'}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onDone} style={{ ...linkBtn, color: 'var(--mid)' }}>Cancel</button>
        <button type="submit" style={{ ...linkBtn }}>Add</button>
      </div>
    </form>
  )
}

function AddGrantForm({ empId, onDone }) {
  const { addGrant } = useEmployment()
  const [f, setF] = useState({ label: '', total_units: '', symbol: 'AMZN', grant_date: '' })
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    if (!f.label.trim()) return
    addGrant(empId, { ...f, label: f.label.trim(), total_units: Number(f.total_units) || 0, symbol: f.symbol.toUpperCase() })
    onDone()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 10 }}>
      <input value={f.label} onChange={set('label')} placeholder="Grant name, e.g. 2026 refresh" style={inp} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="number" step="0.0001" value={f.total_units} onChange={set('total_units')} placeholder="Total units" style={{ ...inp, flex: '1 1 110px' }} />
        <input value={f.symbol} onChange={set('symbol')} placeholder="Symbol" style={{ ...inp, flex: '0 0 90px' }} />
        <input type="date" value={f.grant_date} onChange={set('grant_date')} style={{ ...inp, flex: '1 1 140px' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onDone} style={{ ...linkBtn, color: 'var(--mid)' }}>Cancel</button>
        <button type="submit" style={linkBtn}>Add grant</button>
      </div>
    </form>
  )
}

function AddVestForm({ grantId, onDone }) {
  const { addVest } = useEmployment()
  const [date, setDate] = useState('')
  const [units, setUnits] = useState('')

  const submit = (e) => {
    e.preventDefault()
    if (!date || !units) return
    addVest(grantId, { vest_date: date, units: Number(units) })
    setDate(''); setUnits(''); onDone?.()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, flex: '1 1 130px' }} />
      <input type="number" step="0.0001" value={units} onChange={e => setUnits(e.target.value)} placeholder="Units" style={{ ...inp, flex: '0 0 90px' }} />
      <button type="submit" style={{ ...linkBtn, whiteSpace: 'nowrap' }}>+ Vest</button>
    </form>
  )
}

function AddEmploymentForm() {
  const { addEmployment } = useEmployment()
  const [f, setF] = useState({ employer: '', title: '', location: '', currency: 'EUR', start_date: '' })
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))

  return (
    <div style={card}>
      <h2 style={h2}>Compensation</h2>
      <p style={{ fontSize: 13, color: 'var(--mid)', margin: '6px 0 14px', lineHeight: 1.55 }}>
        What you're contracted to earn, kept separate from what has actually landed
        in an account — so a payday is never counted twice.
      </p>
      <form onSubmit={e => { e.preventDefault(); if (f.employer.trim()) addEmployment(f) }}
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={f.employer} onChange={set('employer')} placeholder="Employer" style={{ ...inp, flex: '1 1 140px' }} />
          <input value={f.title} onChange={set('title')} placeholder="Title" style={{ ...inp, flex: '1 1 140px' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={f.location} onChange={set('location')} placeholder="Location" style={{ ...inp, flex: '1 1 130px' }} />
          <input value={f.currency} onChange={set('currency')} placeholder="Pay currency" style={{ ...inp, flex: '0 0 110px' }} />
          <input type="date" value={f.start_date} onChange={set('start_date')} style={{ ...inp, flex: '1 1 140px' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" style={linkBtn}>Add employment</button>
        </div>
      </form>
    </div>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function CompensationPanel() {
  const isMobile = useIsMobile()
  const {
    employment, components, grants, projection, summary,
    fxMap, priceMap, missingRates, missingPrices,
    removeComponent, removeGrant, removeVest, removeEmployment,
    updateEmployment, setPrice, setFx,
  } = useEmployment()

  const [addingComp, setAddingComp] = useState(false)
  const [addingGrant, setAddingGrant] = useState(false)
  const [showInputs, setShowInputs] = useState(false)

  const box = isMobile ? cardTight : card

  if (!employment) return <AddEmploymentForm />

  const today = new Date().toISOString().slice(0, 10)
  const nextVests = grants
    .flatMap(g => (g.vests || []).map(v => ({ ...v, grant: g })))
    .filter(v => v.vest_date >= today)
    .sort((a, b) => a.vest_date.localeCompare(b.vest_date))
    .slice(0, 4)

  const needsInput = missingRates.length > 0 || missingPrices.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={h2}>Compensation</h2>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
              {employment.employer}{employment.title ? ` · ${employment.title}` : ''}{employment.location ? ` · ${employment.location}` : ''}
            </div>
          </div>
          <button onClick={() => setShowInputs(s => !s)} style={linkBtn}>
            {showInputs ? 'Hide inputs' : 'Valuation inputs'}
          </button>
        </div>

        {needsInput && (
          <div style={{ fontSize: 12.5, color: '#c15f3c', background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
            {missingRates.length > 0 && <>No GBP rate set for {missingRates.join(', ')}. </>}
            {missingPrices.length > 0 && <>No share price set for {missingPrices.join(', ')}. </>}
            Those amounts are being counted at face value, so the totals below are wrong until you set them.
          </div>
        )}

        {showInputs && (
          <div style={{ padding: 14, background: 'var(--surface-2)', borderRadius: 10, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.5 }}>
              Maintained by hand. Nothing here calls a market or FX API — that would
              be a network dependency and a data-leak surface for a number that only
              has to be roughly right.
            </div>
            {[...new Set([employment.currency, ...grants.map(g => g.currency), 'USD', 'EUR'])]
              .filter(c => c && c !== 'GBP').map(c => (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                  <span style={{ width: 80 }}>1 {c} =</span>
                  <input type="number" step="0.0001" defaultValue={fxMap[c] ?? ''} placeholder="rate"
                    onBlur={e => e.target.value && setFx(c, e.target.value)}
                    style={{ ...inp, width: 110 }} />
                  <span style={{ color: 'var(--muted)' }}>GBP</span>
                </label>
              ))}
            {[...new Set(grants.map(g => g.symbol))].filter(Boolean).map(sym => (
              <label key={sym} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ width: 80 }}>{sym}</span>
                <input type="number" step="0.01" defaultValue={priceMap[sym]?.price ?? ''} placeholder="share price"
                  onBlur={e => e.target.value && setPrice(sym, e.target.value, priceMap[sym]?.currency || 'USD')}
                  style={{ ...inp, width: 110 }} />
                <span style={{ color: 'var(--muted)' }}>
                  {priceMap[sym]?.currency || 'USD'}{priceMap[sym]?.as_of ? ` · as of ${priceMap[sym].as_of}` : ''}
                </span>
              </label>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ width: 80 }}>Tax rate</span>
              <input type="number" step="0.01" min="0" max="1" defaultValue={employment.effective_tax_rate}
                onBlur={e => updateEmployment(employment.id, { effective_tax_rate: Number(e.target.value) || 0 })}
                style={{ ...inp, width: 110 }} />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                effective, e.g. 0.42 — a flat estimate, not a tax calculation
              </span>
            </label>
          </div>
        )}

        {/* Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            ['Gross · next 12m', summary.gross_12m, 'var(--ink)'],
            ['Net · next 12m', summary.net_12m, 'var(--ink)'],
            ['Equity · next 12m', summary.equity_12m, '#4f7f45'],
            ['Avg / month', summary.avg_monthly_gross, 'var(--ink)'],
          ].map(([label, value, color]) => (
            <div key={label}>
              <div style={eyebrow}>{label}</div>
              <div style={{ marginTop: 4, fontFamily: "'Newsreader', serif", fontSize: 22, fontWeight: 500, color }}>
                {value ? fmt(value) : '—'}
              </div>
            </div>
          ))}
        </div>

        {projection.length > 0 && <ProjectionChart rows={projection} />}
      </div>

      {/* Pay components */}
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ ...h2, fontSize: 17 }}>Pay components</h2>
          <button onClick={() => setAddingComp(a => !a)} style={linkBtn}>{addingComp ? 'Cancel' : '+ Add'}</button>
        </div>

        {components.length === 0 && !addingComp && (
          <div style={{ fontSize: 13, color: 'var(--faint)', padding: '12px 0' }}>
            Nothing yet — add base salary, on-call pay, or a sign-on bonus.
          </div>
        )}

        {components.map(c => {
          const kind = KINDS.find(k => k.key === c.kind) || KINDS[3]
          const cadence = { annual: '/ year', monthly: '/ month', one_off: 'one-off' }[c.cadence]
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--bd-xs)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2.5, background: kind.color, flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {kind.label}
                  {c.start_date && ` · from ${c.start_date}`}
                  {c.end_date && ` to ${c.end_date}`}
                  {c.is_gross ? ' · gross' : ' · net'}
                </div>
              </div>
              <div style={{ textAlign: 'right', flex: 'none' }}>
                <div style={{ fontFamily: "'Newsreader', serif", fontSize: 15, fontWeight: 600 }}>
                  {new Intl.NumberFormat('en-GB', { style: 'currency', currency: c.currency, maximumFractionDigits: 0 }).format(c.amount)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{cadence}</div>
              </div>
              <button onClick={() => removeComponent(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 16, padding: '0 2px' }}>×</button>
            </div>
          )
        })}

        {addingComp && <AddComponentForm empId={employment.id} currency={employment.currency} onDone={() => setAddingComp(false)} />}
      </div>

      {/* Equity */}
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2 style={{ ...h2, fontSize: 17 }}>Equity</h2>
          <button onClick={() => setAddingGrant(a => !a)} style={linkBtn}>{addingGrant ? 'Cancel' : '+ Grant'}</button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 12, lineHeight: 1.5 }}>
          Held in units, not cash — a grant is only worth something at vest, and
          storing a guess as money is how a dashboard starts lying to you.
        </div>

        {nextVests.length > 0 && (
          <div style={{ marginBottom: 14, padding: 12, background: 'var(--surface-2)', borderRadius: 10 }}>
            <div style={{ ...eyebrow, marginBottom: 8 }}>Next vests</div>
            {nextVests.map(v => (
              <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}>
                <span style={{ color: 'var(--mid)' }}>{v.vest_date} · {v.grant.label}</span>
                <span style={{ fontWeight: 600 }}>{v.units} units</span>
              </div>
            ))}
          </div>
        )}

        {grants.length === 0 && !addingGrant && (
          <div style={{ fontSize: 13, color: 'var(--faint)', padding: '8px 0' }}>No grants yet.</div>
        )}

        {grants.map(g => (
          <div key={g.id} style={{ padding: '12px 0', borderTop: '1px solid var(--bd-xs)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{g.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {g.symbol} · {g.total_units} units{g.grant_date ? ` · granted ${g.grant_date}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: "'Newsreader', serif", fontSize: 15, fontWeight: 600, color: '#4f7f45' }}>{g.unvested_units}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>unvested</div>
              </div>
              <button onClick={() => window.confirm(`Delete grant "${g.label}"?`) && removeGrant(g.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 16, padding: '0 2px' }}>×</button>
            </div>

            {(g.vests || []).length > 0 && (
              <div style={{ marginTop: 8, paddingLeft: 2 }}>
                {g.vests.map(v => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--mid)', padding: '3px 0' }}>
                    <span style={{ flex: 1 }}>{v.vest_date}</span>
                    <span>{v.units} units</span>
                    <button onClick={() => removeVest(v.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 14, padding: '0 2px' }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <AddVestForm grantId={g.id} />
          </div>
        ))}

        {addingGrant && <AddGrantForm empId={employment.id} onDone={() => setAddingGrant(false)} />}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--bd-sm)' }}>
          <button onClick={() => window.confirm(`Remove ${employment.employer} and all its components?`) && removeEmployment(employment.id)}
            style={{ ...linkBtn, color: 'var(--faint)', fontWeight: 400 }}>Remove employment</button>
        </div>
      </div>
    </div>
  )
}
