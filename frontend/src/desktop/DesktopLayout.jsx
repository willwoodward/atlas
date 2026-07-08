import { useState } from 'react'
import { dateLabel } from '../data.js'
import { useIntegrations } from '../context/IntegrationsContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { useUser } from '../context/UserContext.jsx'
import HomePage      from './HomePage.jsx'
import CalendarPage  from './CalendarPage.jsx'
import HabitsPage    from './HabitsPage.jsx'
import TodoPage      from './TodoPage.jsx'
import NotesPage     from './NotesPage.jsx'
import FinancesPage  from './FinancesPage.jsx'
import GoalsPage     from './GoalsPage.jsx'
import AssistantPage from './AssistantPage.jsx'
import AccountsPage  from './AccountsPage.jsx'

const I = (...kids) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{kids}</svg>
)
const navIcons = {
  home:      I(<path d="M4 11l8-7 8 7" key="a"/>, <path d="M6 10v9h4v-6h4v6h4v-9" key="b"/>),
  calendar:  I(<rect x="4" y="5" width="16" height="16" rx="2" key="a"/>, <line x1="4" y1="9" x2="20" y2="9" key="b"/>, <line x1="9" y1="3" x2="9" y2="6" key="c"/>, <line x1="15" y1="3" x2="15" y2="6" key="d"/>),
  habits:    I(<path d="M12 3c1.5 3-1 4.5-1 7a3 3 0 006 0c0-1-.4-2-1-2.6.2 2-1 2.6-1 2.6C13 8 12 5 12 3z" key="a"/>, <path d="M9 15a3 3 0 006 0" key="b"/>),
  todos:     I(<rect x="4" y="4" width="16" height="16" rx="3" key="a"/>, <path d="M8 12l3 3 5-6" key="b"/>),
  notes:     I(<rect x="5" y="4" width="14" height="16" rx="2" key="a"/>, <line x1="9" y1="9" x2="15" y2="9" key="b"/>, <line x1="9" y1="13" x2="13" y2="13" key="c"/>),
  finances:  I(<path d="M4 15l5-5 4 3 7-8" key="a"/>, <line x1="4" y1="20" x2="20" y2="20" key="b"/>),
  goals:     I(<circle cx="12" cy="12" r="8" key="a"/>, <circle cx="12" cy="12" r="3.5" key="b"/>),
  assistant: I(<circle cx="12" cy="12" r="7" key="a"/>, <circle cx="12" cy="12" r="2.5" key="b"/>),
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
]
const NAV_BOTTOM = [
  { id: 'assistant', label: 'Assistant' },
]

function NavBtn({ id, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '9px 12px',
        border: 'none', borderRadius: 9, cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit', fontSize: 13.5, fontWeight: active ? 600 : 500,
        letterSpacing: '.01em', transition: 'background .12s',
        background: active ? 'var(--surface-3)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--mid)',
      }}
    >
      <span style={{ display: 'flex', width: 19, height: 19, flex: 'none' }}>{navIcons[id]}</span>
      <span>{label}</span>
    </button>
  )
}

// ─── Dark mode toggle ─────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={onChange}
      style={{ width: 38, height: 22, borderRadius: 99, background: checked ? '#c15f3c' : 'var(--surface-3)', position: 'relative', cursor: 'pointer', transition: 'background .2s', flex: 'none' }}
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
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10 }}>Connections</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ fontSize: 15 }}>📅</span>
            <span style={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>Google Calendar</span>
            {gcal.connected
              ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6f8168' }} />
                  <button onClick={disconnectGoogle} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Disconnect</button>
                </div>
              )
              : <button onClick={connectGoogle} style={{ fontSize: 11.5, fontWeight: 600, color: '#c15f3c', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Connect</button>
            }
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--bd)' }} />

        {/* Settings */}
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10 }}>Appearance</div>

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
            Manage all accounts →
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

  const pages = {
    home:      <HomePage />,
    calendar:  <CalendarPage />,
    habits:    <HabitsPage />,
    todos:     <TodoPage />,
    notes:     <NotesPage />,
    finances:  <FinancesPage />,
    goals:     <GoalsPage />,
    assistant: <AssistantPage />,
    accounts:  <AccountsPage />,
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* Sidebar */}
      <aside style={{ width: 236, flex: 'none', height: '100%', display: 'flex', flexDirection: 'column', padding: '22px 16px 16px', background: 'var(--surface-2)', borderRight: '1px solid var(--bd)' }}>

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 8px 22px' }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: '#c15f3c', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(193,95,60,.35)' }}>
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--surface-2)' }} />
          </div>
          <div style={{ fontFamily: "'Newsreader', serif", fontSize: 19, fontWeight: 600, letterSpacing: '.01em', color: 'var(--ink)' }}>Atlas</div>
        </div>

        {/* Main nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, overflow: 'auto' }}>
          {NAV_MAIN.map(({ id, label }) => (
            <NavBtn key={id} id={id} label={label} active={active === id} onClick={() => setActive(id)} />
          ))}
          <div style={{ height: 1, background: 'var(--bd)', margin: '8px 4px' }} />
          {NAV_APPS.map(({ id, label }) => (
            <NavBtn key={id} id={id} label={label} active={active === id} onClick={() => setActive(id)} />
          ))}
          <div style={{ flex: 1 }} />
          {NAV_BOTTOM.map(({ id, label }) => (
            <NavBtn key={id} id={id} label={label} active={active === id} onClick={() => setActive(id)} />
          ))}
        </nav>

        {/* Divider + user button */}
        <div style={{ borderTop: '1px solid var(--bd)', marginTop: 10, paddingTop: 10 }}>
          <button
            onClick={() => setShowAccountModal(v => !v)}
            onMouseEnter={() => setUserHover(true)}
            onMouseLeave={() => setUserHover(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 11, background: showAccountModal || userHover ? 'var(--surface-3)' : 'transparent', border: 'none', cursor: 'pointer', padding: '7px 8px', borderRadius: 10, width: '100%', textAlign: 'left', fontFamily: 'inherit', transition: 'background .12s' }}
          >
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#c88a5f,#9a6d84)', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14 }}>
              {initial}
            </div>
            <div style={{ lineHeight: 1.25, minWidth: 0, flex: 1 }}>
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
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>{dateLabel}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px', borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--bd)', minWidth: 240, color: 'var(--muted)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
            <span style={{ fontSize: 13 }}>Search everything…</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 6px', borderRadius: 5, background: 'var(--surface-3)', color: 'var(--muted)', fontWeight: 600 }}>⌘K</span>
          </div>
          <button style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 15px', borderRadius: 11, border: 'none', background: '#c15f3c', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, lineHeight: 1, cursor: 'pointer', boxShadow: '0 2px 8px rgba(193,95,60,.32)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Quick add
          </button>
        </header>
        <div style={{ padding: active === 'assistant' ? '0px 34px 0' : '30px 34px 0px', flex: 1, minHeight: 0, overflowY: active === 'calendar' ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
          {pages[active]}
        </div>
      </main>
    </div>
  )
}
