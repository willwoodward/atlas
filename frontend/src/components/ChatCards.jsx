import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useRefresh } from '../context/RefreshContext.jsx'
import { SLOT_COLORS, OTHER_COLOR, NONE_COLOR, UNCATEGORISED } from '../lib/categories.js'
import { openShow } from '../lib/focus.js'
import { eyebrow, figure, Button } from './ui.jsx'

// What Atlas's tools draw in the chat. A tool result can carry a `card`
// (see backend/agent_tools.py) and a `show` — what the card's Open button
// opens. Kept small: the chat column is narrow, especially in the side panel.

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const money = (n, currency = 'EUR', digits = 0) => {
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n || 0)
  } catch {
    return `${currency} ${Math.round(n || 0)}`
  }
}

const hm = h => {
  if (h == null) return ''
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return `${hh}:${String(mm).padStart(2, '0')}`
}

// Event colour names from the tools → the app's palette.
const EVENT_COLORS = { coral: 'var(--accent)', sage: 'var(--sage)', blue: 'var(--blue)', gold: 'var(--gold)', mauve: 'var(--mauve)', grey: 'var(--stone)' }
const eventColor = c => (c && c.startsWith('#') ? c : EVENT_COLORS[c] || 'var(--blue)')

function Frame({ title, action, children }) {
  return (
    <div style={{ margin: '8px 0 12px', padding: '14px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--bd)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ ...eyebrow, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

const OpenButton = ({ show, label = 'Open' }) => show
  ? <Button variant="ghost" size="sm" onClick={() => openShow(show)} style={{ flex: 'none', padding: '3px 9px', fontSize: 11.5 }}>{label} →</Button>
  : null

function BreakdownCard({ card, show }) {
  const max = Math.max(1, ...card.rows.map(r => r.amount))
  const color = (r, i) => r.label === UNCATEGORISED ? NONE_COLOR : r.other ? OTHER_COLOR : SLOT_COLORS[i] || OTHER_COLOR
  return (
    <Frame title={card.title} action={<OpenButton show={show} />}>
      <div style={{ ...figure, fontSize: 24, marginBottom: 10 }}>{money(card.total, card.currency)}</div>
      {card.rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing in this period.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {card.rows.map((r, i) => (
          <div key={r.label + i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, marginBottom: 3 }}>
              <span style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.label}{r.other ? ` (${r.other} more)` : ''}
              </span>
              <span style={{ color: 'var(--mid)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
                {money(r.amount, card.currency)}
                <span style={{ color: 'var(--faint)' }}> · {Math.round((r.amount / (card.total || 1)) * 100)}%</span>
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-3)' }}>
              <div style={{ width: `${(r.amount / max) * 100}%`, height: '100%', borderRadius: 99, background: color(r, i) }} />
            </div>
          </div>
        ))}
      </div>
    </Frame>
  )
}

function CompareCard({ card }) {
  const diff = card.a.total - card.b.total
  return (
    <Frame title={card.title}>
      <div style={{ display: 'flex', gap: 18, marginBottom: 12, flexWrap: 'wrap' }}>
        {[card.a, card.b].map(p => (
          <div key={p.label}>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{p.label}</div>
            <div style={{ ...figure, fontSize: 21 }}>{money(p.total, card.currency)}</div>
          </div>
        ))}
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Change</div>
          <div style={{ ...figure, fontSize: 21 }}>{diff >= 0 ? '+' : '−'}{money(Math.abs(diff), card.currency)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {card.rows.map(r => (
          <div key={r.label} style={{ display: 'flex', gap: 10, fontSize: 12.5 }}>
            <span style={{ flex: 1, minWidth: 0, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
            <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{money(r.a, card.currency)} vs {money(r.b, card.currency)}</span>
            <span style={{ width: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink)', fontWeight: 600 }}>
              {r.change >= 0 ? '+' : '−'}{money(Math.abs(r.change), card.currency)}
            </span>
          </div>
        ))}
      </div>
    </Frame>
  )
}

function TransactionsCard({ card }) {
  return (
    <Frame title={card.title} action={<OpenButton show={{ kind: 'page', page: 'finances' }} label="Finances" />}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
        {card.matches} match{card.matches === 1 ? '' : 'es'}{card.rows.length < card.matches ? ` · showing ${card.rows.length}` : ''} · net {card.total < 0 ? '−' : ''}{money(Math.abs(card.total), card.currency, 2)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {card.rows.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--bd-xs)', fontSize: 12.5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: t.type === 'income' ? 'var(--sage)' : 'var(--accent)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.merchant}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.date} · {t.category}</div>
            </div>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}>
              {t.type === 'income' ? '+' : '−'}{money(t.eur, card.currency, 2)}
            </span>
          </div>
        ))}
      </div>
    </Frame>
  )
}

function DayCard({ card, show }) {
  return (
    <Frame title={card.title} action={<OpenButton show={show} label="Calendar" />}>
      {card.events.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing on.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {card.events.map(e => {
          const lit = card.highlight && e.id === card.highlight
          return (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px', borderRadius: 8, fontSize: 13,
                                     background: lit ? 'var(--accent-soft)' : 'transparent', outline: lit ? '1px solid var(--accent-line)' : 'none' }}>
              <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: eventColor(e.color), flex: 'none' }} />
              <span style={{ width: 86, flex: 'none', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                {e.all_day ? 'All day' : `${hm(e.start_h)}–${hm(e.end_h)}`}
              </span>
              <span style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
            </div>
          )
        })}
      </div>
    </Frame>
  )
}

const CARDS = { breakdown: BreakdownCard, compare: CompareCard, transactions: TransactionsCard, day: DayCard }

/** The cards a turn's tools produced, in the order they ran. */
export function ToolCards({ tools = [] }) {
  const withCards = tools.filter(t => typeof t === 'object' && t.card && CARDS[t.card.type])
  if (!withCards.length) return null
  return withCards.map(t => {
    const Card = CARDS[t.card.type]
    return <Card key={t.toolUseId} card={t.card} show={t.show} />
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
