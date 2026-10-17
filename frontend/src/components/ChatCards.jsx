import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useRefresh } from '../context/RefreshContext.jsx'
import { useFinances } from '../context/FinancesContext.jsx'
import { useTodos } from '../context/TodosContext.jsx'
import { SLOT_COLORS, OTHER_COLOR, NONE_COLOR, UNCATEGORISED } from '../lib/categories.js'
import { formatMoney } from '../lib/fx.js'
import { openShow } from '../lib/focus.js'
import { renderMarkdown } from '../lib/markdown.js'
import { localDateStr } from '../lib/week.js'
import { eyebrow, figure, Button } from './ui.jsx'

// What Atlas's tools draw in the chat. A tool result can carry a `card`
// (backend/agent_tools.py, agent_cards.py) and a `show` — what the card's
// Open button opens. Kept small: the chat column is narrow, especially in the
// side panel. Most cards can be acted on: tap a row to open it, tick a to-do,
// pick an option, book a free slot.
//
// `onChoose(text)` sends a message as if typed (choices, booking a slot);
// where there's nowhere to send one, those cards are read-only.

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Card amounts come in EUR; shown in the app's display currency (EUR/GBP)
// at the latest rate, the way Finances shows balances.
function useMoney() {
  const fin = useFinances()
  const currency = fin?.displayCurrency || 'EUR'
  return (eur, digits = 0) => {
    const v = fin?.toDisplay ? fin.toDisplay(eur || 0, 'EUR') : eur
    return v == null ? formatMoney(eur || 0, 'EUR', digits) : formatMoney(v, currency, digits)
  }
}

const hm = h => {
  if (h == null) return ''
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return `${hh}:${String(mm).padStart(2, '0')}`
}
const signed = (n, money) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`

// Event colour names from the tools → the app's palette.
const EVENT_COLORS = { coral: 'var(--accent)', sage: 'var(--sage)', blue: 'var(--blue)', gold: 'var(--gold)', mauve: 'var(--mauve)', grey: 'var(--stone)' }
const eventColor = c => (c && c.startsWith('#') ? c : EVENT_COLORS[c] || 'var(--blue)')

const rowButton = { display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }

function Frame({ title, action, children, note, kind }) {
  return (
    <div data-card={kind} style={{ margin: '8px 0 12px', padding: '14px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--bd)' }}>
      {(title || action) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ ...eyebrow, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          {action}
        </div>
      )}
      {children}
      {note && <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--faint)' }}>{note}</div>}
    </div>
  )
}

const OpenButton = ({ show, label = 'Open' }) => show
  ? <Button variant="ghost" size="sm" onClick={() => openShow(show)} style={{ flex: 'none', padding: '3px 9px', fontSize: 11.5 }}>{label} →</Button>
  : null

// ── Money ────────────────────────────────────────────────────────────────────

function BreakdownCard({ card, show }) {
  const money = useMoney()
  const max = Math.max(1, ...card.rows.map(r => r.amount))
  const color = (r, i) => r.label === UNCATEGORISED ? NONE_COLOR : r.other ? OTHER_COLOR : SLOT_COLORS[i] || OTHER_COLOR
  // A category opens Finances filtered to it; a merchant opens search.
  const open = r => r.other ? null : card.by === 'merchant'
    ? () => openShow({ kind: 'search', query: r.label })
    : () => openShow({ kind: 'finances', category: r.label, range: card.range, type: card.kind || 'expense' })
  return (
    <Frame title={card.title} action={<OpenButton show={show} />}>
      <div style={{ ...figure, fontSize: 24, marginBottom: 10 }}>{money(card.total)}</div>
      {card.rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing in this period.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {card.rows.map((r, i) => {
          const onClick = open(r)
          const body = (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, marginBottom: 3 }}>
                <span style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.label}{r.other ? ` (${r.other} more)` : ''}
                </span>
                <span style={{ color: 'var(--mid)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
                  {money(r.amount)}
                  <span style={{ color: 'var(--faint)' }}> · {Math.round((r.amount / (card.total || 1)) * 100)}%</span>
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-3)' }}>
                <div style={{ width: `${(r.amount / max) * 100}%`, height: '100%', borderRadius: 99, background: color(r, i) }} />
              </div>
            </>
          )
          return onClick
            ? <button key={r.label + i} onClick={onClick} className="card-row" style={{ ...rowButton, padding: '3px 4px', margin: '0 -4px', borderRadius: 6 }} title={`Open ${r.label}`}>{body}</button>
            : <div key={r.label + i} style={{ padding: '3px 0' }}>{body}</div>
        })}
      </div>
    </Frame>
  )
}

/** Change per category as bars either side of a centre line: up is spending more. */
function CompareCard({ card }) {
  const money = useMoney()
  const diff = card.a.total - card.b.total
  const max = Math.max(1, ...card.rows.map(r => Math.abs(r.change)))
  return (
    <Frame title={card.title}>
      <div style={{ display: 'flex', gap: 18, marginBottom: 14, flexWrap: 'wrap' }}>
        {[card.a, card.b].map(p => (
          <div key={p.label}>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{p.label}</div>
            <div style={{ ...figure, fontSize: 21 }}>{money(p.total)}</div>
          </div>
        ))}
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Change</div>
          <div style={{ ...figure, fontSize: 21, color: diff > 0 ? 'var(--accent)' : 'var(--sage)' }}>{signed(diff, money)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {card.rows.map(r => {
          const up = r.change > 0, w = (Math.abs(r.change) / max) * 50
          return (
            <button key={r.label} onClick={() => card.range && openShow({ kind: 'finances', category: r.label, range: card.range, type: card.kind || 'expense' })}
              className="card-row" style={{ ...rowButton, padding: '2px 4px', margin: '0 -4px', borderRadius: 6 }}
              title={`${r.label}: ${money(r.a)} vs ${money(r.b)}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, marginBottom: 3 }}>
                <span style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                <span style={{ flex: 'none', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: up ? 'var(--accent)' : 'var(--sage)' }}>{signed(r.change, money)}</span>
              </div>
              <div style={{ position: 'relative', height: 6, borderRadius: 99, background: 'var(--surface-3)' }}>
                <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--bd-xl)' }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, borderRadius: 99, background: up ? 'var(--accent)' : 'var(--sage)',
                              ...(up ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }) }} />
              </div>
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--faint)' }}>
        <span>← less than {card.b.label.toLowerCase()}</span><span>more →</span>
      </div>
    </Frame>
  )
}

