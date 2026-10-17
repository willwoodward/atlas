import { eyebrow } from './ui.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNotes } from '../context/NotesContext.jsx'
import { useGitHub } from '../context/GitHubContext.jsx'
import { useTodos } from '../context/TodosContext.jsx'
import { useGoals } from '../context/GoalsContext.jsx'
import { useHabits } from '../context/HabitsContext.jsx'
import { useFinances } from '../context/FinancesContext.jsx'
import { useAssistant } from '../context/AssistantContext.jsx'
import { useCalendarEvents } from '../hooks/useCalendarEvents.js'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { buildIndex, searchItems, snippet, PAGE_ENTRIES } from '../lib/search.js'
import { requestFocus } from '../lib/focus.js'

// Search everything (Ctrl+/ or the header box). Results come from what the app
// already has loaded; Enter opens one, and the last row asks Atlas instead.

const ICONS = {
  page: <path d="M4 5h16M4 12h16M4 19h10" />,
  note: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /></>,
  todo: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>,
  event: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  goal: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  habit: <path d="M12 3c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-3.5 2-6 5-10z" />,
  transaction: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>,
  ask: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /></>,
}

function Icon({ kind }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[kind]}</svg>
  )
}

function Highlight({ text, tokens }) {
  if (!tokens.length || !text) return text || null
  const re = new RegExp(`(${tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
  return text.split(re).map((part, i) =>
    i % 2 ? <mark key={i} style={{ background: 'rgba(193,95,60,.16)', color: 'inherit', borderRadius: 3, padding: '0 1px' }}>{part}</mark> : part)
}

export default function SearchPalette({ onClose, navigate, initialQuery = '' }) {
  const isMobile = useIsMobile()
  const [query, setQuery] = useState(initialQuery)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const { notes } = useNotes()
  const { github } = useGitHub()
  const { todos } = useTodos()
  const { goals } = useGoals()
  const { habits } = useHabits()
  const { transactions, fmt, txnValue } = useFinances()
  const events = useCalendarEvents()
  const { send } = useAssistant()

  const index = useMemo(() => buildIndex({
    notes, githubTree: github?.tree || [], todos, goals, habits, events, transactions,
    fmtMoney: t => (t.type === 'income' ? '+' : '−') + fmt(Math.abs(txnValue(t))),
  }), [notes, github?.tree, todos, goals, habits, events, transactions, fmt, txnValue])

  const q = query.trim()
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  const groups = useMemo(() => searchItems(index, q), [index, q])

  // One flat list for the keyboard: results, then "Ask Atlas".
  const rows = useMemo(() => {
    if (!q) return PAGE_ENTRIES.map(p => ({ kind: 'page', key: `page:${p.id}`, title: p.title, page: p.id }))
    return [...groups.flatMap(g => g.items), { kind: 'ask', key: 'ask', title: q }]
  }, [groups, q])

  useEffect(() => { setActive(0) }, [q])
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const open = (row) => {
    onClose()
    if (row.kind === 'ask') {
      send(row.title)
      window.dispatchEvent(new CustomEvent('atlas:show-assistant'))
      return
    }
    navigate(row.page)
    if (row.target) requestFocus(row.target)
  }

  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[active]) open(rows[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  let n = -1
  const renderRow = (row) => {
    n += 1
    const i = n
    const isActive = i === active
    const body = row.kind === 'note' || row.kind === 'event' || row.kind === 'goal'
      ? (tokens.some(t => !row.titleN?.includes(t)) ? snippet(row.body, q) : '') : ''
    return (
      <div key={row.key} data-row={i} role="option" aria-selected={isActive}
        onMouseMove={() => active !== i && setActive(i)} onClick={() => open(row)}
        style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 12px', margin: '0 6px', borderRadius: 9, cursor: 'pointer',
                 background: isActive ? 'var(--surface-2)' : 'transparent' }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                       color: row.color || (row.kind === 'ask' ? 'var(--accent)' : 'var(--muted)'), background: 'var(--surface-3)' }}>
          {row.color && row.kind !== 'event' ? <span style={{ width: 9, height: 9, borderRadius: '50%', background: row.color }} /> : <Icon kind={row.kind} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        textDecoration: row.done ? 'line-through' : 'none', textDecorationColor: 'var(--faint)' }}>
            {row.kind === 'ask' ? <>Ask Atlas: <span style={{ color: 'var(--mid)' }}>“{row.title}”</span></> : <Highlight text={row.title} tokens={tokens} />}
          </div>
          {(body || row.subtitle) && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {body ? <Highlight text={body} tokens={tokens} /> : row.subtitle}
            </div>
          )}
        </div>
        {row.meta && <span style={{ fontSize: 13, color: 'var(--mid)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{row.meta}</span>}
        {isActive && !isMobile && <span style={{ fontSize: 11, color: 'var(--faint)', flex: 'none' }}>↵</span>}
      </div>
    )
  }

  const header = text => (
    <div style={{ padding: '10px 18px 4px', ...eyebrow, fontSize: 10.5 }}>{text}</div>
  )

  return (
    <div onMouseDown={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(20,18,15,.32)', display: 'flex', justifyContent: 'center',
               alignItems: 'flex-start', padding: isMobile ? 'max(10px, env(safe-area-inset-top)) 10px 10px' : '11vh 24px 24px',
               animation: 'search-in .14s ease-out' }}>
      <div role="dialog" aria-label="Search" style={{ width: '100%', maxWidth: 640, maxHeight: isMobile ? '85dvh' : '70vh', display: 'flex', flexDirection: 'column',
                     background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--bd)', boxShadow: '0 24px 60px rgba(0,0,0,.25)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--bd-sm)' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--muted)', flex: 'none' }}><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Search notes, to-dos, events, goals, transactions…" aria-label="Search"
            role="combobox" aria-expanded="true" aria-controls="search-results"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 16, color: 'var(--ink)', fontFamily: 'inherit' }} />
          <button onClick={onClose} style={{ fontSize: 11, padding: '3px 7px', borderRadius: 6, border: '1px solid var(--bd)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
            {isMobile ? 'Close' : 'Esc'}
          </button>
        </div>

        <div id="search-results" ref={listRef} role="listbox" style={{ overflowY: 'auto', padding: '4px 0 8px' }}>
          {!q && <>{header('Go to')}{rows.map(renderRow)}</>}
          {q && groups.map(g => (
            <div key={g.kind}>
              {header(g.total > g.items.length ? `${g.label} · ${g.items.length} of ${g.total}` : g.label)}
              {g.items.map(renderRow)}
            </div>
          ))}
          {q && groups.length === 0 && (
            <div style={{ padding: '14px 18px 6px', fontSize: 13, color: 'var(--muted)' }}>Nothing matches “{q}”.</div>
          )}
          {q && <>{header('Assistant')}{renderRow(rows[rows.length - 1])}</>}
        </div>

        {!isMobile && (
          <div style={{ display: 'flex', gap: 14, padding: '8px 18px', borderTop: '1px solid var(--bd-sm)', fontSize: 11.5, color: 'var(--faint)' }}>
            <span>↑↓ move</span><span>↵ open</span><span>Esc close</span>
            <span style={{ marginLeft: 'auto' }}>Calendar covers the weeks you've viewed</span>
          </div>
        )}
      </div>
      <style>{'@keyframes search-in{from{opacity:0}to{opacity:1}}'}</style>
    </div>
  )
}
