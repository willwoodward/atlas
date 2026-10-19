import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { API } from '../context/InboxContext.jsx'
import { useFinances } from '../context/FinancesContext.jsx'
import { formatMoney } from '../lib/fx.js'
import { card } from './ui.jsx'

// History charts: how things have changed over time (backend/history.py).
//   LineChart       one or more lines over dates, with a hover readout;
//                   estimated stretches (before Atlas started recording) dashed
//   CashflowBars    income and spending per month
//   RangeTabs       30d / 90d / 1y / All
// Plus the sections the pages use: BalancesHistory (Finances), CashflowHistory
// (Finances), HabitConsistency (Habits), OpenTodosHistory (To-do).

export const SERIES_COLORS = ['var(--accent)', 'var(--blue)', 'var(--sage)', 'var(--gold)', 'var(--mauve)', 'var(--cat-1)']
const RANGES = [['30d', '30 days'], ['90d', '90 days'], ['1y', '1 year'], ['all', 'All']]

const shortDate = iso => new Date(iso + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const longDate = iso => new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

export function useHistoryApi() {
  const { token } = useAuth()
  return path => fetch(`${API}/api/history${path}`, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`Couldn't load the history (${r.status})`))))
}

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function RangeTabs({ value, onChange, options = RANGES }) {
  return (
    <div role="tablist" aria-label="Range" style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--surface-2)', border: '1px solid var(--bd)', borderRadius: 10 }}>
      {options.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          style={{ padding: '4px 9px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                   background: value === k ? 'var(--surface)' : 'transparent', color: value === k ? 'var(--ink)' : 'var(--muted)',
                   boxShadow: value === k ? '0 1px 3px var(--bd)' : 'none' }}>
          {l}
        </button>
      ))}
    </div>
  )
}

/** Round values for gridlines between lo and hi (steps of 1, 2, 2.5 or 5 × 10ⁿ). */
export function niceTicks(lo, hi, count = 3, integer = false) {
  const raw = (hi - lo) / count
  if (!(raw > 0)) return [lo]
  const mag = 10 ** Math.floor(Math.log10(raw))
  // Counts (to-dos) only step by whole numbers.
  const step = Math.max(integer ? 1 : 0, [1, 2, integer ? 2 : 2.5, 5, 10].map(m => m * mag).find(st => st >= raw))
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step || 0)   // never -0
  return out
}

/**
 * Lines over time. series: [{ label, color?, points: [{ date, value, estimated? }] }]
 * (value null = a gap). x is time, so thinned weekly points sit where they belong.
 */
