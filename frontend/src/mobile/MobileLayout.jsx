import { useState } from 'react'
import { useUser } from '../context/UserContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import HomePage      from '../desktop/HomePage.jsx'
import CalendarPage  from '../desktop/CalendarPage.jsx'
import HabitsPage    from '../desktop/HabitsPage.jsx'
import TodoPage      from '../desktop/TodoPage.jsx'
import GoalsPage     from '../desktop/GoalsPage.jsx'
import NotesPage     from '../desktop/NotesPage.jsx'
import FinancesPage  from '../desktop/FinancesPage.jsx'
import AssistantPage from '../desktop/AssistantPage.jsx'
import AccountsPage  from '../desktop/AccountsPage.jsx'

const PAGES = [
  { id: 'home',      label: 'Home',      component: HomePage },
  { id: 'calendar',  label: 'Calendar',  component: CalendarPage },
  { id: 'habits',    label: 'Habits',    component: HabitsPage },
  { id: 'todos',     label: 'To-do',     component: TodoPage },
  { id: 'goals',     label: 'Goals',     component: GoalsPage },
  { id: 'notes',     label: 'Notes',     component: NotesPage },
  { id: 'finances',  label: 'Finances',  component: FinancesPage },
  { id: 'assistant', label: 'Assistant', component: AssistantPage },
  { id: 'accounts',  label: 'Accounts',  component: AccountsPage },
]

// Pages shown in the drawer nav (excludes accounts — accessed via avatar)
const NAV_PAGES = ['home', 'calendar', 'habits', 'todos', 'goals', 'notes', 'finances', 'assistant']

