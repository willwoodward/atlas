import { createContext, useContext, useState, useCallback } from 'react'

/**
 * A global "the database changed underneath us" signal.
 *
 * The assistant writes straight to SQLite through the MCP tools, so the data
 * contexts have no way of knowing their cached copy went stale. Each provider
 * includes `tick` in its load effect's dependencies; calling refresh() bumps it
 * and they all refetch.
 */
const Ctx = createContext({ tick: 0, refresh: () => {} })

export function RefreshProvider({ children }) {
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick(t => t + 1), [])
  return <Ctx.Provider value={{ tick, refresh }}>{children}</Ctx.Provider>
}

export const useRefresh = () => useContext(Ctx)