function CategoryPicker({ txn, onPicked }) {
  const { token } = useAuth()
  const fin = useFinances()
  const { refresh } = useRefresh()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const cats = [...new Set((fin?.transactions || []).map(t => (t.category || '').trim()).filter(Boolean))].sort()
  const pick = async category => {
    setBusy(true)
    try {
      const res = await fetch(`${API}/api/finances/transactions/${txn.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ category }),
      })
      if (res.ok) { onPicked(category); fin?.refetch?.(); refresh() }
    } finally { setBusy(false); setOpen(false) }
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} title="Change category"
        style={{ ...rowButton, display: 'inline', width: 'auto', fontSize: 11, color: txn.category === UNCATEGORISED ? 'var(--accent)' : 'var(--muted)', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}>
        {txn.category}
      </button>
    )
  }
  return (
    <select autoFocus disabled={busy} defaultValue="" onBlur={() => setOpen(false)}
      onChange={e => { const v = e.target.value === '__new' ? window.prompt('New category')?.trim() : e.target.value; if (v) pick(v); else setOpen(false) }}
      style={{ fontSize: 11.5, padding: '1px 4px', borderRadius: 6, border: '1px solid var(--bd-xl)', background: 'var(--surface-2)', color: 'var(--ink)', fontFamily: 'inherit' }}>
      <option value="" disabled>Category…</option>
      {cats.map(c => <option key={c} value={c}>{c}</option>)}
      <option value="__new">New category…</option>
    </select>
  )
}

function TransactionsCard({ card }) {
  const money = useMoney()
  const [cats, setCats] = useState({})
  return (
    <Frame title={card.title} action={<OpenButton show={{ kind: 'page', page: 'finances' }} label="Finances" />}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
        {card.matches} match{card.matches === 1 ? '' : 'es'}{card.rows.length < card.matches ? ` · showing ${card.rows.length}` : ''} · net {card.total < 0 ? '−' : ''}{money(Math.abs(card.total), 2)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {card.rows.map(t => {
          const txn = { ...t, category: cats[t.id] || t.category }
          return (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--bd-xs)', fontSize: 12.5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: t.type === 'income' ? 'var(--sage)' : 'var(--accent)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.date} · <CategoryPicker txn={txn} onPicked={c => setCats(x => ({ ...x, [t.id]: c }))} /></div>
              </div>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>
                {t.type === 'income' ? '+' : '−'}{money(t.eur, 2)}
              </span>
            </div>
          )
        })}
      </div>
    </Frame>
  )
}

function BudgetsCard({ card, show }) {
  const money = useMoney()
  return (
    <Frame title={card.title} action={<OpenButton show={show} label="Finances" />}
      note={`The line marks where you'd be on an even pace (${Math.round(card.elapsed * 100)}% through the month).`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {card.rows.map(b => {
          const pct = b.amount > 0 ? b.spent / b.amount : 0
          const expected = b.amount * card.elapsed
          const ahead = b.spent - expected
          const over = b.spent > b.amount
          const tone = over ? 'var(--accent)' : ahead > b.amount * 0.05 ? 'var(--gold)' : 'var(--sage)'
          return (
            <button key={b.name} className="card-row" style={{ ...rowButton, padding: '2px 4px', margin: '0 -4px', borderRadius: 6 }}
              onClick={() => openShow({ kind: 'finances', category: b.categories?.length === 1 ? b.categories[0] : null, type: 'expense' })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, marginBottom: 4 }}>
                <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{b.name}</span>
                <span style={{ color: 'var(--mid)', fontVariantNumeric: 'tabular-nums' }}>{money(b.spent)} <span style={{ color: 'var(--faint)' }}>of {money(b.amount)}</span></span>
              </div>
              <div style={{ position: 'relative', height: 8, borderRadius: 99, background: 'var(--surface-3)' }}>
                <div style={{ width: `${Math.min(pct, 1) * 100}%`, height: '100%', borderRadius: 99, background: tone }} />
                <div title="Even pace" style={{ position: 'absolute', left: `${card.elapsed * 100}%`, top: -3, bottom: -3, width: 2, borderRadius: 1, background: 'var(--ink)', opacity: 0.55 }} />
              </div>
              <div style={{ fontSize: 11.5, marginTop: 4, color: tone }}>
                {over ? `${money(b.spent - b.amount)} over budget`
                  : Math.abs(ahead) < b.amount * 0.05 ? 'On pace'
                  : ahead > 0 ? `${money(ahead)} ahead of pace` : `${money(-ahead)} under pace`}
              </div>
            </button>
          )
        })}
      </div>
    </Frame>
  )
}

