import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAssistant } from './AssistantContext.jsx'

const Ctx = createContext(null)

/**
 * The header "+" button does whatever the current page's primary action is.
 *
 * The action belongs to the page — its modal, its inline form — so rather than
 * lifting that state into the layout, a page registers a handler while it is
 * mounted and the layout just calls it. React runs the outgoing page's cleanup
 * before the incoming page's effects, so there is never a moment where the
 * button would fire the previous page's action.
 */
export function QuickAddProvider({ children }) {
  const [action, setAction] = useState(null)
  const runRef = useRef(null)

  const register = useCallback((label, run) => {
    runRef.current = run
    setAction({ label })
    return () => {
      if (runRef.current === run) {
        runRef.current = null
        setAction(null)
      }
    }
  }, [])

  const trigger = useCallback(() => runRef.current?.(), [])

  return <Ctx.Provider value={{ action, register, trigger }}>{children}</Ctx.Provider>
}

/** Register this page's quick-add action for as long as it is mounted. */
export function useQuickAdd(label, handler) {
  const register = useContext(Ctx)?.register
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    if (!register) return undefined          // e.g. the tablet deck, which has no header button
    return register(label, () => handlerRef.current())
  }, [label, register])
}

/**
 * What the header button should do on the active page, or null to hide it.
 *
 * Home and Assistant are navigation, not page state, so the layout owns them:
 * both start a fresh chat, and Home also takes you there.
 */
export function useQuickAddAction(active, navigate) {
  const { action, trigger } = useContext(Ctx)
  const { clear } = useAssistant()

  if (active === 'home') return { label: 'New chat', run: () => { clear(); navigate('assistant') } }
  if (active === 'assistant') return { label: 'New chat', run: clear }
  if (action) return { label: action.label, run: trigger }
  return null
}
