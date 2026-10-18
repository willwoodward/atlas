import { Button, eyebrow, kbd } from '../components/ui.jsx'
import { useEffect, useRef, useState } from 'react'
import { dateLabel } from '../data.js'
import { useIntegrations } from '../context/IntegrationsContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { useUser } from '../context/UserContext.jsx'
import { useQuickAddAction } from '../context/QuickAddContext.jsx'
import { onShortcut, useKeybinds } from '../context/KeybindsContext.jsx'
import { displayCombo, PAGE_SHORTCUTS } from '../lib/keybinds.js'
import HomePage      from './HomePage.jsx'
import CalendarPage  from './CalendarPage.jsx'
import HabitsPage    from './HabitsPage.jsx'
import TodoPage      from './TodoPage.jsx'
import NotesPage     from './NotesPage.jsx'
import FinancesPage  from './FinancesPage.jsx'
import FitnessPage   from './FitnessPage.jsx'
import GoalsPage     from './GoalsPage.jsx'
import AssistantPage from './AssistantPage.jsx'
import InboxPage     from './InboxPage.jsx'
import AgentsPage    from './AgentsPage.jsx'
import { useInbox } from '../context/InboxContext.jsx'
import AccountsPage  from './AccountsPage.jsx'
import AssistantPanel from './AssistantPanel.jsx'
import SearchPalette from '../components/SearchPalette.jsx'
import VoiceDock from '../components/VoiceDock.jsx'
import { requestFocus, showTarget } from '../lib/focus.js'
import { getAssistantPrefs } from '../lib/assistantPrefs.js'

const PANEL_KEY = 'atlas:assistant-panel'
const SIDEBAR_KEY = 'atlas:sidebar-collapsed'
// The sidebar's two widths. Collapsed, it's a rail of icons.
const SIDEBAR_WIDE = 236
const SIDEBAR_RAIL = 68
// Matches the assistant panel's open/close.
const SLIDE = '.26s cubic-bezier(.2, .8, .2, 1)'