const I = (...kids) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{kids}</svg>
)
const icons = {
  home:      I(<path d="M4 11l8-7 8 7" key="a"/>, <path d="M6 10v9h4v-6h4v6h4v-9" key="b"/>),
  calendar:  I(<rect x="4" y="5" width="16" height="16" rx="2" key="a"/>, <line x1="4" y1="9" x2="20" y2="9" key="b"/>, <line x1="9" y1="3" x2="9" y2="6" key="c"/>, <line x1="15" y1="3" x2="15" y2="6" key="d"/>),
  habits:    I(<path d="M12 3c1.5 3-1 4.5-1 7a3 3 0 006 0c0-1-.4-2-1-2.6.2 2-1 2.6-1 2.6C13 8 12 5 12 3z" key="a"/>, <path d="M9 15a3 3 0 006 0" key="b"/>),
  todos:     I(<rect x="4" y="4" width="16" height="16" rx="3" key="a"/>, <path d="M8 12l3 3 5-6" key="b"/>),
  goals:     I(<circle cx="12" cy="12" r="8" key="a"/>, <circle cx="12" cy="12" r="3.5" key="b"/>),
  notes:     I(<rect x="5" y="4" width="14" height="16" rx="2" key="a"/>, <line x1="9" y1="9" x2="15" y2="9" key="b"/>, <line x1="9" y1="13" x2="13" y2="13" key="c"/>),
  finances:  I(<path d="M4 15l5-5 4 3 7-8" key="a"/>, <line x1="4" y1="20" x2="20" y2="20" key="b"/>),
  assistant: I(<circle cx="12" cy="12" r="7" key="a"/>, <circle cx="12" cy="12" r="2.5" key="b"/>),
  accounts:  I(<circle cx="12" cy="8" r="4" key="a"/>, <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" key="b"/>),
}

function Toggle({ checked, onChange }) {
  return (
    <div onClick={onChange} style={{ width: 36, height: 21, borderRadius: 99, background: checked ? '#c15f3c' : 'var(--surface-3)', position: 'relative', cursor: 'pointer', transition: 'background .2s', flex: 'none' }}>
      <div style={{ position: 'absolute', top: 2.5, left: checked ? 17 : 2.5, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .18s', boxShadow: '0 1px 4px rgba(0,0,0,.25)' }} />
    </div>
  )
}

export default function MobileLayout() {
  const [active, setActive] = useState('home')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { profile, initial } = useUser()
  const { isDark, toggleTheme } = useTheme()

  const navigate = (id) => { setActive(id); setDrawerOpen(false) }

  const ActivePage = PAGES.find(p => p.id === active)?.component ?? HomePage
  const activeLabel = PAGES.find(p => p.id === active)?.label ?? ''

  // Pages that manage their own layout (no outer padding, manage own scroll)
  const noPad = active === 'assistant' || active === 'notes' || active === 'calendar'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{
        flex: 'none', display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px 10px',
        background: 'var(--surface-2)', borderBottom: '1px solid var(--bd)',
        paddingTop: 'max(12px, env(safe-area-inset-top))',
      }}>
        {/* Hamburger */}
        <button
          onClick={() => setDrawerOpen(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--ink)', display: 'flex', flex: 'none' }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 8, background: '#c15f3c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--surface-2)' }} />
          </div>
          <span style={{ fontFamily: "'Newsreader', serif", fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>Atlas</span>
        </div>

        {/* Current page label */}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--mid)', textAlign: 'center' }}>{activeLabel}</span>

        {/* Avatar → accounts */}
        <div
          style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#c88a5f,#9a6d84)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, flex: 'none', cursor: 'pointer' }}
          onClick={() => navigate('accounts')}
        >
          {initial}
        </div>
      </div>

      {/* Page content — calendar manages its own inner scroll */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{
          padding: noPad ? '0' : '20px 20px 0',
          paddingBottom: noPad ? 0 : 'max(20px, env(safe-area-inset-bottom))',
          flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
          overflowY: noPad ? 'hidden' : 'auto',
        }}>
          <ActivePage />
        </div>
      </div>

      {/* Drawer overlay */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 100, backdropFilter: 'blur(2px)' }}
        />
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: 272,
        background: 'var(--surface-2)', borderRight: '1px solid var(--bd)',
        display: 'flex', flexDirection: 'column',
        zIndex: 101,
        transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform .28s cubic-bezier(.4,0,.2,1)',
        paddingTop: 'max(20px, env(safe-area-inset-top))',
      }}>
        {/* Drawer header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 20px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 28, height: 28, borderRadius: 9, background: '#c15f3c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--surface-2)' }} />
            </div>
            <span style={{ fontFamily: "'Newsreader', serif", fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>Atlas</span>
          </div>
          <button onClick={() => setDrawerOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, display: 'flex' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Nav — all main pages */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
          {NAV_PAGES.map(id => {
            const p = PAGES.find(p => p.id === id)
            return <NavItem key={id} id={id} label={p.label} active={active === id} onClick={() => navigate(id)} />
          })}
        </nav>

        {/* Drawer footer — theme + user */}
        <div style={{ borderTop: '1px solid var(--bd)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>

          {/* Dark mode */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--mid)' }}>Dark mode</span>
            <Toggle checked={isDark} onChange={toggleTheme} />
          </div>

          {/* User → accounts */}
          <button
            onClick={() => navigate('accounts')}
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-3)', border: 'none', cursor: 'pointer', padding: '8px 10px', borderRadius: 10, width: '100%', textAlign: 'left', fontFamily: 'inherit' }}
          >
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#c88a5f,#9a6d84)', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13 }}>
              {initial}
            </div>
            <div style={{ lineHeight: 1.3, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name || 'Your name'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.email || 'Add email'}</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}

function NavItem({ id, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px',
        border: 'none', borderRadius: 9, cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', fontSize: 14, fontWeight: active ? 600 : 500,
        background: active ? 'var(--surface-3)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--mid)',
        transition: 'background .12s',
      }}
    >
      <span style={{ display: 'flex', flex: 'none' }}>{icons[id]}</span>
      <span>{label}</span>
    </button>
  )
}
