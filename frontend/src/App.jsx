import { useState, useEffect, useRef } from 'react'
import { ThemeProvider }         from './context/ThemeContext.jsx'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { UserProvider }          from './context/UserContext.jsx'
import { HabitsProvider }        from './context/HabitsContext.jsx'
import { IntegrationsProvider }  from './context/IntegrationsContext.jsx'
import { FinancesProvider }      from './context/FinancesContext.jsx'
import { LocalCalendarProvider } from './context/LocalCalendarContext.jsx'
import { NotesProvider }         from './context/NotesContext.jsx'
import { GitHubProvider }        from './context/GitHubContext.jsx'
import { GoalsProvider }         from './context/GoalsContext.jsx'
import { TodosProvider }         from './context/TodosContext.jsx'
import { useIntegrations }       from './context/IntegrationsContext.jsx'
import { useLocalCalendar }      from './context/LocalCalendarContext.jsx'
import DesktopLayout from './desktop/DesktopLayout.jsx'
import TabletLayout  from './tablet/TabletLayout.jsx'
import MobileLayout  from './mobile/MobileLayout.jsx'
import LoginPage     from './desktop/LoginPage.jsx'

const BP_MOBILE  = 768
const BP_DESKTOP = 1280

function useLayout() {
  const [layout, setLayout] = useState(() => {
    if (window.innerWidth < BP_MOBILE) return 'mobile'
    if (window.innerWidth < BP_DESKTOP) return 'tablet'
    return 'desktop'
  })
  useEffect(() => {
    const mqMobile  = window.matchMedia(`(max-width: ${BP_MOBILE - 1}px)`)
    const mqDesktop = window.matchMedia(`(min-width: ${BP_DESKTOP}px)`)
    const update = () => {
      if (mqMobile.matches) setLayout('mobile')
      else if (mqDesktop.matches) setLayout('desktop')
      else setLayout('tablet')
    }
    mqMobile.addEventListener('change', update)
    mqDesktop.addEventListener('change', update)
    return () => { mqMobile.removeEventListener('change', update); mqDesktop.removeEventListener('change', update) }
  }, [])
  return layout
}

function SyncManager() {
  const { gcal, createGcalEvent } = useIntegrations()
  const { events: localEvents, removeEvent } = useLocalCalendar()
  const prevConnected = useRef(gcal.connected)

  useEffect(() => {
    const justConnected = !prevConnected.current && gcal.connected
    prevConnected.current = gcal.connected
    if (!justConnected || localEvents.length === 0) return
    localEvents.forEach(async (e) => {
      try { await createGcalEvent(e); removeEvent(e.id) } catch { /* keep locally */ }
    })
  }, [gcal.connected]) // eslint-disable-line
  return null
}

function Dashboard() {
  const layout = useLayout()
  return (
    <UserProvider>
      <HabitsProvider>
        <IntegrationsProvider>
          <FinancesProvider>
            <LocalCalendarProvider>
              <GoalsProvider>
                <TodosProvider>
                  <GitHubProvider>
                    <NotesProvider>
                      <SyncManager />
                      {layout === 'desktop' ? <DesktopLayout /> : layout === 'tablet' ? <TabletLayout /> : <MobileLayout />}
                    </NotesProvider>
                  </GitHubProvider>
                </TodosProvider>
              </GoalsProvider>
            </LocalCalendarProvider>
          </FinancesProvider>
        </IntegrationsProvider>
      </HabitsProvider>
    </UserProvider>
  )
}

function AppInner() {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <Dashboard /> : <LoginPage />
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </ThemeProvider>
  )
}