// ── Calendar ─────────────────────────────────────────────────────────────────

/** Hours a set of day columns should cover: at least 8–20, wider if needed. */
function hourRange(days, extra = []) {
  let lo = 8, hi = 20
  for (const d of days) for (const e of [...(d.events || d.busy || []), ...extra]) {
    if (e.all_day || (e.start_h ?? e.start) == null) continue
    lo = Math.min(lo, Math.floor(e.start_h ?? e.start)); hi = Math.max(hi, Math.ceil(e.end_h ?? e.end ?? 0))
  }
  return [Math.max(0, lo), Math.min(24, hi)]
}

function TimeAxis({ lo, hi, height }) {
  const marks = []
  for (let h = lo; h < hi; h += hi - lo > 10 ? 3 : 2) marks.push(h)
  return (
    <div style={{ position: 'relative', width: 30, flex: 'none', height }}>
      {marks.map(h => (
        <span key={h} style={{ position: 'absolute', top: ((h - lo) / (hi - lo)) * height - 6, right: 4, fontSize: 10, color: 'var(--faint)', fontVariantNumeric: 'tabular-nums' }}>{h}:00</span>
      ))}
    </div>
  )
}

/**
 * A mini timeline: one column per day, events as blocks sized by their
 * length, a line for now. Tap an event to open it.
 */