export function LineChart({ series, height = 180, format = v => String(v), yFrom, yTo, integer = false, emptyText = '—' }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)   // a date
  const L = 4, R = 4, T = 10, B = 22
  const all = series.flatMap(s => s.points.filter(p => p.value != null))
  const dates = useMemo(() => [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort(), [series])
  if (!all.length) return <div ref={ref} style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--faint)' }}>{emptyText}</div>

  const t = iso => new Date(iso + 'T12:00').getTime()
  const t0 = t(dates[0]), t1 = t(dates[dates.length - 1])
  let lo = yFrom ?? Math.min(...all.map(p => p.value)), hi = yTo ?? Math.max(...all.map(p => p.value))
  if (hi === lo) { hi += Math.abs(hi) * 0.05 || 1; lo -= Math.abs(lo) * 0.05 || 1 }
  if (yFrom == null || yTo == null) { const pad = (hi - lo) * 0.08; if (yFrom == null) lo -= pad; if (yTo == null) hi += pad }
  const width = Math.max(w, 1)
  const x = iso => L + (t1 === t0 ? 0.5 : (t(iso) - t0) / (t1 - t0)) * (width - L - R)
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (height - T - B)

  // Each line as runs of points, dashed where either end is estimated.
  const segs = s => {
    const out = []
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i - 1], b = s.points[i]
      if (a.value == null || b.value == null) continue
      out.push({ a, b, dashed: a.estimated || b.estimated })
    }
    return out
  }
  const ticks = niceTicks(lo, hi, 3, integer)
  const xTicks = dates.length > 2 ? [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]] : dates
  const pick = e => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left)
    let best = dates[0], bd = Infinity
    for (const d of dates) { const dd = Math.abs(x(d) - px); if (dd < bd) { bd = dd; best = d } }
    setHover(best)
  }
  const at = hover && series.map(s => ({ s, p: s.points.find(p => p.date === hover) })).filter(r => r.p && r.p.value != null)
  const hx = hover ? x(hover) : 0

  return (
    <div ref={ref} style={{ position: 'relative', height, touchAction: 'pan-y' }}
      onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
          {ticks.map((v, i) => (
            <g key={i}>
              <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} stroke="var(--bd-sm)" />
              <text x={L} y={y(v) - 4} fontSize="10.5" fill="var(--faint)">{format(v)}</text>
            </g>
          ))}
          {series.map((s, si) => segs(s).map((g, i) => (
            <line key={`${si}-${i}`} x1={x(g.a.date)} y1={y(g.a.value)} x2={x(g.b.date)} y2={y(g.b.value)}
              stroke={s.color || SERIES_COLORS[si % SERIES_COLORS.length]} strokeWidth="2" strokeLinecap="round"
              strokeDasharray={g.dashed ? '4 4' : undefined} opacity={g.dashed ? 0.7 : 1} />
          )))}
          {series.map((s, si) => {
            const last = [...s.points].reverse().find(p => p.value != null)
            return last && <circle key={si} cx={x(last.date)} cy={y(last.value)} r="3.5" fill={s.color || SERIES_COLORS[si % SERIES_COLORS.length]} />
          })}
          {xTicks.map((d, i) => (
            <text key={d} x={x(d)} y={height - 6} fontSize="10.5" fill="var(--faint)"
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>{shortDate(d)}</text>
          ))}
          {hover && (
            <g>
              <line x1={hx} x2={hx} y1={T} y2={height - B} stroke="var(--bd-xl)" />
              {at.map(({ s, p }, i) => <circle key={i} cx={hx} cy={y(p.value)} r="4" fill="var(--surface)" stroke={s.color || SERIES_COLORS[series.indexOf(s) % SERIES_COLORS.length]} strokeWidth="2" />)}
            </g>
          )}
        </svg>
      )}
      {hover && at.length > 0 && (
        <div role="status" style={{ position: 'absolute', top: 0, [hx > width / 2 ? 'right' : 'left']: hx > width / 2 ? width - hx + 10 : hx + 10,
                                    pointerEvents: 'none', padding: '7px 10px', borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--bd)',
                                    boxShadow: '0 4px 14px var(--bd-sm)', fontSize: 12, whiteSpace: 'nowrap', zIndex: 2 }}>
          <div style={{ color: 'var(--muted)', marginBottom: 3 }}>{longDate(hover)}{at.some(r => r.p.estimated) ? ' · estimated' : ''}</div>
          {at.map(({ s, p }, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color || SERIES_COLORS[series.indexOf(s) % SERIES_COLORS.length] }} />
              {series.length > 1 && <span style={{ color: 'var(--mid)' }}>{s.label}</span>}
              <span style={{ fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{format(p.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Income and spending side by side for each month. */
export function CashflowBars({ months, format, height = 160 }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...months.flatMap(m => [m.income, m.spending]))
  if (!months.some(m => m.income || m.spending)) return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--faint)' }}>—</div>
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height }}>
        {months.map(m => (
          <div key={m.month} onPointerEnter={() => setHover(m.month)} onPointerLeave={() => setHover(null)}
            title={`${m.label}: in ${format(m.income)}, out ${format(m.spending)}`}
            style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, opacity: hover && hover !== m.month ? 0.55 : 1 }}>
            <div style={{ width: '42%', maxWidth: 18, height: `${(m.income / max) * 100}%`, minHeight: m.income ? 2 : 0, background: 'var(--sage)', borderRadius: '3px 3px 0 0' }} />
            <div style={{ width: '42%', maxWidth: 18, height: `${(m.spending / max) * 100}%`, minHeight: m.spending ? 2 : 0, background: 'var(--accent)', borderRadius: '3px 3px 0 0', opacity: m.current ? 0.7 : 1 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 5 }}>
        {months.map(m => <span key={m.month} style={{ flex: 1, textAlign: 'center', fontSize: 10.5, color: m.current ? 'var(--ink)' : 'var(--faint)' }}>{m.label}</span>)}
      </div>
      <div style={{ minHeight: 18, marginTop: 6, fontSize: 12, color: 'var(--mid)' }}>
        {(() => {
          const m = months.find(x => x.month === hover) || months[months.length - 1]
          const net = m.income - m.spending
          return <>{m.label}{m.current ? ' so far' : ''}: <span style={{ color: 'var(--sage)' }}>in {format(m.income)}</span> · <span style={{ color: 'var(--accent)' }}>out {format(m.spending)}</span> · {net >= 0 ? 'kept' : 'short'} <b style={{ color: 'var(--ink)' }}>{format(Math.abs(net))}</b></>
        })()}
      </div>
    </div>
  )
}

export function Legend({ items }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
      {items.map((l, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mid)' }}>
          <span style={{ width: 10, height: 3, borderRadius: 2, background: l.color }} />{l.label}
        </span>
      ))}
    </div>
  )
}

const EstimatedNote = ({ series }) => {
  const since = series.map(s => s.recorded_since).filter(Boolean).sort()[0]
  const any = series.some(s => s.points.some(p => p.estimated))
  if (!any) return null
  return (
    <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 8, lineHeight: 1.45 }}>
      Dashed: estimated from your balances and imported transactions{since ? `, before Atlas started recording on ${shortDate(since)}` : ''}.
    </div>
  )
}

