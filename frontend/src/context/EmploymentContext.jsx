import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useRefresh } from './RefreshContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function uid() { return crypto.randomUUID() }

const EMPTY = {
  employments: [], components: [], grants: [],
  prices: [], fx: [], projection: [], summary: {},
}

const Ctx = createContext(null)

/**
 * Compensation, kept apart from spending.
 *
 * Transactions record what landed in an account; this records what is
 * contracted to land and when. They are never summed together — a payday would
 * otherwise be counted twice, once as a projection and once as income.
 */
export function EmploymentProvider({ children }) {
  const { token } = useAuth()
  const { tick } = useRefresh()
  const [data, setData] = useState(EMPTY)

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }), [token])

  const refetch = useCallback(async () => {
    const res = await call('/api/employment')
    if (res.ok) setData(await res.json())
  }, [call])

  useEffect(() => { if (token) refetch() }, [token, tick, refetch])

  const mutate = useCallback(async (path, opts) => {
    await call(path, opts)
    await refetch()
  }, [call, refetch])

  const addEmployment = useCallback((fields) => mutate('/api/employment', {
    method: 'POST', body: JSON.stringify({ id: uid(), ...fields }),
  }), [mutate])

  const updateEmployment = useCallback((id, fields) => mutate(`/api/employment/${id}`, {
    method: 'PATCH', body: JSON.stringify(fields),
  }), [mutate])

  const removeEmployment = useCallback((id) => mutate(`/api/employment/${id}`, { method: 'DELETE' }), [mutate])

  const addComponent = useCallback((empId, fields) => mutate(`/api/employment/${empId}/components`, {
    method: 'POST', body: JSON.stringify({ id: uid(), ...fields }),
  }), [mutate])

  const removeComponent = useCallback((id) => mutate(`/api/employment/components/${id}`, { method: 'DELETE' }), [mutate])

  const addGrant = useCallback((empId, fields) => mutate(`/api/employment/${empId}/grants`, {
    method: 'POST', body: JSON.stringify({ id: uid(), ...fields }),
  }), [mutate])

  const removeGrant = useCallback((id) => mutate(`/api/employment/grants/${id}`, { method: 'DELETE' }), [mutate])

  const addVest = useCallback((grantId, fields) => mutate(`/api/employment/grants/${grantId}/vests`, {
    method: 'POST', body: JSON.stringify({ id: uid(), ...fields }),
  }), [mutate])

  const removeVest = useCallback((id) => mutate(`/api/employment/vests/${id}`, { method: 'DELETE' }), [mutate])

  const setPrice = useCallback((symbol, price, currency = 'USD') => mutate('/api/employment/prices', {
    method: 'PUT', body: JSON.stringify({ symbol, price: Number(price) || 0, currency }),
  }), [mutate])

  const setFx = useCallback((currency, rate) => mutate('/api/employment/fx', {
    method: 'PUT', body: JSON.stringify({ currency, rate_to_gbp: Number(rate) || 0 }),
  }), [mutate])

  const employment = data.employments[0] || null
  const fxMap = Object.fromEntries(data.fx.map(f => [f.currency, f.rate_to_gbp]))
  const priceMap = Object.fromEntries(data.prices.map(p => [p.symbol, p]))

  // Which valuation inputs are missing. Surfaced rather than defaulted, because
  // a silently-assumed rate of 1 makes euros look like pounds.
  const missingRates = [...new Set([
    ...data.components.map(c => c.currency),
    ...data.grants.map(g => priceMap[g.symbol]?.currency || g.currency),
  ])].filter(c => c && c !== 'GBP' && !(c in fxMap))
  const missingPrices = [...new Set(data.grants.map(g => g.symbol))].filter(s => s && !(s in priceMap))

  return (
    <Ctx.Provider value={{
      ...data, employment, fxMap, priceMap, missingRates, missingPrices,
      addEmployment, updateEmployment, removeEmployment,
      addComponent, removeComponent,
      addGrant, removeGrant, addVest, removeVest,
      setPrice, setFx, refetch,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useEmployment = () => useContext(Ctx)