function DayCard({ card, show }) {
  const days = card.days || [{ date: card.date, title: card.title, events: card.events || [] }]
  const [lo, hi] = hourRange(days)
  const H = Math.max(220, Math.min(380, (hi - lo) * 26))
  const today = localDateStr(new Date())
  const nowH = new Date().getHours() + new Date().getMinutes() / 60
  const many = days.length > 1
  const allDay = days.some(d => d.events.some(e => e.all_day))
  return (
    <Frame title={card.title} action={<OpenButton show={show} label="Calendar" />}>
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
        <div style={{ flex: 'none', paddingTop: (many ? 18 : 0) + (allDay ? 24 : 0) }}><TimeAxis lo={lo} hi={hi} height={H} /></div>
        {days.map(d => (
          <div key={d.date} style={{ flex: 1, minWidth: many ? 64 : 160 }}>
            {many && <div style={{ fontSize: 11, fontWeight: 600, color: d.date === today ? 'var(--accent)' : 'var(--mid)', textAlign: 'center', height: 18 }}>{d.title}</div>}
            {allDay && (
              <div style={{ height: 24, display: 'flex', gap: 2, overflow: 'hidden' }}>
                {d.events.filter(e => e.all_day).map(e => (
                  <button key={e.id} onClick={() => openShow({ kind: 'event', id: e.id, date: d.date })} title={e.title}
                    style={{ ...rowButton, flex: 1, minWidth: 0, height: 20, padding: '0 6px', borderRadius: 5, fontSize: 10.5, background: 'var(--surface-3)', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</button>
                ))}
              </div>
            )}
            <div style={{ position: 'relative', height: H, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--bd-xs)' }}>
              {Array.from({ length: hi - lo - 1 }, (_, i) => (
                <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: ((i + 1) / (hi - lo)) * H, borderTop: '1px solid var(--bd-xs)' }} />
              ))}
              {d.events.filter(e => !e.all_day && e.start_h != null).map(e => {
                const top = ((Math.max(e.start_h, lo) - lo) / (hi - lo)) * H
                const h = Math.max(14, ((Math.min(e.end_h ?? e.start_h + 1, hi) - Math.max(e.start_h, lo)) / (hi - lo)) * H - 2)
                const lit = card.highlight && e.id === card.highlight
                return (
                  <button key={e.id} onClick={() => openShow({ kind: 'event', id: e.id, date: d.date })} title={`${hm(e.start_h)}–${hm(e.end_h)} ${e.title}`}
                    className={lit ? 'card-lit' : undefined}
                    style={{ ...rowButton, position: 'absolute', left: 3, right: 3, top, height: h, padding: '2px 6px', borderRadius: 5, overflow: 'hidden',
                             background: 'var(--surface)', borderLeft: `3px solid ${eventColor(e.color)}`, boxShadow: lit ? '0 0 0 2px var(--accent)' : '0 1px 2px var(--bd)', fontSize: 11 }}>
                    <div style={{ fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                    {h > 26 && !many && <div style={{ color: 'var(--muted)', fontSize: 10.5 }}>{hm(e.start_h)}–{hm(e.end_h)}</div>}
                  </button>
                )
              })}
              {d.date === today && nowH > lo && nowH < hi && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: ((nowH - lo) / (hi - lo)) * H, borderTop: '2px solid var(--accent)', pointerEvents: 'none' }}>
                  <span style={{ position: 'absolute', left: -3, top: -4, width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
                </div>
              )}
              {d.events.length === 0 && !many && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, color: 'var(--muted)' }}>Nothing on.</div>}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  )
}

/** Free time across days: busy blocks grey, free windows green. Tap a free window to book it. */
function WeekCard({ card, onChoose }) {
  const lo = Math.floor(card.from ?? 8), hi = Math.ceil(card.to ?? 22)
  const H = Math.max(180, Math.min(300, (hi - lo) * 16))
  const fmtDay = iso => new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <Frame title={card.title} note={onChoose ? 'Tap a green slot to book it.' : null}>
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
        <div style={{ flex: 'none', paddingTop: 18 }}><TimeAxis lo={lo} hi={hi} height={H} /></div>
        {card.days.map(d => (
          <div key={d.date} style={{ flex: 1, minWidth: 52 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--mid)', textAlign: 'center', height: 18 }}>{d.weekday} {Number(d.date.slice(8))}</div>
            <div style={{ position: 'relative', height: H, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--bd-xs)' }}>
              {(d.busy || []).filter(b => b.end > lo && b.start < hi).map((b, i) => (
                <div key={i} title={`${hm(b.start)}–${hm(b.end)} ${b.title}`}
                  style={{ position: 'absolute', left: 3, right: 3, top: ((Math.max(b.start, lo) - lo) / (hi - lo)) * H, height: Math.max(4, ((Math.min(b.end, hi) - Math.max(b.start, lo)) / (hi - lo)) * H - 1),
                           borderRadius: 4, background: 'var(--surface-3)' }} />
              ))}
              {d.free.map((f, i) => {
                const label = `${fmtDay(d.date)} at ${hm(f.start)}`
                return (
                  <button key={i} disabled={!onChoose} onClick={() => onChoose?.(`Book it for ${label}.`)}
                    title={`Free ${hm(f.start)}–${hm(f.end)}`} aria-label={`Free ${fmtDay(d.date)} ${hm(f.start)} to ${hm(f.end)}`}
                    className="card-slot"
                    style={{ ...rowButton, position: 'absolute', left: 3, right: 3, top: ((f.start - lo) / (hi - lo)) * H + 1, height: Math.max(6, ((f.end - f.start) / (hi - lo)) * H - 2),
                             borderRadius: 5, background: 'color-mix(in srgb, var(--sage) 22%, transparent)', border: '1px solid color-mix(in srgb, var(--sage) 55%, transparent)',
                             cursor: onChoose ? 'pointer' : 'default', fontSize: 10, color: 'var(--sage)', fontWeight: 600, padding: '2px 4px', overflow: 'hidden',
                             display: 'flex', alignItems: 'flex-start' }}>
                    {((f.end - f.start) / (hi - lo)) * H > 16 ? hm(f.start) : ''}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  )
}

// ── Changes and choices ──────────────────────────────────────────────────────

/** Before → after for something Atlas edited. (Undo is on the line above.) */
function ChangeCard({ card }) {
  if (!card.rows?.length) return null
  return (
    <Frame title={card.title} action={<OpenButton show={card.show} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {card.rows.map(r => (
          <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, auto) 1fr', gap: '2px 12px', fontSize: 13 }}>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{r.label}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ color: 'var(--faint)', textDecoration: r.before === '—' ? 'none' : 'line-through', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.before}</span>
              <span style={{ color: 'var(--muted)', margin: '0 6px' }}>→</span>
              <span style={{ color: 'var(--ink)', fontWeight: 500, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.after}</span>
            </span>
          </div>
        ))}
      </div>
    </Frame>
  )
}

function ChoicesCard({ card, onChoose }) {
  const [picked, setPicked] = useState(null)
  return (
    <Frame title={card.question || 'Pick one'}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {card.options.map(o => (
          <Button key={o} size="md" variant={picked === o ? 'primary' : 'secondary'} disabled={!onChoose || (picked && picked !== o)}
            onClick={() => { if (picked) return; setPicked(o); onChoose(o) }}>{o}</Button>
        ))}
      </div>
    </Frame>
  )
}

// ── Lists ────────────────────────────────────────────────────────────────────

function TodosCard({ card, show }) {
  const todos = useTodos()
  const [local, setLocal] = useState({})
  // The live list wins over the snapshot, so ticking elsewhere shows here too.
  const live = id => todos?.todos?.find(t => t.id === id)
  const done = r => local[r.id] ?? live(r.id)?.done ?? r.done
  const toggle = async r => {
    setLocal(x => ({ ...x, [r.id]: !done(r) }))
    try { await todos.toggleTodo(r.id) } catch { setLocal(x => ({ ...x, [r.id]: undefined })) }
  }
  const groups = card.rows.reduce((g, r) => ((g[r.bucket] ||= []).push(r), g), {})
  const LABEL = { today: 'Today', week: 'This week', someday: 'Someday' }
  return (
    <Frame title={card.title} action={<OpenButton show={show} label="To-do" />}>
      {card.rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing on the list.</div>}
      {Object.entries(groups).map(([bucket, rows]) => (
        <div key={bucket} style={{ marginBottom: 6 }}>
          {Object.keys(groups).length > 1 && <div style={{ ...eyebrow, fontSize: 10, margin: '4px 0' }}>{LABEL[bucket] || bucket}</div>}
          {rows.map(r => (
            <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', paddingLeft: r.parent_id ? 22 : 0, fontSize: 13.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!done(r)} onChange={() => toggle(r)} disabled={!todos}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)', flex: 'none', cursor: 'pointer' }} />
              <span style={{ color: done(r) ? 'var(--faint)' : 'var(--ink)', textDecoration: done(r) ? 'line-through' : 'none' }}>{r.text}</span>
            </label>
          ))}
        </div>
      ))}
    </Frame>
  )
}

function HabitsCard({ card, show }) {
  const short = iso => new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'narrow' })
  const dense = card.days.length > 14
  return (
    <Frame title={card.title} action={<OpenButton show={show} label="Habits" />}>
      {card.rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No habits yet.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!dense && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ flex: 1 }} />
            <span style={{ display: 'flex', gap: 4 }}>{card.days.map(d => <span key={d} style={{ width: 14, textAlign: 'center', fontSize: 10, color: 'var(--faint)' }}>{short(d)}</span>)}</span>
            <span style={{ width: 58 }} />
          </div>
        )}
        {card.rows.map(h => (
          <div key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
            <span style={{ display: 'flex', gap: dense ? 2 : 4, flexWrap: dense ? 'wrap' : 'nowrap', maxWidth: dense ? 190 : 'none' }}>
              {h.done.map((on, i) => (
                <span key={i} title={card.days[i]} style={{ width: dense ? 8 : 14, height: dense ? 8 : 14, borderRadius: dense ? 2 : '50%', background: on ? (h.color || 'var(--sage)') : 'var(--surface-3)' }} />
              ))}
            </span>
            <span style={{ width: 58, textAlign: 'right', fontSize: 11.5, color: h.streak ? 'var(--ink)' : 'var(--faint)', fontVariantNumeric: 'tabular-nums' }}>
              {h.streak ? `${h.streak}-day run` : '—'}
            </span>
          </div>
        ))}
      </div>
    </Frame>
  )
}

/** Bars over time (or a line), optionally stacked by goal. */
function TrendCard({ card, show }) {
  const money = useMoney()
  const fmt = v => card.unit === 'money' ? money(v) : card.unit === 'hours' ? `${Math.round(v * 10) / 10}h` : `${v}${card.unit ? ' ' + card.unit : ''}`
  const pts = card.points || []
  const vals = pts.map(p => p.value)
  const maxV = Math.max(...vals, 0), minV = card.line ? Math.min(...vals) : 0
  const span = maxV - minV || 1
  const H = 120
  const last = pts[pts.length - 1]
  const prev = pts[pts.length - 2]
  return (
    <Frame title={card.title} action={<OpenButton show={show} />} note={card.note}>
      {last && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <span style={{ ...figure, fontSize: 22 }}>{fmt(last.value)}</span>
          {prev && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{last.current ? 'so far' : ''} · {prev.label}: {fmt(prev.value)}</span>}
        </div>
      )}
      {card.line ? (
        <div style={{ position: 'relative', height: H }}>
          <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: H, overflow: 'visible' }}>
            <polyline fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round"
              points={pts.map((p, i) => `${((i + 0.5) / pts.length) * 100},${H - 8 - ((p.value - minV) / span) * (H - 16)}`).join(' ')} />
          </svg>
          {pts.map((p, i) => (
            <span key={i} title={`${p.label}: ${fmt(p.value)}`}
              style={{ position: 'absolute', left: `${((i + 0.5) / pts.length) * 100}%`, top: H - 8 - ((p.value - minV) / span) * (H - 16),
                       width: p.current ? 9 : 7, height: p.current ? 9 : 7, marginLeft: p.current ? -4.5 : -3.5, marginTop: p.current ? -4.5 : -3.5,
                       borderRadius: '50%', background: p.current ? 'var(--accent)' : 'var(--surface)', border: '2px solid var(--accent)', boxSizing: 'border-box' }} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: H }}>
          {pts.map((p, i) => (
            <div key={i} title={`${p.label}: ${fmt(p.value)}`} style={{ flex: 1, height: `${Math.max(p.value > 0 ? 3 : 0, (p.value / (maxV || 1)) * 100)}%`, display: 'flex', flexDirection: 'column-reverse', borderRadius: '4px 4px 0 0', overflow: 'hidden',
                                                                     background: p.segments ? 'transparent' : p.current ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 45%, var(--surface-3))' }}>
              {p.segments?.map((s, j) => <div key={j} style={{ height: `${(s.value / (p.value || 1)) * 100}%`, background: s.color || SLOT_COLORS[j] }} />)}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {pts.map((p, i) => (
          <span key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: p.current ? 'var(--ink)' : 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {pts.length > 10 && i % 2 ? '' : p.label}
          </span>
        ))}
      </div>
      {card.legend && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 8 }}>
          {card.legend.map(l => (
            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--mid)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />{l.label}
            </span>
          ))}
        </div>
      )}
    </Frame>
  )
}

function NoteCard({ card }) {
  const show = { kind: 'note', id: card.id }
  return (
    <Frame title="Note" action={<OpenButton show={show} />}>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--ink)', marginBottom: card.snippet ? 6 : 0 }}>{card.title}</div>
      {card.snippet && (
        <div className="md-prose" style={{ fontSize: 13, lineHeight: 1.55, maxHeight: 180, overflow: 'hidden', maskImage: 'linear-gradient(#000 75%, transparent)', WebkitMaskImage: 'linear-gradient(#000 75%, transparent)' }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(card.snippet) }} />
      )}
      {card.added && (
        <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--accent-soft)', fontSize: 12.5, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>
          <span style={{ ...eyebrow, fontSize: 10, display: 'block', marginBottom: 2 }}>Added</span>{card.added}
        </div>
      )}
    </Frame>
  )
}

const CARDS = {
  breakdown: BreakdownCard, compare: CompareCard, transactions: TransactionsCard, budgets: BudgetsCard,
  day: DayCard, week: WeekCard, change: ChangeCard, choices: ChoicesCard,
  todos: TodosCard, habits: HabitsCard, trend: TrendCard, note: NoteCard,
}

/** The cards a turn's tools produced, in the order they ran. */
export function ToolCards({ tools = [], onChoose }) {
  const withCards = tools.filter(t => typeof t === 'object' && t.card && CARDS[t.card.type])
  if (!withCards.length) return null
  return withCards.map(t => {
    const Card = CARDS[t.card.type]
    return <div key={t.toolUseId} data-card-type={t.card.type}><Card card={t.card} show={t.show} onChoose={onChoose} /></div>
  })
}

/**
 * Undo for one change Atlas made. Undoing an older change after newer ones
 * puts the old state back over them, so it says so first.
 */
export function ActionUndoChip({ id, isLatest = true }) {
  const { token } = useAuth()
  const { refresh } = useRefresh()
  const [state, setState] = useState('idle')   // idle | working | undone | failed
  const [msg, setMsg] = useState('')
  const undo = async () => {
    if (!isLatest && !window.confirm('Atlas has made changes since this one. Undo it anyway? Later changes to the same thing will be reverted too.')) return
    setState('working')
    try {
      const res = await fetch(`${API}/assistant/actions/${id}/undo`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        let detail = ''
        try { detail = (await res.json()).detail } catch { /* not JSON */ }
        throw new Error(detail || `Undo failed (${res.status})`)
      }
      setState('undone')
      refresh()
    } catch (e) {
      setMsg(e.message)
      setState(/already been undone/.test(e.message) ? 'undone' : 'failed')
    }
  }
  if (state === 'undone') return <span style={{ color: 'var(--faint)', marginLeft: 4 }}>· undone</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
      <button onClick={e => { e.stopPropagation(); undo() }} disabled={state === 'working'}
        style={{ fontSize: 11.5, padding: '1px 8px', borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--surface)', color: 'var(--mid)', fontFamily: 'inherit', cursor: 'pointer' }}>
        {state === 'working' ? '…' : 'Undo'}
      </button>
      {state === 'failed' && <span style={{ color: 'var(--accent)' }} title={msg}>couldn't undo</span>}
    </span>
  )
}