const Section = ({ title, right, children, style }) => (
  <div style={{ ...card, ...style }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600 }}>{title}</h2>
      {right}
    </div>
    {children}
  </div>
)

// ── Finances ─────────────────────────────────────────────────────────────────

/** Money series in the app's display currency (each converted from its own). */
export function useDisplayMoney() {
  const fin = useFinances()
  const currency = fin?.displayCurrency || 'EUR'
  const convert = (v, from) => (fin?.toDisplay ? fin.toDisplay(v, from || 'EUR') ?? v : v)
  return { convert, format: v => formatMoney(v, currency, 0), currency }
}

export function BalancesHistory() {
  const api = useHistoryApi()
  const { convert, format } = useDisplayMoney()
  const [range, setRange] = useState(() => { try { return localStorage.getItem('atlas:history-range') || '90d' } catch { return '90d' } })
  const [keys, setKeys] = useState(['net_worth'])
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { try { localStorage.setItem('atlas:history-range', range) } catch { /* not kept */ } }, [range])
  useEffect(() => {
    let live = true
    api(`?keys=${encodeURIComponent(keys.join(','))}&range=${range}`).then(d => { if (live) { setData(d); setErr(null) } }).catch(e => live && setErr(e.message))
    return () => { live = false }
  }, [range, keys.join(',')]) // eslint-disable-line
  const options = (data?.available || []).filter(o => o.key !== 'open_todos')
  const series = (data?.series || []).map((s, i) => ({
    ...s, color: SERIES_COLORS[keys.indexOf(s.key) % SERIES_COLORS.length] || SERIES_COLORS[i],
    points: s.points.map(p => ({ ...p, value: convert(p.value, s.currency) })),
  }))
  const toggle = k => setKeys(ks => (ks.includes(k) ? (ks.length > 1 ? ks.filter(x => x !== k) : ks) : [...ks, k]))
  const first = series[0]?.points.find(p => p.value != null), last = series[0] && [...series[0].points].reverse().find(p => p.value != null)
  return (
    <Section title="Over time" right={<RangeTabs value={range} onChange={setRange} />}>
      {first && last && series.length === 1 && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 500, color: 'var(--ink)' }}>{format(last.value)}</span>
          <span style={{ fontSize: 12.5, color: last.value - first.value >= 0 ? 'var(--sage)' : 'var(--accent)' }}>
            {last.value - first.value >= 0 ? '+' : '−'}{format(Math.abs(last.value - first.value))} since {shortDate(first.date)}{first.estimated ? ' (estimated)' : ''}
          </span>
        </div>
      )}
      {err ? <div style={{ fontSize: 13, color: 'var(--accent)' }}>{err}</div>
        : !data ? <div style={{ height: 180, fontSize: 13, color: 'var(--muted)' }}>Loading…</div>
        : <LineChart series={series} format={format} />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        {options.map(o => {
          const on = keys.includes(o.key)
          const color = SERIES_COLORS[keys.indexOf(o.key) % SERIES_COLORS.length]
          return (
            <button key={o.key} type="button" aria-pressed={on} onClick={() => toggle(o.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                       border: `1px solid ${on ? 'var(--bd-xl)' : 'var(--bd)'}`, background: on ? 'var(--surface-2)' : 'transparent', color: on ? 'var(--ink)' : 'var(--muted)' }}>
              <span style={{ width: 10, height: 3, borderRadius: 2, background: on ? color : 'var(--bd-xl)' }} />{o.label}
            </button>
          )
        })}
      </div>
      {data && <EstimatedNote series={data.series} />}
    </Section>
  )
}

export function CashflowHistory() {
  const api = useHistoryApi()
  const { convert, format } = useDisplayMoney()
  const [months, setMonths] = useState('12')
  const [data, setData] = useState(null)
  useEffect(() => { api(`/cashflow?months=${months}`).then(setData).catch(() => setData({ months: [] })) }, [months]) // eslint-disable-line
  const rows = (data?.months || []).map(m => ({ ...m, income: convert(m.income, 'EUR'), spending: convert(m.spending, 'EUR') }))
  return (
    <Section title="Income and spending" right={<RangeTabs value={months} onChange={setMonths} options={[['6', '6 months'], ['12', '12 months'], ['24', '2 years']]} />}>
      {data ? <CashflowBars months={rows} format={format} /> : <div style={{ height: 160 }} />}
      <div style={{ marginTop: 8 }}><Legend items={[{ label: 'Income', color: 'var(--sage)' }, { label: 'Spending', color: 'var(--accent)' }]} /></div>
    </Section>
  )
}