const I = (...kids) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{kids}</svg>
)
const navIcons = {
  home:      I(<path d="M4 11l8-7 8 7" key="a"/>, <path d="M6 10v9h4v-6h4v6h4v-9" key="b"/>),
  inbox:     I(<path d="M4 13l2.5-7.5A2 2 0 018.4 4h7.2a2 2 0 011.9 1.5L20 13" key="a"/>, <path d="M4 13v5a2 2 0 002 2h12a2 2 0 002-2v-5h-5l-1.5 2.5h-3L9 13H4z" key="b"/>),
  calendar:  I(<rect x="4" y="5" width="16" height="16" rx="2" key="a"/>, <line x1="4" y1="9" x2="20" y2="9" key="b"/>, <line x1="9" y1="3" x2="9" y2="6" key="c"/>, <line x1="15" y1="3" x2="15" y2="6" key="d"/>),
  habits:    I(<path d="M12 3c1.5 3-1 4.5-1 7a3 3 0 006 0c0-1-.4-2-1-2.6.2 2-1 2.6-1 2.6C13 8 12 5 12 3z" key="a"/>, <path d="M9 15a3 3 0 006 0" key="b"/>),
  todos:     I(<rect x="4" y="4" width="16" height="16" rx="3" key="a"/>, <path d="M8 12l3 3 5-6" key="b"/>),
  notes:     I(<rect x="5" y="4" width="14" height="16" rx="2" key="a"/>, <line x1="9" y1="9" x2="15" y2="9" key="b"/>, <line x1="9" y1="13" x2="13" y2="13" key="c"/>),
  finances:  I(<path d="M4 15l5-5 4 3 7-8" key="a"/>, <line x1="4" y1="20" x2="20" y2="20" key="b"/>),
  fitness:   I(<path d="M3 12h4l3-7 4 14 3-7h4" key="a"/>),
  goals:     I(<circle cx="12" cy="12" r="8" key="a"/>, <circle cx="12" cy="12" r="3.5" key="b"/>),
  assistant: I(<circle cx="12" cy="12" r="7" key="a"/>, <circle cx="12" cy="12" r="2.5" key="b"/>),
  agents:    I(<circle cx="12" cy="6.5" r="2.8" key="a"/>, <circle cx="5.5" cy="17" r="2.5" key="b"/>, <circle cx="18.5" cy="17" r="2.5" key="c"/>, <path d="M10.4 8.9L7 14.7M13.6 8.9l3.4 5.8M8 17h8" key="d"/>),
  accounts:  I(<circle cx="12" cy="8" r="4" key="a"/>, <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" key="b"/>),
}

const NAV_MAIN = [
  { id: 'home',     label: 'Home' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'habits',   label: 'Habits' },
  { id: 'todos',    label: 'To-do' },
  { id: 'goals',    label: 'Goals' },
]
const NAV_APPS = [
  { id: 'notes',    label: 'Notes' },
  { id: 'finances', label: 'Finances' },
  { id: 'fitness',  label: 'Fitness' },
]
const NAV_BOTTOM = [
  { id: 'inbox',     label: 'Inbox' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'agents',    label: 'Agents' },
]

// Collapsed, labels fade and clip rather than unmount, so the width
// animation has text to slide over and screen readers still get a name.
const labelStyle = collapsed => ({
  whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0,
  opacity: collapsed ? 0 : 1, transition: `opacity ${collapsed ? '.12s' : '.2s .08s'}`,
})

function NavBtn({ id, label, active, onClick, collapsed, badge }) {
  const { bindings } = useKeybinds()
  const key = bindings[`go:${id}`]
  const shortcut = key ? ` (${displayCombo(key)})` : ''
  return (
    <button
      onClick={onClick}
      className="nav-btn"
      aria-current={active ? 'page' : undefined}
      title={(collapsed ? label + (badge ? ` · ${badge} unread` : '') : label) + shortcut}
      aria-label={badge ? `${label}, ${badge} unread` : label}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '9px 12px',
        border: 'none', borderRadius: 9, cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', fontSize: 13.5, fontWeight: active ? 600 : 500,
        letterSpacing: '.01em', transition: 'background .12s, color .12s',
        // Hover: .nav-btn in index.css.
        ...(active ? { background: 'var(--surface-3)', color: 'var(--ink)' } : {}),
      }}
    >
      <span style={{ display: 'flex', width: 19, height: 19, flex: 'none', position: 'relative' }}>
        {navIcons[id]}
        {/* Collapsed, the count shrinks to a dot on the icon. */}
        {badge > 0 && collapsed && <span style={{ position: 'absolute', top: -2, right: -3, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', border: '1.5px solid var(--surface-2)' }} />}
      </span>
      <span style={{ ...labelStyle(collapsed), flex: 1 }}>{label}</span>
      {badge > 0 && !collapsed && <span style={{ flex: 'none', minWidth: 18, padding: '1px 6px', borderRadius: 99, background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, textAlign: 'center' }}>{badge}</span>}
    </button>
  )
}

// ─── Dark mode toggle ─────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={onChange}
      style={{ width: 38, height: 22, borderRadius: 99, background: checked ? 'var(--accent)' : 'var(--surface-3)', position: 'relative', cursor: 'pointer', transition: 'background .2s', flex: 'none' }}
    >
      <div style={{ position: 'absolute', top: 3, left: checked ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .18s', boxShadow: '0 1px 4px rgba(0,0,0,.25)' }} />
    </div>
  )
}

// ─── Account modal ────────────────────────────────────────────────────────
function AccountModal({ onClose, setActive }) {
  const { gcal, connectGoogle, disconnectGoogle } = useIntegrations()
  const { isDark, toggleTheme } = useTheme()
  const { profile, updateProfile, initial } = useUser()

  const inputSt = {
    width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 12.5,
    border: '1px solid var(--bd)', background: 'var(--surface-2)', color: 'var(--ink)',
    fontFamily: 'inherit', outline: 'none',
  }

  return (
    <>
      {/* overlay */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />

      {/* panel — anchored above user row in sidebar */}
      <div style={{
        position: 'fixed', bottom: 68, left: 8, width: 252, zIndex: 51,
        background: 'var(--surface)', border: '1px solid var(--bd)',
        borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,.2)',
        overflow: 'hidden',
      }}>

        {/* Profile — editable */}
        <div style={{ padding: '16px 16px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#c88a5f,#9a6d84)', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 15 }}>
              {initial}
            </div>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--muted)' }}>Your profile</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, fontSize: 16, lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <input
              style={inputSt}
              value={profile.name}
              onChange={e => updateProfile({ name: e.target.value })}
              placeholder="Your name"
            />
            <input
              style={inputSt}
              value={profile.email}
              onChange={e => updateProfile({ email: e.target.value })}
              placeholder="Email address"
              type="email"
            />
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--bd)' }} />

        {/* Connections */}
        <div style={{ padding: '12px 16px' }}>
          <div style={{ ...eyebrow, fontSize: 10, marginBottom: 10 }}>Connections</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ fontSize: 15 }}>📅</span>
            <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>Google Calendar</span>
            {gcal.connected
              ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--sage)' }} />
                  <button onClick={disconnectGoogle} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Disconnect</button>
                </div>
              )
              : <button onClick={connectGoogle} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Connect</button>
            }
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--bd)' }} />

        {/* Settings */}
        <div style={{ padding: '12px 16px' }}>
          <div style={{ ...eyebrow, fontSize: 10, marginBottom: 10 }}>Appearance</div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--ink)' }}>Dark mode</span>
            <Toggle checked={isDark} onChange={toggleTheme} />
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--bd)' }} />

        {/* Footer */}
        <div style={{ padding: '10px 16px' }}>
          <button
            onClick={() => { setActive('accounts'); onClose() }}
            style={{ fontSize: 12.5, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
          >
            Settings &amp; accounts →
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Layout ───────────────────────────────────────────────────────────────
export default function DesktopLayout() {
  const [active, setActive] = useState('home')
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [userHover, setUserHover] = useState(false)
  const { profile, initial } = useUser()
  const quickAdd = useQuickAddAction(active, setActive)
  // The assistant docked on the right. Remembered between visits; not shown
  // on the Assistant page itself, which is the same chat full width.
  const [panelOpen, setPanelOpen] = useState(() => { try { return localStorage.getItem(PANEL_KEY) === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(PANEL_KEY, panelOpen ? '1' : '0') } catch { /* not kept */ } }, [panelOpen])
  // Its shortcut (Ctrl+. by default) toggles it from anywhere, and the voice
  // shortcut opens it when no chat is on screen.
  useEffect(() => onShortcut('assistantPanel', () => setPanelOpen(o => !o)), [])
  // The sidebar folds down to an icon rail (Ctrl+B by default). Remembered.
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(SIDEBAR_KEY) === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0') } catch { /* not kept */ } }, [collapsed])
  useEffect(() => onShortcut('sidebar', () => setCollapsed(c => !c)), [])
  // Ctrl+1… jump to a page (changeable in Settings → Keyboard shortcuts).
  useEffect(() => {
    const offs = PAGE_SHORTCUTS.map(s => onShortcut(s.id, () => setActive(s.page)))
    return () => offs.forEach(off => off())
  }, []) // eslint-disable-line
  const sidebarWidth = collapsed ? SIDEBAR_RAIL : SIDEBAR_WIDE
  const { counts: inboxCounts } = useInbox()
  useEffect(() => {
    const show = () => setPanelOpen(true)
    window.addEventListener('atlas:show-assistant', show)
    return () => window.removeEventListener('atlas:show-assistant', show)
  }, [])
  const { bindings } = useKeybinds()
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  useEffect(() => onShortcut('search', () => { setSearchQuery(''); setSearchOpen(o => !o) }), [])

  // Atlas (or a card in the chat) wants to show something. Explicit requests
  // always open; changes Atlas makes open only with "follow along" on. From
  // the full Assistant page the chat moves to the side panel, so it stays in view.
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    const onShow = e => {
      const show = e.detail
      if (!show.explicit && !getAssistantPrefs().followAlong) return
      if (show.kind === 'search') { setSearchQuery(show.query || ''); setSearchOpen(true); return }
      const where = showTarget(show)
      if (!where) return
      if (activeRef.current === 'assistant' && where.page !== 'assistant') setPanelOpen(true)
      setActive(where.page)
      if (where.target) requestFocus(where.target)
    }
    window.addEventListener('atlas:show', onShow)
    return () => window.removeEventListener('atlas:show', onShow)
  }, [])
  const showPanel = panelOpen && active !== 'assistant'
  // Kept mounted through its exit animation.
  const [panelMounted, setPanelMounted] = useState(showPanel)
  useEffect(() => { if (showPanel) setPanelMounted(true) }, [showPanel])

  const pages = {
    home:      <HomePage />,
    inbox:     <InboxPage />,
    calendar:  <CalendarPage />,
    habits:    <HabitsPage />,
    todos:     <TodoPage />,
    notes:     <NotesPage />,
    finances:  <FinancesPage />,
    fitness:   <FitnessPage />,
    goals:     <GoalsPage />,
    assistant: <AssistantPage />,
    agents:    <AgentsPage />,
    accounts:  <AccountsPage />,
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* Sidebar */}
      <aside style={{ width: sidebarWidth, flex: 'none', height: '100%', display: 'flex', flexDirection: 'column', padding: collapsed ? '22px 12px 16px' : '22px 16px 16px', background: 'var(--surface-2)', borderRight: '1px solid var(--bd)', overflow: 'hidden', transition: `width ${SLIDE}, padding ${SLIDE}` }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 8px 22px' }}>
          <div style={{ width: 30, height: 30, flex: 'none', borderRadius: 9, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px var(--accent-line)' }}>
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--surface-2)' }} />
          </div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600, letterSpacing: '.01em', color: 'var(--ink)', ...labelStyle(collapsed) }}>Atlas</div>
        </div>

        {/* Main nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {NAV_MAIN.map(({ id, label }) => (
            <NavBtn key={id} id={id} label={label} active={active === id} onClick={() => setActive(id)} collapsed={collapsed} />
          ))}
          <div style={{ height: 1, background: 'var(--bd)', margin: '8px 4px' }} />
          {NAV_APPS.map(({ id, label }) => (
            <NavBtn key={id} id={id} label={label} active={active === id} onClick={() => setActive(id)} collapsed={collapsed} />
          ))}
          <div style={{ flex: 1 }} />
          {NAV_BOTTOM.map(({ id, label }) => (
            <NavBtn key={id} id={id} label={label} active={active === id} onClick={() => setActive(id)} collapsed={collapsed} badge={id === 'inbox' ? inboxCounts.unread : 0} />
          ))}
        </nav>

        {/* Divider + user button */}
        <div style={{ borderTop: '1px solid var(--bd)', marginTop: 10, paddingTop: 10 }}>
          <button
            onClick={() => setShowAccountModal(v => !v)}
            onMouseEnter={() => setUserHover(true)}
            onMouseLeave={() => setUserHover(false)}
            title={collapsed ? profile.name || 'Your profile' : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 11, background: showAccountModal || userHover ? 'var(--surface-3)' : 'transparent', border: 'none', cursor: 'pointer', padding: collapsed ? '7px 6px' : '7px 8px', transition: `padding ${SLIDE}, background .12s`, borderRadius: 10, width: '100%', textAlign: 'left', fontFamily: 'inherit', transition: 'background .12s' }}
          >
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#c88a5f,#9a6d84)', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14 }}>
              {initial}
            </div>
            <div style={{ lineHeight: 1.25, minWidth: 0, flex: 1, ...labelStyle(collapsed) }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{profile.name || 'Your name'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.email || 'Add your email'}</div>
            </div>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--faint)', flex: 'none', opacity: userHover || showAccountModal ? 1 : 0, transition: 'opacity .15s' }}>
              <polyline points="18 15 12 9 6 15"/>
            </svg>
          </button>
        </div>
      </aside>

      {/* Account modal */}
      {showAccountModal && (
        <AccountModal onClose={() => setShowAccountModal(false)} setActive={setActive} />
      )}

      {/* Main */}
      <main style={{ flex: 1, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <header style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 16, padding: '16px 34px', background: 'var(--bg-blur)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--bd-sm)' }}>
          <button onClick={() => setCollapsed(c => !c)} aria-pressed={collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={`${collapsed ? 'Expand' : 'Collapse'} sidebar${bindings.sidebar ? ` (${displayCombo(bindings.sidebar)})` : ''}`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, marginLeft: -10, borderRadius: 'var(--radius-sm)', border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', flex: 'none' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5" /><line x1="9.5" y1="4" x2="9.5" y2="20" />{!collapsed && <rect x="4" y="5" width="4.5" height="14" rx="1" fill="currentColor" stroke="none" opacity=".35" />}</svg>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ ...eyebrow, fontSize: 12 }}>{dateLabel}</div>
          </div>
          <button onClick={() => setSearchOpen(true)} aria-label="Search"
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--bd)', minWidth: 240, color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
            <span style={{ fontSize: 13 }}>Search everything…</span>
            {bindings.search && <span style={{ ...kbd, marginLeft: 'auto' }}>{displayCombo(bindings.search)}</span>}
          </button>
          {active !== 'assistant' && (
            <button onClick={() => setPanelOpen(o => !o)} aria-pressed={panelOpen}
              aria-label={panelOpen ? 'Close assistant panel' : 'Open assistant panel'} title={`${panelOpen ? 'Close' : 'Open'} assistant panel${bindings.assistantPanel ? ` (${displayCombo(bindings.assistantPanel)})` : ''}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 11, border: '1px solid var(--bd)', background: panelOpen ? 'var(--surface-3)' : 'var(--surface-2)', color: panelOpen ? 'var(--ink)' : 'var(--muted)', cursor: 'pointer', flex: 'none' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5" /><line x1="14.5" y1="4" x2="14.5" y2="20" />{panelOpen && <rect x="15.5" y="5" width="4.5" height="14" rx="1" fill="currentColor" stroke="none" opacity=".35" />}</svg>
            </button>
          )}
          {/* The page's primary action. Hidden where a page has none (Accounts). */}
          {quickAdd && (
            <Button variant="primary" raised onClick={quickAdd.run} style={{ gap: 8, padding: '9px 15px', borderRadius: 'var(--radius)', lineHeight: 1 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {quickAdd.label}
            </Button>
          )}
        </header>
        <div style={{ padding: active === 'assistant' ? '0px 34px 0' : '30px 34px 40px', flex: 1, minHeight: 0, overflowY: active === 'calendar' || active === 'inbox' ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
          {pages[active]}
        </div>
      </main>

      {searchOpen && <SearchPalette initialQuery={searchQuery} onClose={() => setSearchOpen(false)} navigate={setActive} />}
      <VoiceDock right={24} bottom={22} />
      {panelMounted && <AssistantPanel open={showPanel} onExited={() => setPanelMounted(false)}
        onClose={() => setPanelOpen(false)} onExpand={() => { setPanelOpen(false); setActive('assistant') }} />}
    </div>
  )
}
