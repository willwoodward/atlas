import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useRefresh } from './RefreshContext.jsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function uid() { return crypto.randomUUID() }
function today() { return new Date().toISOString().slice(0, 10) }

// Convert API pot row → internal shape (camelCase keys)
const potToInternal = (p) => ({
  id: p.id, name: p.name, color: p.color,
  targetAmount: p.target_amount, notes: p.notes,
  subGoals: (p.subGoals || []).map(sg => ({
    id: sg.id, name: sg.name, targetAmount: sg.target_amount, notes: sg.notes,
  })),
  deposits: (p.deposits || []).map(d => ({
    id: d.id, amount: d.amount, note: d.note, date: d.date,
  })),
})

const Ctx = createContext(null)

export function FinancesProvider({ children }) {
  const { token } = useAuth()
  // Bumped when the assistant mutates data via MCP, forcing a refetch.
  const { tick } = useRefresh()
  const [data, setData] = useState({ pots: [], transactions: [], accounts: [], rules: [] })
  const [insights, setInsights] = useState({ budgets: [], unbudgeted: [], recurring: [], surplus: {}, allocation: [] })

  const call = useCallback((path, opts = {}) => fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...opts,
  }), [token])

  // Insights are derived server-side from every transaction, so they are
  // refetched rather than recomputed whenever the ledger changes.
  const refreshInsights = useCallback(async () => {
    const res = await call('/api/finances/insights')
    if (res.ok) setInsights(await res.json())
  }, [call])

  useEffect(() => { if (token) refreshInsights() }, [token, tick, refreshInsights])

  useEffect(() => {
    call('/api/finances').then(r => r.json()).then(d => {
      setData({
        pots: d.pots.map(potToInternal),
        transactions: d.transactions,
        accounts: d.accounts,
        rules: d.rules || [],
      })
    })
  }, [token, tick])

  // ─── Pots ──────────────────────────────────────────────────────────────────
  const addPot = useCallback(async (name, color, targetAmount, notes = '') => {
    const id = uid()
    const pot = { id, name, color, targetAmount: Number(targetAmount)||0, notes, subGoals: [], deposits: [] }
    setData(d => ({ ...d, pots: [...d.pots, pot] }))
    await call('/api/finances/pots', { method: 'POST', body: JSON.stringify({ id, name, color, target_amount: pot.targetAmount, notes }) })
  }, [call])

  const removePot = useCallback(async (id) => {
    setData(d => ({ ...d, pots: d.pots.filter(p => p.id !== id) }))
    await call(`/api/finances/pots/${id}`, { method: 'DELETE' })
  }, [call])

  // ─── Sub-goals ─────────────────────────────────────────────────────────────
  const addSubGoal = useCallback(async (potId, name, targetAmount, notes = '') => {
    const id = uid()
    const sg = { id, name, targetAmount: Number(targetAmount)||0, notes }
    setData(d => ({ ...d, pots: d.pots.map(p => p.id === potId ? { ...p, subGoals: [...(p.subGoals||[]), sg] } : p) }))
    await call(`/api/finances/pots/${potId}/subgoals`, { method: 'POST', body: JSON.stringify({ id, name, target_amount: sg.targetAmount, notes }) })
  }, [call])

  const removeSubGoal = useCallback(async (potId, subId) => {
    setData(d => ({ ...d, pots: d.pots.map(p => p.id === potId ? { ...p, subGoals: (p.subGoals||[]).filter(s => s.id !== subId) } : p) }))
    await call(`/api/finances/pots/${potId}/subgoals/${subId}`, { method: 'DELETE' })
  }, [call])

  // ─── Deposits ──────────────────────────────────────────────────────────────
  const addDeposit = useCallback(async (potId, amount, note = '', date = today()) => {
    const id = uid()
    const dep = { id, amount: Number(amount), note, date }
    setData(d => ({ ...d, pots: d.pots.map(p => p.id === potId ? { ...p, deposits: [...(p.deposits||[]), dep] } : p) }))
    await call(`/api/finances/pots/${potId}/deposits`, { method: 'POST', body: JSON.stringify({ id, amount: dep.amount, note, date }) })
  }, [call])

  const removeDeposit = useCallback(async (potId, depositId) => {
    setData(d => ({ ...d, pots: d.pots.map(p => p.id === potId ? { ...p, deposits: (p.deposits||[]).filter(d => d.id !== depositId) } : p) }))
    await call(`/api/finances/pots/${potId}/deposits/${depositId}`, { method: 'DELETE' })
  }, [call])

  // ─── Transactions ──────────────────────────────────────────────────────────
  const addTransaction = useCallback(async (merchant, category, amount, date, type) => {
    const id = uid()
    const txn = { id, merchant, category, amount: Number(amount), date, type }
    setData(d => ({ ...d, transactions: [txn, ...d.transactions] }))
    await call('/api/finances/transactions', { method: 'POST', body: JSON.stringify(txn) })
  }, [call])

  const removeTransaction = useCallback(async (id) => {
    setData(d => ({ ...d, transactions: d.transactions.filter(t => t.id !== id) }))
    await call(`/api/finances/transactions/${id}`, { method: 'DELETE' })
  }, [call])

  // ─── Accounts ──────────────────────────────────────────────────────────────
  const addAccount = useCallback(async (name, institution, type, balance) => {
    const id = uid()
    const acc = { id, name, institution, type, balance: Number(balance)||0 }
    setData(d => ({ ...d, accounts: [...d.accounts, acc] }))
    await call('/api/finances/accounts', { method: 'POST', body: JSON.stringify(acc) })
  }, [call])

  const updateAccount = useCallback(async (id, fields) => {
    setData(d => ({ ...d, accounts: d.accounts.map(a => a.id === id ? { ...a, ...fields } : a) }))
    await call(`/api/finances/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(fields) })
  }, [call])

  const removeAccount = useCallback(async (id) => {
    setData(d => ({ ...d, accounts: d.accounts.filter(a => a.id !== id) }))
    await call(`/api/finances/accounts/${id}`, { method: 'DELETE' })
  }, [call])

  const refetch = useCallback(async () => {
    const d = await call('/api/finances').then(r => r.json())
    setData({
      pots: d.pots.map(potToInternal),
      transactions: d.transactions,
      accounts: d.accounts,
      rules: d.rules || [],
    })
    await refreshInsights()
  }, [call, refreshInsights])

  // ─── Budgets ───────────────────────────────────────────────────────────────
  const setBudget = useCallback(async (category, amount) => {
    await call('/api/finances/budgets', {
      method: 'POST',
      body: JSON.stringify({ id: uid(), category, amount: Number(amount) || 0, period: 'monthly' }),
    })
    await refreshInsights()
  }, [call, refreshInsights])

  const removeBudget = useCallback(async (id) => {
    await call(`/api/finances/budgets/${id}`, { method: 'DELETE' })
    await refreshInsights()
  }, [call, refreshInsights])

  // Deliberately explicit: /insights only ever suggests an allocation, and this
  // is the separate call that actually writes the deposits.
  const allocateSurplus = useCallback(async (allocations, note) => {
    await call('/api/finances/allocate', {
      method: 'POST', body: JSON.stringify({ allocations, note }),
    })
    await refetch()
  }, [call, refetch])

  // ─── Import rules ──────────────────────────────────────────────────────────
  const addRule = useCallback(async (pattern, category) => {
    const id = uid()
    setData(d => ({ ...d, rules: [...d.rules, { id, pattern, category }] }))
    await call('/api/finances/rules', { method: 'POST', body: JSON.stringify({ id, pattern, category }) })
  }, [call])

  const removeRule = useCallback(async (id) => {
    setData(d => ({ ...d, rules: d.rules.filter(r => r.id !== id) }))
    await call(`/api/finances/rules/${id}`, { method: 'DELETE' })
  }, [call])

  // ─── Statement import ──────────────────────────────────────────────────────
  // Two-step by design: preview never writes, so a wrong file or a wrong bank
  // profile costs nothing but a second click.
  const previewImport = useCallback(async (source, accountId, content) => {
    const res = await call('/api/finances/import/preview', {
      method: 'POST', body: JSON.stringify({ source, account_id: accountId, content }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.detail || 'Could not read that file')
    return body
  }, [call])

  const commitImport = useCallback(async (source, accountId, rows, fxRates = {}) => {
    const res = await call('/api/finances/import/commit', {
      method: 'POST',
      body: JSON.stringify({ source, account_id: accountId, rows, fx_rates: fxRates }),
    })
    const body = await res.json()
    await refetch()
    return body
  }, [call, refetch])

  // ─── Computed ──────────────────────────────────────────────────────────────
  const pots = data.pots.map(p => {
    const saved = (p.deposits||[]).reduce((s, d) => s + d.amount, 0)
    const pct = p.targetAmount > 0 ? Math.min(Math.round(saved / p.targetAmount * 100), 100) : 0
    return { ...p, saved, pct }
  })
  const netWorth = data.accounts.reduce((s, a) => a.type === 'credit' ? s - a.balance : s + a.balance, 0)
  const totalSaved = pots.reduce((s, p) => s + p.saved, 0)

  // Value in GBP, using the rate captured at import time rather than today's —
  // otherwise last year's spending silently changes every time sterling moves.
  const inGBP = (t) => t.amount * (t.fx_rate ?? 1)

  // Local month key, not toISOString — that shifts the boundary in UTC.
  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const inMonth = (t, m) => (t.date || '').slice(0, 7) === m

  const monthTxns = data.transactions.filter(t => inMonth(t, thisMonth))
  const sum = (rows, type) => rows.filter(t => t.type === type).reduce((s, t) => s + inGBP(t), 0)

  const income   = sum(monthTxns, 'income')
  const spending = sum(monthTxns, 'expense')
  const incomeAllTime   = sum(data.transactions, 'income')
  const spendingAllTime = sum(data.transactions, 'expense')

  // Spend per category this month — the basis for budgets in a later phase.
  const byCategory = Object.entries(
    monthTxns.filter(t => t.type === 'expense').reduce((acc, t) => {
      const key = t.category || 'Uncategorised'
      acc[key] = (acc[key] || 0) + inGBP(t)
      return acc
    }, {})
  ).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total)

  return (
    <Ctx.Provider value={{
      pots, accounts: data.accounts, transactions: data.transactions, rules: data.rules,
      netWorth, totalSaved, income, spending,
      incomeAllTime, spendingAllTime, byCategory, thisMonth,
      addRule, removeRule, previewImport, commitImport, refetch,
      insights, setBudget, removeBudget, allocateSurplus, refreshInsights,
      addPot, removePot,
      addSubGoal, removeSubGoal,
      addDeposit, removeDeposit,
      addTransaction, removeTransaction,
      addAccount, updateAccount, removeAccount,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export const useFinances = () => useContext(Ctx)