// ── Habits ───────────────────────────────────────────────────────────────────

export function HabitConsistency({ style }) {
  const api = useHistoryApi()
  const [weeks, setWeeks] = useState('12')
  const [data, setData] = useState(null)
  const [only, setOnly] = useState(null)   // a habit id, to see one on its own
  useEffect(() => { api(`/habits?weeks=${weeks}`).then(setData).catch(() => setData({ weeks: [], habits: [] })) }, [weeks]) // eslint-disable-line
  const habits = (data?.habits || []).filter(h => !only || h.id === only)
  const series = habits.map(h => ({ label: h.name, color: h.color, points: data.weeks.map((w, i) => ({ date: w, value: h.values[i] })) }))
  return (
    <Section style={style} title="Consistency" right={<RangeTabs value={weeks} onChange={setWeeks} options={[['8', '8 weeks'], ['12', '12 weeks'], ['26', '6 months'], ['52', '1 year']]} />}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -6, marginBottom: 10 }}>Share of days each habit was done, week by week.</div>
      {data ? <LineChart series={series} format={v => `${Math.round(v)}%`} yFrom={0} yTo={100} emptyText="No habits yet." /> : <div style={{ height: 180 }} />}
      {data?.habits?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {data.habits.map(h => {
            const avg = h.values.filter(v => v != null)
            const mean = avg.length ? Math.round(avg.reduce((a, b) => a + b, 0) / avg.length) : null
            const on = !only || only === h.id
            return (
              <button key={h.id} type="button" aria-pressed={only === h.id} onClick={() => setOnly(o => (o === h.id ? null : h.id))}
                title={only === h.id ? 'Show all habits' : 'Show just this one'}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                         border: '1px solid var(--bd)', background: only === h.id ? 'var(--surface-2)' : 'transparent', color: on ? 'var(--ink)' : 'var(--faint)' }}>
                <span style={{ width: 10, height: 3, borderRadius: 2, background: on ? h.color : 'var(--bd-xl)' }} />
                {h.name}<span style={{ color: 'var(--muted)' }}>{mean != null ? ` · ${mean}%` : ''}</span>
              </button>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ── To-dos ───────────────────────────────────────────────────────────────────

export function OpenTodosHistory({ style }) {
  const api = useHistoryApi()
  const [range, setRange] = useState('90d')
  const [data, setData] = useState(null)
  useEffect(() => { api(`?keys=open_todos&range=${range}`).then(setData).catch(() => setData({ series: [] })) }, [range]) // eslint-disable-line
  const series = (data?.series || []).map(s => ({ ...s, color: 'var(--blue)' }))
  return (
    <Section title="Open to-dos over time" right={<RangeTabs value={range} onChange={setRange} options={RANGES.slice(0, 3)} />} style={style}>
      {data ? <LineChart series={series} height={140} format={v => String(Math.round(v))} yFrom={0} integer /> : <div style={{ height: 140 }} />}
      {data?.series?.some(s => s.points.some(p => p.estimated)) && (
        <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 8 }}>Dashed: estimated from when to-dos were added and finished, before Atlas started recording.</div>
      )}
    </Section>
  )
}

// ── In the chat ──────────────────────────────────────────────────────────────

/** Atlas's history_chart card (backend/agent_cards.py). */
export function HistoryCardBody({ card }) {
  const { convert, format } = useDisplayMoney()
  if (card.chart === 'cashflow') {
    const rows = card.months.map(m => ({ ...m, income: convert(m.income, 'EUR'), spending: convert(m.spending, 'EUR') }))
    return <><CashflowBars months={rows} format={format} height={130} /><Legend items={[{ label: 'Income', color: 'var(--sage)' }, { label: 'Spending', color: 'var(--accent)' }]} /></>
  }
  if (card.chart === 'habits') {
    const series = card.habits.map(h => ({ label: h.name, color: h.color, points: card.weeks.map((w, i) => ({ date: w, value: h.values[i] })) }))
    return <><LineChart series={series} height={150} format={v => `${Math.round(v)}%`} yFrom={0} yTo={100} /><div style={{ marginTop: 8 }}><Legend items={series.map(s => ({ label: s.label, color: s.color }))} /></div></>
  }
  const money = card.series.every(s => s.unit === 'money')
  const series = card.series.map((s, i) => ({ ...s, color: SERIES_COLORS[i % SERIES_COLORS.length],
    points: s.points.map(p => ({ ...p, value: s.unit === 'money' ? convert(p.value, s.currency) : p.value })) }))
  return (
    <>
      <LineChart series={series} height={150} format={money ? format : v => String(Math.round(v))} integer={!money} />
      {series.length > 1 && <div style={{ marginTop: 8 }}><Legend items={series.map(s => ({ label: s.label, color: s.color }))} /></div>}
      <EstimatedNote series={card.series} />
    </>
  )
}

